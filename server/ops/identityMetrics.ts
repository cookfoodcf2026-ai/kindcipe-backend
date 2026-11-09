/**
 * Identity monitoring.
 *
 * Daily orphan count = shopping rows created that day with
 * `from_meal_plan_id IS NOT NULL AND from_recipe_id IS NULL`.
 * Canonical write rate = canonical_written / expected, where expected is every
 * row that carried a meal-plan or recipe link.
 *
 * The store is injected so the calculations can be tested without a DB.
 */
import { sql } from "drizzle-orm";

export interface IdentityCanonicalCounters {
  canonicalWritten: number;
  expected: number;
  refConflict: number;
}

export interface IdentityMetricsStore {
  countDailyOrphans(day: string): Promise<number>;
  countDailyInvalidRefs(day: string): Promise<number>;
  getCanonicalCounters(day: string): Promise<IdentityCanonicalCounters>;
  getMissTop5(day: string): Promise<Array<{ familyId: number; misses: number }>>;
}

export interface IdentityMetrics {
  day: string;
  dailyOrphan: number;
  invalid: number;
  canonicalRate: number;
  canonicalWritten: number;
  expected: number;
  refConflictRate: number;
  missTop5: Array<{ familyId: number; misses: number }>;
  alerts: string[];
}

export interface IdentityCountersInput {
  day: string;
  dailyOrphan: number;
  invalid: number;
  previousDayOrphan?: number;
  canonicalWritten: number;
  expected: number;
  refConflict: number;
  missTop5: Array<{ familyId: number; misses: number }>;
}

export const IDENTITY_ALERT_THRESHOLDS = {
  canonicalRateMin: 0.95,
  refConflictRateMax: 0.01,
  orphanDaysInARow: 2,
} as const;

/** SQL snippets used by the admin dashboard / cron job. */
export const IDENTITY_METRICS_SQL = {
  orphans: `SELECT count(*)::int AS orphans FROM shopping_items WHERE (created_at AT TIME ZONE 'Asia/Hong_Kong')::date = :day::date AND from_meal_plan_id IS NOT NULL AND from_recipe_id IS NULL`,
  invalidRefs: `SELECT count(*)::int AS invalid FROM shopping_items WHERE (created_at AT TIME ZONE 'Asia/Hong_Kong')::date = :day::date AND from_recipe_id IS NOT NULL AND from_recipe_id !~ '^(official|user)_[1-9][0-9]*$'`,
  canonical: `SELECT count(*) FILTER (WHERE from_recipe_id ~ '^(official|user)_[1-9][0-9]*$')::int AS canonical_written, count(*) FILTER (WHERE from_meal_plan_id IS NOT NULL OR from_recipe_id IS NOT NULL)::int AS expected FROM shopping_items WHERE (created_at AT TIME ZONE 'Asia/Hong_Kong')::date = :day::date`,
  missTop5: `SELECT family_id, count(*)::int AS misses FROM shopping_items WHERE (created_at AT TIME ZONE 'Asia/Hong_Kong')::date = :day::date AND from_meal_plan_id IS NOT NULL AND from_recipe_id IS NULL GROUP BY family_id ORDER BY misses DESC LIMIT 5`,
} as const;

export function computeCanonicalRate(canonicalWritten: number, expected: number): number {
  if (expected <= 0) return 1;
  return canonicalWritten / expected;
}

export function computeIdentityMetrics(input: IdentityCountersInput): IdentityMetrics {
  const canonicalRate = computeCanonicalRate(input.canonicalWritten, input.expected);
  const refConflictRate = input.expected > 0 ? input.refConflict / input.expected : 0;
  const alerts: string[] = [];

  if (
    input.dailyOrphan > 0 &&
    (input.previousDayOrphan ?? 0) > 0 &&
    IDENTITY_ALERT_THRESHOLDS.orphanDaysInARow >= 2
  ) {
    alerts.push("orphan_rising");
  }
  if (input.expected > 0 && canonicalRate < IDENTITY_ALERT_THRESHOLDS.canonicalRateMin) {
    alerts.push("canonical_rate_low");
  }
  if (input.expected > 0 && refConflictRate > IDENTITY_ALERT_THRESHOLDS.refConflictRateMax) {
    alerts.push("ref_conflict_high");
  }

  return {
    day: input.day,
    dailyOrphan: input.dailyOrphan,
    invalid: input.invalid,
    canonicalRate,
    canonicalWritten: input.canonicalWritten,
    expected: input.expected,
    refConflictRate,
    missTop5: input.missTop5,
    alerts,
  };
}

function previousDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export async function buildIdentityMetricsResponse(
  store: IdentityMetricsStore,
  day: string,
): Promise<IdentityMetrics> {
  const [dailyOrphan, invalid, counters, missTop5, previousDayOrphan] = await Promise.all([
    store.countDailyOrphans(day),
    store.countDailyInvalidRefs(day),
    store.getCanonicalCounters(day),
    store.getMissTop5(day),
    store.countDailyOrphans(previousDay(day)),
  ]);

  return computeIdentityMetrics({
    day,
    dailyOrphan,
    invalid,
    previousDayOrphan,
    canonicalWritten: counters.canonicalWritten,
    expected: counters.expected,
    refConflict: counters.refConflict,
    missTop5,
  });
}

export async function runDailyIdentityMetrics(
  store: IdentityMetricsStore,
  day: string,
  log: (entry: Record<string, unknown>) => void = (entry) => console.log(JSON.stringify(entry)),
): Promise<IdentityMetrics> {
  const metrics = await buildIdentityMetricsResponse(store, day);
  log({ event: "identity_metrics_daily", ...metrics });
  return metrics;
}

function rowsOf(result: unknown): any[] {
  const anyResult = result as any;
  return anyResult?.rows ?? (Array.isArray(anyResult) ? anyResult : []);
}

function hkDay(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** DB-backed store for the daily cron/admin endpoint. */
export function createDbIdentityMetricsStore(): IdentityMetricsStore {
  return {
    async countDailyOrphans(day: string): Promise<number> {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return 0;
      const rows = rowsOf(await db.execute(sql`
        SELECT count(*)::int AS orphans
        FROM shopping_items
        WHERE (created_at AT TIME ZONE 'Asia/Hong_Kong')::date = ${day}::date
          AND from_meal_plan_id IS NOT NULL
          AND from_recipe_id IS NULL
      `));
      return Number(rows[0]?.orphans ?? 0);
    },

    async countDailyInvalidRefs(day: string): Promise<number> {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return 0;
      const rows = rowsOf(await db.execute(sql`
        SELECT count(*)::int AS invalid
        FROM shopping_items
        WHERE (created_at AT TIME ZONE 'Asia/Hong_Kong')::date = ${day}::date
          AND from_recipe_id IS NOT NULL
          AND from_recipe_id !~ '^(official|user)_[1-9][0-9]*$'
      `));
      return Number(rows[0]?.invalid ?? 0);
    },

    async getCanonicalCounters(day: string): Promise<IdentityCanonicalCounters> {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return { canonicalWritten: 0, expected: 0, refConflict: 0 };
      const rows = rowsOf(await db.execute(sql`
        SELECT
          count(*) FILTER (WHERE from_recipe_id ~ '^(official|user)_[1-9][0-9]*$')::int AS canonical_written,
          count(*) FILTER (WHERE from_meal_plan_id IS NOT NULL OR from_recipe_id IS NOT NULL)::int AS expected
        FROM shopping_items
        WHERE (created_at AT TIME ZONE 'Asia/Hong_Kong')::date = ${day}::date
      `));
      return {
        canonicalWritten: Number(rows[0]?.canonical_written ?? 0),
        expected: Number(rows[0]?.expected ?? 0),
        refConflict: 0,
      };
    },

    async getMissTop5(day: string): Promise<Array<{ familyId: number; misses: number }>> {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return [];
      const rows = rowsOf(await db.execute(sql`
        SELECT family_id, count(*)::int AS misses
        FROM shopping_items
        WHERE (created_at AT TIME ZONE 'Asia/Hong_Kong')::date = ${day}::date
          AND from_meal_plan_id IS NOT NULL
          AND from_recipe_id IS NULL
        GROUP BY family_id
        ORDER BY misses DESC
        LIMIT 5
      `));
      return rows.map((row) => ({ familyId: Number(row.family_id), misses: Number(row.misses) }));
    },
  };
}

export async function loadIdentityMetrics(day: string = hkDay()): Promise<IdentityMetrics> {
  return runDailyIdentityMetrics(createDbIdentityMetricsStore(), day);
}
