import { createHash } from "node:crypto";
import { getDb } from "../db";
import { sql } from "drizzle-orm";

/**
 * Content-addressed 翻譯 cache。
 * Key = sha256(JSON({kind, promptVersion, model, srcLang, targetLangs, ...原文}))
 * → 原文一改就自動 miss，唔需要 explicit invalidate。
 */
export const TRANSLATION_PROMPT_VERSION = 1;
export const TRANSLATION_MODEL = "default";

export function translationCacheKey(parts: Record<string, unknown>): string {
  const normalized: Record<string, unknown> = {
    promptVersion: TRANSLATION_PROMPT_VERSION,
    model: TRANSLATION_MODEL,
    ...parts,
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export async function getTranslationCache<T>(hash: string): Promise<T | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const rows = await db.execute(sql`
      UPDATE translation_cache
         SET hit_count = hit_count + 1, last_hit_at = now()
       WHERE hash = ${hash}
      RETURNING payload
    `);
    const anyRes = rows as any;
    const arr: any[] = anyRes?.rows ?? (Array.isArray(anyRes) ? anyRes : []);
    const payload = arr[0]?.payload;
    return (payload as T) ?? null;
  } catch {
    return null; // cache 壞唔可以阻翻譯
  }
}

export async function setTranslationCache(hash: string, kind: string, payload: unknown): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.execute(sql`
      INSERT INTO translation_cache (hash, kind, payload, prompt_version)
      VALUES (${hash}, ${kind}, ${JSON.stringify(payload)}::jsonb, ${TRANSLATION_PROMPT_VERSION})
      ON CONFLICT (hash) DO UPDATE
        SET payload = EXCLUDED.payload,
            prompt_version = EXCLUDED.prompt_version,
            last_hit_at = now()
    `);
  } catch {
    /* ignore cache write failures */
  }
}

/** 清走 90 日冇人用嘅 cache（由 server 定時呼叫）。 */
export async function pruneTranslationCache(days = 90): Promise<number> {
  try {
    const db = await getDb();
    if (!db) return 0;
    const res = await db.execute(sql`
      DELETE FROM translation_cache
       WHERE last_hit_at < now() - (${days} || ' days')::interval
    `);
    const count = (res as unknown as { rowCount?: number })?.rowCount;
    return typeof count === "number" ? count : 0;
  } catch {
    return 0;
  }
}
