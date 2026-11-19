/**
 * Import canary — GET /api/canary/import?url=…
 *
 * Purpose: answer "can this server actually read this post right now?" without
 * touching the LLM, credits, the DB or the parse cache. Used by a daily cron so a
 * source that starts blocking us is noticed the same day instead of when a user
 * complains.
 *
 * Guarded by a shared secret header (x-canary-secret). If CANARY_SECRET is unset the
 * route answers 404 so an unconfigured deployment never exposes it.
 */
import type { Express, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { ENV } from "../_core/env";
import { fetchInstagramOg, fetchInstagramOembed, isAllowedCanaryUrl } from "../utils/igFetch";

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function registerImportCanary(app: Express): void {
  app.get("/api/canary/import", async (req: Request, res: Response) => {
    const expected = ENV.canarySecret;
    if (!expected) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const provided = String(req.header("x-canary-secret") ?? "");
    if (!provided || !secretMatches(provided, expected)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    if (rateLimited(String(req.ip ?? "unknown"))) {
      res.status(429).json({ error: "rate_limited" });
      return;
    }

    const url = String(req.query.url ?? "").trim();
    if (!url || !isAllowedCanaryUrl(url)) {
      res.status(400).json({ error: "url_not_allowed" });
      return;
    }

    const started = Date.now();
    const oembed = await fetchInstagramOembed(url, 5000);
    const og = oembed.ok ? null : await fetchInstagramOg(url, 8000);

    res.json({
      url,
      source: "instagram",
      ok: oembed.ok || Boolean(og?.ok),
      ms: Date.now() - started,
      oembed: { status: oembed.status, chars: oembed.chars, ms: oembed.ms },
      og: og ? { status: og.status, chars: og.chars, ms: og.ms } : null,
    });
  });
}
