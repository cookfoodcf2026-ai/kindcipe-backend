import { TRPCError } from "@trpc/server";
import { and, eq, lt, sql } from "drizzle-orm";
import { getDb } from "../db";
import { familyUsageMonthly, usageEvents } from "../../drizzle/schema";
import type { PlanLimits } from "./entitlementPolicy";

export type UsageKind =
  | "ai_chat"
  | "ai_generate"
  | "ai_image"
  | "ai_edit"
  | "ai_plan"
  | "import"
  | "custom_recipe";

export interface UsageCost {
  credits?: number;
  imports?: number;
  customRecipes?: number;
  estimatedCostMicros?: number;
}

export class UsageLimitError extends Error {
  code = "PAYWALL" as const;
  reason: "AI_CREDITS" | "IMPORTS" | "CUSTOM_RECIPES";
  limit: number;
  used: number;

  constructor(reason: UsageLimitError["reason"], limit: number, used: number) {
    super("Usage limit reached");
    this.name = "UsageLimitError";
    this.reason = reason;
    this.limit = limit;
    this.used = used;
  }
}

export function getYearMonthKey(date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function rowsOf(result: unknown): any[] {
  const maybe = result as { rows?: any[] } | any[];
  if (Array.isArray(maybe)) return maybe;
  return maybe?.rows ?? [];
}

export async function getUsageSummary(familyId: number) {
  const db = await getDb();
  const yearMonth = getYearMonthKey();
  if (!db) {
    return { yearMonth, aiCredits: 0, imports: 0, customRecipes: 0, estimatedCostMicros: 0 };
  }
  const [row] = await db
    .select()
    .from(familyUsageMonthly)
    .where(and(eq(familyUsageMonthly.familyId, familyId), eq(familyUsageMonthly.yearMonth, yearMonth)))
    .limit(1);
  return {
    yearMonth,
    aiCredits: row?.aiCredits ?? 0,
    imports: row?.imports ?? 0,
    customRecipes: row?.customRecipes ?? 0,
    estimatedCostMicros: row?.estimatedCostMicros ?? 0,
  };
}

export async function reserveUsage(params: {
  familyId: number;
  userId: string;
  kind: UsageKind;
  limits: PlanLimits;
  idempotencyKey: string;
  cost: UsageCost;
  metadata?: unknown;
}): Promise<{ eventId: number; status: string }> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const yearMonth = getYearMonthKey();
  const credits = Math.max(0, params.cost.credits ?? 0);
  const imports = Math.max(0, params.cost.imports ?? 0);
  const customRecipes = Math.max(0, params.cost.customRecipes ?? 0);
  const estimatedCostMicros = Math.max(0, params.cost.estimatedCostMicros ?? 0);
  const customLimit = params.limits.customRecipes;

  if (credits > params.limits.aiCredits) {
    throw new UsageLimitError("AI_CREDITS", params.limits.aiCredits, 0);
  }
  if (imports > params.limits.imports) {
    throw new UsageLimitError("IMPORTS", params.limits.imports, 0);
  }
  if (customLimit !== null && customRecipes > customLimit) {
    throw new UsageLimitError("CUSTOM_RECIPES", customLimit, 0);
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: usageEvents.id, status: usageEvents.status })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.familyId, params.familyId),
          eq(usageEvents.idempotencyKey, params.idempotencyKey)
        )
      )
      .limit(1);
    if (existing) return { eventId: existing.id, status: existing.status };

    const [event] = await tx
      .insert(usageEvents)
      .values({
        familyId: params.familyId,
        userId: params.userId,
        yearMonth,
        kind: params.kind,
        credits,
        imports,
        customRecipes,
        estimatedCostMicros,
        status: "reserved",
        idempotencyKey: params.idempotencyKey,
        reservedUntil: new Date(Date.now() + 5 * 60 * 1000),
        metadata: params.metadata as any,
      })
      .onConflictDoNothing()
      .returning({ id: usageEvents.id, status: usageEvents.status });

    if (!event) {
      const [race] = await tx
        .select({ id: usageEvents.id, status: usageEvents.status })
        .from(usageEvents)
        .where(
          and(
            eq(usageEvents.familyId, params.familyId),
            eq(usageEvents.idempotencyKey, params.idempotencyKey)
          )
        )
        .limit(1);
      if (!race) throw new Error("Usage reservation conflict");
      return { eventId: race.id, status: race.status };
    }

    const customCheck =
      customLimit === null
        ? sql`true`
        : sql`${familyUsageMonthly.customRecipes} + EXCLUDED."custom_recipes" <= ${customLimit}`;

    const result = await tx.execute(sql`
      INSERT INTO "family_usage_monthly"
        ("family_id", "year_month", "ai_credits", "imports", "custom_recipes", "estimated_cost_micros", "updated_at")
      VALUES
        (${params.familyId}, ${yearMonth}, ${credits}, ${imports}, ${customRecipes}, ${estimatedCostMicros}, now())
      ON CONFLICT ("family_id", "year_month") DO UPDATE SET
        "ai_credits" = ${familyUsageMonthly.aiCredits} + EXCLUDED."ai_credits",
        "imports" = ${familyUsageMonthly.imports} + EXCLUDED."imports",
        "custom_recipes" = ${familyUsageMonthly.customRecipes} + EXCLUDED."custom_recipes",
        "estimated_cost_micros" = ${familyUsageMonthly.estimatedCostMicros} + EXCLUDED."estimated_cost_micros",
        "updated_at" = now()
      WHERE ${familyUsageMonthly.aiCredits} + EXCLUDED."ai_credits" <= ${params.limits.aiCredits}
        AND ${familyUsageMonthly.imports} + EXCLUDED."imports" <= ${params.limits.imports}
        AND ${customCheck}
      RETURNING "ai_credits", "imports", "custom_recipes"
    `);

    if (rowsOf(result).length === 0) {
      const [used] = await tx
        .select()
        .from(familyUsageMonthly)
        .where(and(eq(familyUsageMonthly.familyId, params.familyId), eq(familyUsageMonthly.yearMonth, yearMonth)))
        .limit(1);
      if (imports > 0 && (used?.imports ?? 0) + imports > params.limits.imports) {
        throw new UsageLimitError("IMPORTS", params.limits.imports, used?.imports ?? 0);
      }
      if (customLimit !== null && customRecipes > 0 && (used?.customRecipes ?? 0) + customRecipes > customLimit) {
        throw new UsageLimitError("CUSTOM_RECIPES", customLimit, used?.customRecipes ?? 0);
      }
      throw new UsageLimitError("AI_CREDITS", params.limits.aiCredits, used?.aiCredits ?? 0);
    }

    return { eventId: event.id, status: "reserved" as const };
  });
}

export async function commitUsage(eventId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(usageEvents)
    .set({ status: "consumed", reservedUntil: null, updatedAt: new Date() })
    .where(and(eq(usageEvents.id, eventId), eq(usageEvents.status, "reserved")));
}

export async function refundUsage(eventId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.transaction(async (tx) => {
    const [event] = await tx
      .select()
      .from(usageEvents)
      .where(eq(usageEvents.id, eventId))
      .for("update");
    if (!event || event.status === "refunded") return;
    await tx
      .update(familyUsageMonthly)
      .set({
        aiCredits: sql`GREATEST(0, ${familyUsageMonthly.aiCredits} - ${event.credits})`,
        imports: sql`GREATEST(0, ${familyUsageMonthly.imports} - ${event.imports})`,
        customRecipes: sql`GREATEST(0, ${familyUsageMonthly.customRecipes} - ${event.customRecipes})`,
        estimatedCostMicros: sql`GREATEST(0, ${familyUsageMonthly.estimatedCostMicros} - ${event.estimatedCostMicros})`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(familyUsageMonthly.familyId, event.familyId),
          eq(familyUsageMonthly.yearMonth, event.yearMonth)
        )
      );
    await tx
      .update(usageEvents)
      .set({ status: "refunded", reservedUntil: null, updatedAt: new Date() })
      .where(eq(usageEvents.id, eventId));
  });
}

export async function releaseStaleUsageReservations(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const stale = await db
    .select({ id: usageEvents.id })
    .from(usageEvents)
    .where(and(eq(usageEvents.status, "reserved"), lt(usageEvents.reservedUntil, new Date())))
    .limit(100);
  let released = 0;
  for (const row of stale) {
    try {
      await refundUsage(row.id);
      released++;
    } catch (error) {
      console.warn("[usage] stale reservation refund failed", row.id, (error as Error).message);
    }
  }
  return released;
}

export async function assertUsageAvailable(params: {
  familyId: number;
  limits: PlanLimits;
  cost: UsageCost;
}): Promise<void> {
  const summary = await getUsageSummary(params.familyId);
  const credits = params.cost.credits ?? 0;
  const imports = params.cost.imports ?? 0;
  const customRecipes = params.cost.customRecipes ?? 0;
  if (summary.aiCredits + credits > params.limits.aiCredits) {
    throw new UsageLimitError("AI_CREDITS", params.limits.aiCredits, summary.aiCredits);
  }
  if (summary.imports + imports > params.limits.imports) {
    throw new UsageLimitError("IMPORTS", params.limits.imports, summary.imports);
  }
  if (
    params.limits.customRecipes !== null &&
    summary.customRecipes + customRecipes > params.limits.customRecipes
  ) {
    throw new UsageLimitError(
      "CUSTOM_RECIPES",
      params.limits.customRecipes,
      summary.customRecipes
    );
  }
}

export async function runWithUsage<T>(
  params: Parameters<typeof reserveUsage>[0],
  fn: () => Promise<T>
): Promise<T> {
  const reservation = await reserveUsage(params);
  if (reservation.status === "reserved") {
    try {
      const result = await fn();
      await commitUsage(reservation.eventId);
      return result;
    } catch (error) {
      await refundUsage(reservation.eventId).catch(() => {});
      throw error;
    }
  }
  return fn();
}

export function usageLimitToTRPC(error: unknown): never {
  if (error instanceof UsageLimitError) {
    const label =
      error.reason === "AI_CREDITS"
        ? "AI 用量"
        : error.reason === "IMPORTS"
          ? "匯入"
          : "自訂食譜";
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `${label}已達到上限（${error.used}/${error.limit}），升級方案可解鎖更多。`,
    });
  }
  throw error;
}
