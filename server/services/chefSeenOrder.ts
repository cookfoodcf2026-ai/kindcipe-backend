/**
 * AI_CHEF_SEEN_LRU: least-recently-served ordering for library pools.
 *
 * Goal (flag ON): never serve "the newest 80 forever". Order by
 *   1. unseen cards first
 *   2. fewer times served first
 *   3. older lastSeenAt first
 *   4. createdAt desc
 *   5. stable name / id tie-breakers so repeated queries are identical
 *
 * Pure module: no DB / network / Math.random. The caller decides whether the
 * flag is ON; when it is OFF this module is never invoked, so legacy ordering
 * stays byte-identical.
 */

import { hashSeed } from "./chefSelector";

export type SeenInfo = { count: number; lastSeenAt: number };
export type SeenInput =
  | ReadonlyMap<string, Partial<SeenInfo>>
  | Record<string, Partial<SeenInfo> | number>
  | undefined
  | null;
export type SeenSortable = {
  name?: unknown;
  createdAt?: unknown;
  id?: unknown;
};

/** Stable key used for both the seen map and row names. */
export function seenKey(name: unknown): string {
  return String(name ?? "").trim().toLowerCase();
}

function toMs(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : undefined;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const t = new Date(String(value)).getTime();
  return Number.isFinite(t) ? t : undefined;
}

/** Coerce the DB / memory representation into a Map keyed by seenKey(). */
export function normalizeSeenMap(input: SeenInput): Map<string, SeenInfo> {
  const out = new Map<string, SeenInfo>();
  if (!input) return out;
  const entries: Array<[unknown, Partial<SeenInfo> | number]> =
    input instanceof Map ? [...input.entries()] : Object.entries(input);
  for (const [rawName, raw] of entries) {
    const key = seenKey(rawName);
    if (!key) continue;
    const info: Partial<SeenInfo> = typeof raw === "number" ? { count: raw } : raw;
    const count = Number(info?.count);
    const lastSeenAt = Number(info?.lastSeenAt);
    out.set(key, {
      count: Number.isFinite(count) && count > 0 ? Math.floor(count) : 1,
      lastSeenAt: Number.isFinite(lastSeenAt) ? lastSeenAt : 0,
    });
  }
  return out;
}

function compareCreatedDesc(a: SeenSortable, b: SeenSortable): number {
  const ta = toMs(a?.createdAt);
  const tb = toMs(b?.createdAt);
  if (ta !== undefined && tb !== undefined && ta !== tb) return tb - ta;
  if (ta !== undefined && tb === undefined) return -1;
  if (ta === undefined && tb !== undefined) return 1;
  return 0;
}

function compareStable(a: SeenSortable, b: SeenSortable): number {
  const na = seenKey(a?.name);
  const nb = seenKey(b?.name);
  if (na !== nb) return na < nb ? -1 : 1;
  const ia = Number(a?.id);
  const ib = Number(b?.id);
  if (Number.isFinite(ia) && Number.isFinite(ib) && ia !== ib) return ia - ib;
  return 0;
}

/**
 * Comparator contract:
 *   unseen > seen, then count asc, then lastSeenAt asc (oldest first),
 *   then createdAt desc, then stable name/id so the order is total.
 */
export function compareSeenFirst(a: SeenSortable, b: SeenSortable, seen: SeenInput): number {
  const map = seen instanceof Map ? seen : normalizeSeenMap(seen);
  const ea = map.get(seenKey(a?.name));
  const eb = map.get(seenKey(b?.name));
  if (!ea && !eb) return compareCreatedDesc(a, b) || compareStable(a, b);
  if (!ea) return -1;
  if (!eb) return 1;
  if (ea.count !== eb.count) return ea.count - eb.count;
  if (ea.lastSeenAt !== eb.lastSeenAt) return ea.lastSeenAt - eb.lastSeenAt;
  return compareCreatedDesc(a, b) || compareStable(a, b);
}

export function sortBySeenFirst<T extends SeenSortable>(rows: readonly T[], seen: SeenInput): T[] {
  const map = normalizeSeenMap(seen);
  return [...rows].sort((a, b) => compareSeenFirst(a, b, map));
}

/** Flag-OFF path: return the exact same array order, no copy reorder. */
export function orderBySeenIfEnabled<T extends SeenSortable>(
  rows: readonly T[],
  seen: SeenInput,
  enabled: boolean,
): T[] {
  return enabled ? sortBySeenFirst(rows, seen) : [...rows];
}

/** Deterministic replacement for Math.random() shuffles. */
export function deterministicShuffle<T>(items: readonly T[], seedParts: Array<string | number> = []): T[] {
  return items
    .map((item, index) => ({
      item,
      index,
      key: hashSeed([...seedParts, index, seenKey((item as unknown as SeenSortable)?.name)]),
    }))
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .map((entry) => entry.item);
}

/** Deterministic unit interval from the shared FNV-1a hash. */
export function deterministicUnit(seedParts: Array<string | number>): number {
  return hashSeed(seedParts) / 0x1_0000_0000;
}
