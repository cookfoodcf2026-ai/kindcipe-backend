import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { customRecipeUsage, importUsage } from "../../drizzle/schema";
import type { PlanKey } from "./entitlementPolicy";
import { getYearMonthKey } from "./monthKey";

/**
 * Which rows a quota consumes.
 *
 * - free: per user + month, summed across every kitchen the user belongs to, so
 *   creating/switching kitchens cannot multiply the allowance.
 * - trial/pro: family + month, i.e. the shared pool that already existed.
 */
export interface QuotaScope {
  familyId: number;
  userId: string;
  plan: PlanKey;
}

export function quotaCountsPerUser(plan: PlanKey): boolean {
  return plan === "free";
}

/** Pure key used by tests and by any in-memory ledger mirror. */
export function quotaLedgerKey(scope: QuotaScope, yearMonth: string): string {
  return quotaCountsPerUser(scope.plan)
    ? `user:${scope.userId}:${yearMonth}`
    : `family:${scope.familyId}:${yearMonth}`;
}

function customRecipeScopeCondition(scope: QuotaScope, yearMonth: string) {
  return and(
    eq(customRecipeUsage.yearMonth, yearMonth),
    quotaCountsPerUser(scope.plan)
      ? eq(customRecipeUsage.userId, scope.userId)
      : eq(customRecipeUsage.familyId, scope.familyId),
  );
}

function importScopeCondition(scope: QuotaScope, yearMonth: string) {
  return and(
    eq(importUsage.yearMonth, yearMonth),
    quotaCountsPerUser(scope.plan)
      ? eq(importUsage.userId, scope.userId)
      : eq(importUsage.familyId, scope.familyId),
  );
}

/** Creates recorded this month for the scope. Never decremented on delete. */
export async function countCustomRecipeUsage(
  scope: QuotaScope,
  yearMonth = getYearMonthKey(),
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ count: sql<number>`COALESCE(SUM(${customRecipeUsage.count}), 0)::int` })
    .from(customRecipeUsage)
    .where(customRecipeScopeCondition(scope, yearMonth));
  return row?.count ?? 0;
}

/** Successful imports this month for the scope. Never decremented on delete. */
export async function countImportUsage(
  scope: QuotaScope,
  yearMonth = getYearMonthKey(),
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ count: sql<number>`COALESCE(SUM(${importUsage.count}), 0)::int` })
    .from(importUsage)
    .where(importScopeCondition(scope, yearMonth));
  return row?.count ?? 0;
}

/** Record one successful custom-recipe create (manual, AI, import or photo). */
export async function recordCustomRecipeCreate(
  scope: QuotaScope,
  yearMonth = getYearMonthKey(),
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db
    .insert(customRecipeUsage)
    .values({
      userId: scope.userId,
      familyId: scope.familyId,
      yearMonth,
      count: 1,
    })
    .onConflictDoUpdate({
      target: [customRecipeUsage.familyId, customRecipeUsage.yearMonth, customRecipeUsage.userId],
      set: {
        count: sql`${customRecipeUsage.count} + 1`,
        updatedAt: new Date(),
      },
    });
}

/** Record one successful import. Used by every import-save path. */
export async function recordImportCreate(
  scope: QuotaScope,
  yearMonth = getYearMonthKey(),
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db
    .insert(importUsage)
    .values({
      userId: scope.userId,
      familyId: scope.familyId,
      yearMonth,
      count: 1,
    })
    .onConflictDoUpdate({
      target: [importUsage.familyId, importUsage.yearMonth, importUsage.userId],
      set: {
        count: sql`${importUsage.count} + 1`,
        updatedAt: new Date(),
      },
    });
}
