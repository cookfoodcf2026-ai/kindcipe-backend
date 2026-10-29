import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "../db";
import { llmCostEvents } from "../../drizzle/schema";

export type ChatPlan = "free" | "pro";

export const CHAT_LIMITS: Record<ChatPlan, { daily: number; monthly: number; costMicros: number }> = {
  pro: { daily: 60, monthly: 1_200, costMicros: 600_000 },
  free: { daily: 3, monthly: 1_200, costMicros: 50_000 },
};

export type ChatQuotaState = {
  allowed: boolean;
  reason: "ok" | "daily" | "monthly" | "budget";
  plan: ChatPlan;
  dailyUsed: number;
  monthlyUsed: number;
  monthlyCostMicros: number;
  dailyLimit: number;
  monthlyLimit: number;
  costCapMicros: number;
};

type ChatUsage = {
  dailyUsed: number;
  monthlyUsed: number;
  monthlyCostMicros: number;
};

const CHAT_ROUTE = "ai_recipe_chat";

function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function startOfUtcMonth(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Pure decision function so quota tests do not need a database. */
export function evaluateChatQuota(input: {
  plan: ChatPlan;
  dailyUsed: number;
  monthlyUsed: number;
  monthlyCostMicros: number;
}): ChatQuotaState {
  const limits = CHAT_LIMITS[input.plan];
  const base = {
    plan: input.plan,
    dailyUsed: input.dailyUsed,
    monthlyUsed: input.monthlyUsed,
    monthlyCostMicros: input.monthlyCostMicros,
    dailyLimit: limits.daily,
    monthlyLimit: limits.monthly,
    costCapMicros: limits.costMicros,
  };
  if (input.dailyUsed >= limits.daily) return { ...base, allowed: false, reason: "daily" };
  if (input.monthlyUsed >= limits.monthly) return { ...base, allowed: false, reason: "monthly" };
  if (input.monthlyCostMicros >= limits.costMicros) return { ...base, allowed: false, reason: "budget" };
  return { ...base, allowed: true, reason: "ok" };
}

async function readUsage(familyId: number, userId: string, start: Date): Promise<{ used: number; costMicros: number }> {
  const db = await getDb();
  if (!db) return { used: 0, costMicros: 0 };
  try {
    const [row] = await db
      .select({
        used: sql<number>`count(distinct coalesce(${llmCostEvents.requestId}, ${llmCostEvents.id}::text))`,
        costMicros: sql<number>`coalesce(sum(${llmCostEvents.costMicros}), 0)`,
      })
      .from(llmCostEvents)
      .where(and(
        eq(llmCostEvents.familyId, familyId),
        eq(llmCostEvents.userId, userId),
        eq(llmCostEvents.route, CHAT_ROUTE),
        gte(llmCostEvents.createdAt, start),
      ));
    return {
      used: Number(row?.used ?? 0),
      costMicros: Number(row?.costMicros ?? 0),
    };
  } catch (error) {
    console.warn("[chatQuota] usage read failed:", (error as Error)?.message || error);
    return { used: 0, costMicros: 0 };
  }
}

export async function getChatQuotaState(familyId: number, userId: string, plan: ChatPlan): Promise<ChatQuotaState> {
  const now = new Date();
  const [daily, monthly] = await Promise.all([
    readUsage(familyId, userId, startOfUtcDay(now)),
    readUsage(familyId, userId, startOfUtcMonth(now)),
  ]);
  return evaluateChatQuota({
    plan,
    dailyUsed: daily.used,
    monthlyUsed: monthly.used,
    monthlyCostMicros: monthly.costMicros,
  });
}
