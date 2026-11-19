/**
 * Instagram fetch helpers — one UA, one place, always observable.
 *
 * Why this file exists: the IG import path had three silent fallbacks and no status
 * logging, so a failed import was indistinguishable from "IG served a login wall",
 * "IG rate-limited us" or "the endpoint moved". These helpers never throw and always
 * return status/chars/ms so the caller can log exactly what happened.
 */
import { safeFetch } from "./safeUrl";

/** The only Instagram user-agent used in this backend (iPhone Safari 17). */
export const IG_MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

export type IgFetchResult = {
  ok: boolean;
  status: number;
  chars: number;
  text: string;
  thumbnail: string | null;
  finalUrl: string;
  ms: number;
};

const empty = (status: number, ms: number): IgFetchResult => ({
  ok: false,
  status,
  chars: 0,
  text: "",
  thumbnail: null,
  finalUrl: "",
  ms,
});

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** GET /api/v1/oembed — the endpoint that returns the caption as JSON. */
export async function fetchInstagramOembed(url: string, timeoutMs = 5000): Promise<IgFetchResult> {
  const started = Date.now();
  const endpoint = `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(url)}`;
  try {
    const resp = await safeFetch(endpoint, {
      headers: { "user-agent": IG_MOBILE_UA, accept: "application/json" },
      maxBytes: 1_000_000,
      signal: AbortSignal.timeout(timeoutMs),
    } as any);
    const ms = Date.now() - started;
    if (!resp.ok) return { ...empty(resp.status, ms), finalUrl: resp.url || endpoint };

    const data = (await resp.json().catch(() => null)) as
      | { title?: string; thumbnail_url?: string }
      | null;
    const text = decodeHtmlEntities(String(data?.title ?? "")).trim();
    const thumbnail = data?.thumbnail_url ? String(data.thumbnail_url) : null;
    return {
      ok: text.length >= 50,
      status: resp.status,
      chars: text.length,
      text,
      thumbnail,
      finalUrl: resp.url || endpoint,
      ms,
    };
  } catch {
    return empty(0, Date.now() - started);
  }
}

/** GET the post page and read og:description / og:image. */
export async function fetchInstagramOg(url: string, timeoutMs = 8000): Promise<IgFetchResult> {
  const started = Date.now();
  try {
    const resp = await safeFetch(url, {
      headers: { "user-agent": IG_MOBILE_UA, "accept-language": "zh-TW,zh;q=0.9,en;q=0.8" },
      maxBytes: 3_000_000,
      signal: AbortSignal.timeout(timeoutMs),
    } as any);
    const ms = Date.now() - started;
    if (!resp.ok) return { ...empty(resp.status, ms), finalUrl: resp.url || url };

    const html = await resp.text();
    const descMatch =
      html.match(/property="og:description" content="([\s\S]*?)"/) ||
      html.match(/content="([\s\S]*?)" property="og:description"/);
    const thumbMatch =
      html.match(/property="og:image" content="([^"]+)"/) ||
      html.match(/content="([^"]+)" property="og:image"/) ||
      html.match(/name="twitter:image" content="([^"]+)"/) ||
      html.match(/content="([^"]+)" name="twitter:image"/);

    const raw = descMatch ? descMatch[1] : "";
    const text = decodeHtmlEntities(raw)
      .replace(/^[\d.KM]+ likes[^:]*:\s*"?/i, "")
      .replace(/"?\s*$/, "")
      .trim();

    return {
      ok: text.length >= 50,
      status: resp.status,
      chars: text.length,
      text,
      thumbnail: thumbMatch ? decodeHtmlEntities(thumbMatch[1]) : null,
      finalUrl: resp.url || url,
      ms,
    };
  } catch {
    return empty(0, Date.now() - started);
  }
}

/** Canary is restricted to Instagram hosts so it cannot be used as an open proxy. */
export function isAllowedCanaryUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host === "instagram.com" || host === "www.instagram.com";
  } catch {
    return false;
  }
}
