import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  familyUsageMonthly,
  llmBudgetReservations,
  llmCostEvents,
  llmCostMonthly,
} from "../../drizzle/schema";
import type { LlmCostEvent } from "../_core/llm";

export class LlmBudgetError extends Error {
  code = "LLM_BUDGET" as const;
  reason: "family_cap" | "member_cap";
  constructor(reason: "family_cap" | "member_cap") {
    super(reason === "family_cap" ? "Family AI budget reached" : "Member AI budget reached");
    this.reason = reason;
  }
}

export function getYearMonthKey(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function getNextResetAt(date = new Date()): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString();
}

export function costUsdToMicros(costUsd: number): number {
  return Math.max(0, Math.round(Number(costUsd || 0) * 1_000_000));
}

/** Insert one audit row per LLM call and add actual cost to the monthly
 * ledgers. Credit refunds never touch this ledger. */
export async function recordLlmCostEvent(event: LlmCostEvent): Promise<void> {
  const { familyId, userId, route, requestId } = event.context;
  if (!familyId || !userId) return;
  const db = await getDb();
  if (!db) return;
  const costMicros = Math.max(0, event.costMicros);
  const yearMonth = getYearMonthKey();
  await db.transaction(async (tx) => {
    await tx.insert(llmCostEvents).values({
      requestId: requestId ?? null,
      familyId,
      userId,
      route: route ?? "ai_chef",
      model: event.model,
      inputTokens: Math.max(0, event.inputTokens),
      outputTokens: Math.max(0, event.outputTokens),
      costMicros,
    });
    await tx.execute(sql`
      INSERT INTO "family_usage_monthly" ("family_id", "year_month", "ai_credits", "imports", "custom_recipes", "estimated_cost_micros", "llm_reserved_micros")
      VALUES (${familyId}, ${yearMonth}, 0, 0, 0, ${costMicros}, 0)
      ON CONFLICT ("family_id", "year_month") DO UPDATE SET
        "estimated_cost_micros" = ${familyUsageMonthly.estimatedCostMicros} + ${costMicros},
        "updated_at" = now()
    `);
    await tx.execute(sql`
      INSERT INTO "llm_cost_monthly" ("family_id", "user_id", "year_month", "actual_cost_micros", "reserved_cost_micros")
      VALUES (${familyId}, ${userId}, ${yearMonth}, ${costMicros}, 0)
      ON CONFLICT ("family_id", "user_id", "year_month") DO UPDATE SET
        "actual_cost_micros" = ${llmCostMonthly.actualCostMicros} + ${costMicros},
        "updated_at" = now()
    `);
  });
}

export async function reserveLlmBudget(params: {
  familyId: number;
  userId: string;
  estimateMicros: number;
  familyCapMicros: number;
  memberCapMicros: number;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const yearMonth = getYearMonthKey();
  const estimate = Math.max(0, Math.round(params.estimateMicros));
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`llm-budget:${params.familyId}`}))`);
    await tx.execute(sql`
      INSERT INTO "family_usage_monthly" ("family_id", "year_month", "ai_credits", "imports", "custom_recipes", "estimated_cost_micros", "llm_reserved_micros")
      VALUES (${params.familyId}, ${yearMonth}, 0, 0, 0, 0, 0)
      ON CONFLICT ("family_id", "year_month") DO NOTHING
    `);
    await tx.execute(sql`
      INSERT INTO "llm_cost_monthly" ("family_id", "user_id", "year_month", "actual_cost_micros", "reserved_cost_micros")
      VALUES (${params.familyId}, ${params.userId}, ${yearMonth}, 0, 0)
      ON CONFLICT ("family_id", "user_id", "year_month") DO NOTHING
    `);
    const [family] = await tx
      .select({
        actual: familyUsageMonthly.estimatedCostMicros,
        reserved: familyUsageMonthly.llmReservedMicros,
      })
      .from(familyUsageMonthly)
      .where(and(eq(familyUsageMonthly.familyId, params.familyId), eq(familyUsageMonthly.yearMonth, yearMonth)))
      .limit(1);
    if (!family || family.actual + family.reserved + estimate > params.familyCapMicros) {
      throw new LlmBudgetError("family_cap");
    }
    const [member] = await tx
      .select({
        actual: llmCostMonthly.actualCostMicros,
        reserved: llmCostMonthly.reservedCostMicros,
      })
      .from(llmCostMonthly)
      .where(and(
        eq(llmCostMonthly.familyId, params.familyId),
        eq(llmCostMonthly.userId, params.userId),
        eq(llmCostMonthly.yearMonth, yearMonth),
      ))
      .limit(1);
    if (!member || member.actual + member.reserved + estimate > params.memberCapMicros) {
      throw new LlmBudgetError("member_cap");
    }
    await tx.update(familyUsageMonthly)
      .set({ llmReservedMicros: sql`${familyUsageMonthly.llmReservedMicros} + ${estimate}` })
      .where(and(eq(familyUsageMonthly.familyId, params.familyId), eq(familyUsageMonthly.yearMonth, yearMonth)));
    await tx.update(llmCostMonthly)
      .set({ reservedCostMicros: sql`${llmCostMonthly.reservedCostMicros} + ${estimate}` })
      .where(and(
        eq(llmCostMonthly.familyId, params.familyId),
        eq(llmCostMonthly.userId, params.userId),
        eq(llmCostMonthly.yearMonth, yearMonth),
      ));
    const [reservation] = await tx.insert(llmBudgetReservations).values({
      familyId: params.familyId,
      userId: params.userId,
      yearMonth,
      estimateMicros: estimate,
      status: "reserved",
      reservedUntil: new Date(Date.now() + 5 * 60 * 1000),
    }).returning({ id: llmBudgetReservations.id });
    return reservation.id;
  });
}

export async function finalizeLlmBudget(reservationId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.transaction(async (tx) => {
    const [reservation] = await tx.select().from(llmBudgetReservations)
      .where(eq(llmBudgetReservations.id, reservationId)).for("update").limit(1);
    if (!reservation || reservation.status !== "reserved") return;
    await tx.update(familyUsageMonthly).set({
      llmReservedMicros: sql`GREATEST(0, ${familyUsageMonthly.llmReservedMicros} - ${reservation.estimateMicros})`,
    }).where(and(
      eq(familyUsageMonthly.familyId, reservation.familyId),
      eq(familyUsageMonthly.yearMonth, reservation.yearMonth),
    ));
    await tx.update(llmCostMonthly).set({
      reservedCostMicros: sql`GREATEST(0, ${llmCostMonthly.reservedCostMicros} - ${reservation.estimateMicros})`,
    }).where(and(
      eq(llmCostMonthly.familyId, reservation.familyId),
      eq(llmCostMonthly.userId, reservation.userId),
      eq(llmCostMonthly.yearMonth, reservation.yearMonth),
    ));
    await tx.update(llmBudgetReservations).set({ status: "finalized" })
      .where(eq(llmBudgetReservations.id, reservationId));
  });
}

export async function releaseLlmBudget(reservationId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.transaction(async (tx) => {
    const [reservation] = await tx.select().from(llmBudgetReservations)
      .where(eq(llmBudgetReservations.id, reservationId)).for("update").limit(1);
    if (!reservation || reservation.status !== "reserved") return;
    await tx.update(familyUsageMonthly).set({
      llmReservedMicros: sql`GREATEST(0, ${familyUsageMonthly.llmReservedMicros} - ${reservation.estimateMicros})`,
    }).where(and(
      eq(familyUsageMonthly.familyId, reservation.familyId),
      eq(familyUsageMonthly.yearMonth, reservation.yearMonth),
    ));
    await tx.update(llmCostMonthly).set({
      reservedCostMicros: sql`GREATEST(0, ${llmCostMonthly.reservedCostMicros} - ${reservation.estimateMicros})`,
    }).where(and(
      eq(llmCostMonthly.familyId, reservation.familyId),
      eq(llmCostMonthly.userId, reservation.userId),
      eq(llmCostMonthly.yearMonth, reservation.yearMonth),
    ));
    await tx.update(llmBudgetReservations).set({ status: "released" })
      .where(eq(llmBudgetReservations.id, reservationId));
  });
}

export async function getLlmBudgetState(familyId: number, userId: string) {
  const db = await getDb();
  if (!db) return { familyActual: 0, familyReserved: 0, memberActual: 0, memberReserved: 0 };
  const yearMonth = getYearMonthKey();
  const [family] = await db.select({
    actual: familyUsageMonthly.estimatedCostMicros,
    reserved: familyUsageMonthly.llmReservedMicros,
  }).from(familyUsageMonthly)
    .where(and(eq(familyUsageMonthly.familyId, familyId), eq(familyUsageMonthly.yearMonth, yearMonth)))
    .limit(1);
  const [member] = await db.select({
    actual: llmCostMonthly.actualCostMicros,
    reserved: llmCostMonthly.reservedCostMicros,
  }).from(llmCostMonthly)
    .where(and(
      eq(llmCostMonthly.familyId, familyId),
      eq(llmCostMonthly.userId, userId),
      eq(llmCostMonthly.yearMonth, yearMonth),
    ))
    .limit(1);
  return {
    familyActual: family?.actual ?? 0,
    familyReserved: family?.reserved ?? 0,
    memberActual: member?.actual ?? 0,
    memberReserved: member?.reserved ?? 0,
  };
}

/** Release budget reservations that were never finalized/released (process crash,
 * timeout, uncaught throw). Cross-month reservations are marked stale without
 * mutating the closed month's ledgers. */
export async function releaseStaleLlmBudgetReservations(): Promise<{ released: number; stale: number }> {
  const db = await getDb();
  if (!db) return { released: 0, stale: 0 };
  const now = new Date();
  const currentMonth = getYearMonthKey(now);
  const staleResult = await db.execute(sql`
    SELECT id FROM "llm_budget_reservations"
    WHERE status = 'reserved' AND reserved_until < now()
    LIMIT 100
  `);
  const staleRows: any[] = Array.isArray(staleResult) ? staleResult : ((staleResult as any)?.rows ?? []);
  const stale = staleRows.map((r: any) => ({ id: Number(r.id) }));
  let released = 0;
  let markedStale = 0;
  for (const row of stale) {
    try {
      const outcome = await db.transaction(async (tx) => {
        const [reservation] = await tx.select().from(llmBudgetReservations)
          .where(and(
            eq(llmBudgetReservations.id, row.id),
            eq(llmBudgetReservations.status, "reserved"),
            sql`${llmBudgetReservations.reservedUntil} < now()`,
          ))
          .for("update")
          .limit(1);
        if (!reservation) {
          return "skip" as const;
        }
        if (reservation.yearMonth !== currentMonth) {
          await tx.update(llmBudgetReservations).set({ status: "stale" })
            .where(eq(llmBudgetReservations.id, reservation.id));
          return "stale" as const;
        }
        await tx.update(familyUsageMonthly).set({
          llmReservedMicros: sql`GREATEST(0, ${familyUsageMonthly.llmReservedMicros} - ${reservation.estimateMicros})`,
        }).where(and(
          eq(familyUsageMonthly.familyId, reservation.familyId),
          eq(familyUsageMonthly.yearMonth, reservation.yearMonth),
        ));
        await tx.update(llmCostMonthly).set({
          reservedCostMicros: sql`GREATEST(0, ${llmCostMonthly.reservedCostMicros} - ${reservation.estimateMicros})`,
        }).where(and(
          eq(llmCostMonthly.familyId, reservation.familyId),
          eq(llmCostMonthly.userId, reservation.userId),
          eq(llmCostMonthly.yearMonth, reservation.yearMonth),
        ));
        await tx.update(llmBudgetReservations).set({ status: "released" })
          .where(eq(llmBudgetReservations.id, reservation.id));
        return "released" as const;
      });
      if (outcome === "released") released++;
      if (outcome === "stale") markedStale++;
    } catch (error) {
      console.warn("[llm-budget] stale reservation cleanup failed", row.id, (error as Error).message);
    }
  }
  return { released, stale: markedStale };
}
