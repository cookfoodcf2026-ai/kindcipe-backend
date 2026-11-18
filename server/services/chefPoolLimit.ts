/**
 * cap400: generic AI Chef pool size (flag-free, env-configured).
 *
 * The meal / library / salvage / refill paths used a hard-coded 400-row cap,
 * which silently dropped eligible cards once a family had more than 400
 * recipes (family 13: 438 eligible). The cap is now read from
 * `AI_CHEF_GENERIC_POOL_LIMIT`:
 *
 *   unset / empty       → 400 (legacy behaviour, default)
 *   0                   → unlimited (mapped to a safe SQL ceiling)
 *   positive integer    → that number
 *   anything else       → 400 (invalid values fail safe, never unbounded)
 *
 * Pure module: no DB/network access, so it is unit tested directly.
 */

import { FULL_CATEGORY_POOL_LIMIT } from "./chefPoolFullCategory";

export const GENERIC_POOL_LIMIT_ENV = "AI_CHEF_GENERIC_POOL_LIMIT";
export const DEFAULT_GENERIC_POOL_LIMIT = 400;
export const UNLIMITED_GENERIC_POOL_LIMIT = FULL_CATEGORY_POOL_LIMIT;

/**
 * Parse the raw env value. Returns 0 to mean "unlimited"; invalid input
 * (negative, fractional, NaN, garbage) falls back to the 400 default.
 */
export function parseGenericPoolLimit(raw: string | undefined | null): number {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return DEFAULT_GENERIC_POOL_LIMIT;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 0) return DEFAULT_GENERIC_POOL_LIMIT;
  return value;
}

/** Concrete SQL-friendly limit for callers; 0 ("unlimited") becomes the ceiling. */
export function getGenericPoolLimit(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = parseGenericPoolLimit(env[GENERIC_POOL_LIMIT_ENV]);
  return parsed === 0 ? UNLIMITED_GENERIC_POOL_LIMIT : parsed;
}

/** Normalise a request limit for `.limit()`; <= 0 means "no cap". */
export function poolFetchLimit(limit: number): number {
  if (Number.isNaN(limit)) return DEFAULT_GENERIC_POOL_LIMIT;
  if (!Number.isFinite(limit) || limit <= 0) return UNLIMITED_GENERIC_POOL_LIMIT;
  return Math.floor(limit);
}

/**
 * Custom-first split cap. Anchored to the legacy 400 cap so raising the pool
 * limit cannot reorder the first 400 rows (custom:official interleaving is
 * capped at ceil(400 / 2) = 200 regardless of the requested limit).
 */
export function poolCustomFirstCap(limit: number): number {
  const anchored = Math.min(poolFetchLimit(limit), DEFAULT_GENERIC_POOL_LIMIT);
  return Math.max(1, Math.ceil(anchored / 2));
}

/** custom 先佔最多一半（固定 200），其餘 official，再補 custom。 */
export function orderPoolForReturn<T>(customRows: T[], officialRows: T[], limit: number): T[] {
  const cap = poolCustomFirstCap(limit);
  return [...customRows.slice(0, cap), ...officialRows, ...customRows.slice(cap)];
}

/** Truncate the returned pool; limit <= 0 means "return everything". */
export function slicePoolForReturn<T>(rows: T[], limit: number): T[] {
  if (Number.isNaN(limit)) return rows.slice(0, DEFAULT_GENERIC_POOL_LIMIT);
  if (!Number.isFinite(limit) || limit <= 0) return rows;
  return rows.slice(0, Math.floor(limit));
}
