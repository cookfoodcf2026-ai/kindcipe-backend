/**
 * P1: full-category swap pool (flag `AI_CHEF_POOL_FULL_CATEGORY`, default OFF).
 *
 * The legacy swap path builds its candidate pool from a keyword search, so a
 * user can only ever see the handful of cards that match the keyword (meat:
 * 22 of 128). When the flag is ON the pool is the *entire* dish_type, fetched
 * with a fixed `ORDER BY dishType, id` ordering, and the keyword is demoted to
 * a ranking boost. Randomness lives here (seeded, deterministic) rather than
 * in the SQL (`ORDER BY random()` is forbidden).
 *
 * This module is pure and has no DB/network access so it can be unit tested.
 */

import { hashSeed } from "./chefSelector";

export const POOL_FULL_CATEGORY_ENV = "AI_CHEF_POOL_FULL_CATEGORY";
export const FULL_CATEGORY_POOL_LIMIT = 20_000;

/** Flag is OFF unless explicitly enabled. */
export function isPoolFullCategoryEnabled(): boolean {
  const raw = process.env[POOL_FULL_CATEGORY_ENV];
  if (raw === undefined) return false;
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true" || value === "on";
}

/**
 * Cache version for LIBRARY_POOL_CACHE. A flag flip must not be able to reuse
 * a pool that was built under the other mode.
 */
export function libraryPoolVersion(): string {
  return isPoolFullCategoryEnabled() ? "fullcat-v2" : "legacy-v1";
}

export type DishTypeClassifier = (row: Record<string, unknown>) => string;

/**
 * Keep only rows whose classified dish_type matches `dishType`. An empty
 * dishType is a no-op (legacy behaviour for non-swap callers).
 */
export function filterFullCategoryRows(
  rows: Record<string, unknown>[],
  dishType: string,
  classify: DishTypeClassifier,
): Record<string, unknown>[] {
  const target = String(dishType ?? "").trim().toLowerCase();
  if (!target) return [...rows];
  return rows.filter((row) => classify(row) === target);
}

function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rowName(row: Record<string, unknown>): string {
  return String(row?.name ?? "").trim();
}

/** Keyword matches draw from [0, 1/KEYWORD_BOOST) instead of [0, 1). */
export const KEYWORD_BOOST = 4;

/**
 * Per-request seed for the swap pool. `requestId` is the main entropy source;
 * the excluded names (current card + swap chain) and the swapped dish type make
 * two requests with the same requestId (tests/harness) still differ when the
 * user is on a different card.
 */
export function swapPoolSeed(parts: {
  requestId?: string;
  keyword?: string;
  dishType?: string;
  excludeNames?: string[];
}): number {
  return hashSeed([
    parts.requestId ?? "",
    parts.keyword ?? "",
    parts.dishType ?? "",
    (parts.excludeNames ?? []).join("|"),
  ]);
}

/**
 * Keyword boost + seeded shuffle. A keyword match draws from a 4x narrower
 * range instead of being placed in an absolute first tier: a hard tier
 * collapses the head of the queue to the handful of keyword rows, so excluding
 * the current card leaves only the sibling and the two alternate forever
 * (production 2026-11-18: 61 seafood rows, two cards A↔B). The very same seed
 * still returns the very same ordering (bit-identical), independent of the
 * engine's sort stability because every comparison has an index tiebreak.
 */
export function orderFullCategoryPool(
  rows: Record<string, unknown>[],
  opts: { keyword?: string; seed?: number; log?: boolean } = {},
): Record<string, unknown>[] {
  const keyword = String(opts.keyword ?? "").trim();
  const seed = opts.seed ?? hashSeed([keyword || "any", rows.length]);
  const rng = makeRng(seed);
  const keyed = rows.map((row, index) => {
    const draw = rng();
    const keywordMatch = Boolean(keyword) && rowName(row).includes(keyword);
    return {
      row,
      index,
      keywordMatch,
      rank: keywordMatch ? draw / KEYWORD_BOOST : draw,
    };
  });
  keyed.sort((a, b) => a.rank - b.rank || a.index - b.index);
  if (opts.log) {
    const top5 = keyed.slice(0, 5).map((entry) => rowName(entry.row)).join("|");
    console.log(`[AI Chef][pool-order] seed=${seed} keyword="${keyword}" rows=${rows.length} top5="${top5}"`);
  }
  return keyed.map((entry) => entry.row);
}
