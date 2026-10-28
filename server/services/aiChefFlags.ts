import { and, eq } from "drizzle-orm";
import { getDb, getFamilySubscription } from "../db";
import { aiChefFlags } from "../../drizzle/schema";
import { getPromoState } from "./promo";

export type AiChefMode = "normal" | "library_only" | "disabled";

export const AI_CHEF_CAP_MICROS = {
  standard_monthly: 2_200_000,
  standard_yearly: 1_700_000,
  founding_monthly: 1_450_000,
  founding_yearly: 1_250_000,
  free: 150_000,
  trial: 600_000,
} as const;

const cache = new Map<string, { at: number; mode: AiChefMode; flags: Record<string, boolean> }>();
const CACHE_MS = 30_000;

function flagDefault(name: string, fallback: boolean): boolean {
  const env = process.env[name.toUpperCase()];
  if (env === undefined) return fallback;
  return env !== "0" && env !== "false";
}

export function getFeatureFlags(): Record<string, boolean> {
  return {
    ai_chef_library_first: flagDefault("AI_CHEF_LIBRARY_FIRST", true),
    ai_chef_multi_role: flagDefault("AI_CHEF_MULTI_ROLE", true),
    ai_chef_source_labels: flagDefault("AI_CHEF_SOURCE_LABELS", true),
    ai_chef_free_no_ai: flagDefault("AI_CHEF_FREE_NO_AI", false),
    ai_chef_hard_cap: flagDefault("AI_CHEF_HARD_CAP", true),
    ai_chef_safe_mode: flagDefault("AI_CHEF_SAFE_MODE", false),
    ai_chef_truthful_contract: flagDefault("AI_CHEF_TRUTHFUL_CONTRACT", false),
    ai_chef_client_message_id: flagDefault("AI_CHEF_CLIENT_MESSAGE_ID", false),
  };
}

export async function getAiChefMode(familyId?: number): Promise<{ mode: AiChefMode; flags: Record<string, boolean> }> {
  const key = familyId ? `f:${familyId}` : "global";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return { mode: hit.mode, flags: hit.flags };
  const flags = getFeatureFlags();
  if (flags.ai_chef_safe_mode) return { mode: "library_only", flags };
  const db = await getDb();
  if (!db) return { mode: "normal", flags };
  try {
    let row: typeof aiChefFlags.$inferSelect | undefined;
    if (familyId) {
      [row] = await db.select().from(aiChefFlags)
        .where(and(eq(aiChefFlags.scope, "family"), eq(aiChefFlags.familyId, familyId))).limit(1);
    }
    if (!row) {
      [row] = await db.select().from(aiChefFlags)
        .where(and(eq(aiChefFlags.scope, "global"), eq(aiChefFlags.familyId, 0))).limit(1);
    }
    const mode = (row?.mode === "library_only" || row?.mode === "disabled") ? row.mode : "normal";
    const merged = { ...flags, ...(row?.flags as Record<string, boolean> | undefined) };
    cache.set(key, { at: Date.now(), mode, flags: merged });
    return { mode, flags: merged };
  } catch {
    return { mode: "normal", flags };
  }
}

/** Resolve the internal USD cap from plan + billing interval + founding tier. */
export async function getAiChefCapMicros(familyId: number, userId: string): Promise<{ family: number; member: number; tier: string }> {
  const sub = await getFamilySubscription(familyId);
  if (!sub) return { family: AI_CHEF_CAP_MICROS.free, member: Math.round(AI_CHEF_CAP_MICROS.free * 0.6), tier: "free" };
  if (sub.status === "free") {
    return { family: AI_CHEF_CAP_MICROS.free, member: Math.round(AI_CHEF_CAP_MICROS.free * 0.6), tier: "free" };
  }
  if (sub.status === "trial") {
    return { family: AI_CHEF_CAP_MICROS.trial, member: Math.round(AI_CHEF_CAP_MICROS.trial * 0.6), tier: "trial" };
  }
  const promo = await getPromoState(familyId, userId).catch(() => null);
  const founding = promo?.priceTier === "founding";
  const yearly = String((sub as any).subscriptionPlan ?? "").toLowerCase() === "yearly";
  const family = founding
    ? yearly ? AI_CHEF_CAP_MICROS.founding_yearly : AI_CHEF_CAP_MICROS.founding_monthly
    : yearly ? AI_CHEF_CAP_MICROS.standard_yearly : AI_CHEF_CAP_MICROS.standard_monthly;
  return { family, member: Math.round(family * 0.6), tier: founding ? "founding" : "standard" };
}

export function clearAiChefFlagCache(): void {
  cache.clear();
}
