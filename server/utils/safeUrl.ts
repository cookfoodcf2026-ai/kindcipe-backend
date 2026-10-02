/**
 * SSRF 防護：所有「由用戶提供」嘅 URL，喺伺服器 fetch 之前必須過呢度。
 *
 * 阻擋：
 *  - 非 http/https scheme（file:, gopher:, ftp: …）
 *  - loopback / private / link-local（127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, ::1, fc00::/7, fe80::/10）
 *  - 內部主機名（localhost, *.local, *.internal, metadata.google.internal）
 *  - DNS rebinding：解析主機名後再檢查 IP
 *
 * 用法：`await assertSafeUrl(raw)` 之後先 fetch；redirect 一律 manual，逐跳再驗證。
 */
import { isIP } from "node:net";
import dns from "node:dns/promises";

const PRIVATE_IPV4 = [
  /^0\./, /^10\./, /^127\./,
  /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
];
const BLOCKED_HOSTNAMES = new Set([
  "localhost", "metadata.google.internal", "metadata",
]);
const BLOCKED_SUFFIXES = [".local", ".internal", ".localhost"];

function isBlockedIp(ip: string): boolean {
  if (isIP(ip) === 4) return PRIVATE_IPV4.some((re) => re.test(ip));
  const low = ip.toLowerCase();
  return low === "::1" || low.startsWith("fc") || low.startsWith("fd") || low.startsWith("fe80");
}

export class UnsafeUrlError extends Error {}

/** 驗證 URL 安全；不安全會 throw UnsafeUrlError。回傳已驗證嘅 URL 物件。 */
export async function assertSafeUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(String(raw));
  } catch {
    throw new UnsafeUrlError("invalid url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new UnsafeUrlError(`blocked scheme: ${u.protocol}`);
  }
  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new UnsafeUrlError("blocked host");
  }
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new UnsafeUrlError("blocked ip");
    return u;
  }
  // 解析 DNS，防 rebinding / 內部域名
  try {
    const results = await dns.lookup(host, { all: true });
    for (const r of results) {
      if (isBlockedIp(r.address)) throw new UnsafeUrlError("blocked resolved ip");
    }
  } catch (e) {
    if (e instanceof UnsafeUrlError) throw e;
    throw new UnsafeUrlError("dns lookup failed");
  }
  return u;
}

/**
 * 安全 fetch：先驗 URL，redirect 一律 manual 並逐跳驗證（防 SSRF via redirect）。
 * 加 timeout + 最大 body 大小。
 */
export async function safeFetch(
  raw: string,
  init: RequestInit & { maxBytes?: number; maxRedirects?: number } = {},
): Promise<Response> {
  const maxRedirects = init.maxRedirects ?? 3;
  const maxBytes = init.maxBytes ?? 5_000_000; // 5MB
  let current = raw;
  for (let i = 0; i <= maxRedirects; i++) {
    await assertSafeUrl(current);
    const resp = await fetch(current, {
      ...init,
      redirect: "manual",
      signal: init.signal ?? AbortSignal.timeout(15000),
    });
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get("location");
      if (!loc) return resp;
      current = new URL(loc, current).toString();
      continue;
    }
    const len = Number(resp.headers.get("content-length") || 0);
    if (len && len > maxBytes) throw new UnsafeUrlError("content too large");
    return resp;
  }
  throw new UnsafeUrlError("too many redirects");
}
