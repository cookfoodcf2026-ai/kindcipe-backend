import { TRPCError } from "@trpc/server";

export const LIMIT_REACHED_ERROR_CODE = "LIMIT_REACHED";

export type LimitFeature = "custom_recipes" | "imports";

export interface LimitReachedDecision {
  ok: false;
  feature: LimitFeature;
  limit: number;
  used: number;
}

export type LimitDecision = { ok: true } | LimitReachedDecision;

/** Pure gate: `null` means the plan has no cap for this feature. */
export function evaluateLimit(
  feature: LimitFeature,
  used: number,
  limit: number | null
): LimitDecision {
  if (limit === null) return { ok: true };
  if (used < limit) return { ok: true };
  return { ok: false, feature, limit, used };
}

/**
 * Typed limit error. tRPC code stays FORBIDDEN so the message is not masked by
 * the global error formatter; the machine-readable subtype is the
 * `LIMIT_REACHED` message prefix plus `cause` (same pattern as PRO_REQUIRED).
 */
export function limitReachedError(decision: LimitReachedDecision): TRPCError {
  const label = decision.feature === "custom_recipes" ? "自訂食譜" : "匯入";
  return new TRPCError({
    code: "FORBIDDEN",
    message: `${LIMIT_REACHED_ERROR_CODE}: ${label}已達到本月上限（${decision.used}/${decision.limit}），升級方案可解鎖更多。`,
    cause: {
      code: LIMIT_REACHED_ERROR_CODE,
      feature: decision.feature,
      limit: decision.limit,
      used: decision.used,
    },
  });
}
