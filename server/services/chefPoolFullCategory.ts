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

/**
 * Keyword boost + seeded shuffle. Rows whose name contains the keyword are
 * ranked first, then each tier is shuffled with a seeded RNG. The very same
 * seed always returns the very same ordering (bit-identical), independent of
 * the engine's sort stability because every comparison has an index tiebreak.
 */
export function orderFullCategoryPool(
  rows: Record<string, unknown>[],
  opts: { keyword?: string; seed?: number } = {},
): Record<string, unknown>[] {
  const keyword = String(opts.keyword ?? "").trim();
  const seed = opts.seed ?? hashSeed([keyword || "any", rows.length]);
  const rng = makeRng(seed);
  const keyed = rows.map((row, index) => ({
    row,
    index,
    tier: keyword && rowName(row).includes(keyword) ? 0 : 1,
    draw: rng(),
  }));
  keyed.sort((a, b) => a.tier - b.tier || a.draw - b.draw || a.index - b.index);
  return keyed.map((entry) => entry.row);
}
