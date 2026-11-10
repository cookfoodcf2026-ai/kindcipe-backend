/**
 * KOL (creator) recipe gate for meal-plan writes.
 *
 * Product rule: KOL recipes are viewable by free families, but adding one to a
 * meal plan is a Pro capability. A user's own recipes (sourceType
 * "user"/"imported"/"ai"/"manual") and official recipes are never gated.
 *
 * Pure: callers supply the resolved ref, its custom_recipes sourceType and the
 * family's Pro status. No DB, no I/O.
 */
import { TRPCError } from "@trpc/server";
import { parseRecipeRef, type RecipeRef } from "./recipeRef";

export const PRO_REQUIRED_ERROR_CODE = "PRO_REQUIRED";
export const PRO_REQUIRED_REASON = "pro_required";

export interface PlanItemGateInput {
  ref: RecipeRef;
  /** custom_recipes.source_type for `user_<n>` refs; null/undefined otherwise. */
  sourceType: string | null | undefined;
  isPro: boolean;
}

export type PlanItemGateDecision =
  | { ok: true; skipped: false; reason: null }
  | { ok: false; skipped: true; reason: typeof PRO_REQUIRED_REASON };

/** Only `user_<n>` rows whose sourceType is "kol" are gated, and only for free families. */
export function evaluatePlanItemGate(input: PlanItemGateInput): PlanItemGateDecision {
  const isKol = input.ref.type === "user" && input.sourceType === "kol";
  if (!isKol || input.isPro) {
    return { ok: true, skipped: false, reason: null };
  }
  return { ok: false, skipped: true, reason: PRO_REQUIRED_REASON };
}

export interface ShoppingRecipeGateInput {
  /** Canonical `official_<n>` / `user_<n>` ref carried by the shopping item. */
  fromRecipeId: string | null | undefined;
  /** custom_recipes.source_type for `user_<n>` refs; null/undefined otherwise. */
  sourceType: string | null | undefined;
  isPro: boolean;
}

/**
 * Same KOL rule as meal plans, applied to shopping ingredients. Official refs,
 * plain text items (no ref) and user/imported/AI recipes stay free.
 */
export function evaluateShoppingRecipeGate(
  input: ShoppingRecipeGateInput,
): PlanItemGateDecision {
  const ref = parseRecipeRef(input.fromRecipeId ?? null);
  if (!ref) {
    return { ok: true, skipped: false, reason: null };
  }
  return evaluatePlanItemGate({
    ref,
    sourceType: ref.type === "user" ? input.sourceType : null,
    isPro: input.isPro,
  });
}

/**
 * Typed error used by the single-item write path. Standard tRPC code
 * (FORBIDDEN) keeps the message unmasked; the machine-readable subtype is the
 * `PRO_REQUIRED` message prefix plus `cause.code` (same pattern as
 * EMAIL_NOT_VERIFIED / invalid_recipe_ref in this repo).
 */
export type ProRequiredContext = "plan" | "shopping";

export function proRequiredError(context: ProRequiredContext = "plan"): TRPCError {
  const where = context === "shopping" ? "加入購物清單" : "加入餐單";
  return new TRPCError({
    code: "FORBIDDEN",
    message: `${PRO_REQUIRED_ERROR_CODE}: 網紅食譜只限 Pro 用戶${where}。`,
    cause: { code: PRO_REQUIRED_ERROR_CODE, context },
  });
}

export function assertPlanItemGate(decision: PlanItemGateDecision, context: ProRequiredContext = "plan"): void {
  if (!decision.ok) throw proRequiredError(context);
}

export function isProRequiredError(error: unknown): boolean {
  if (!(error instanceof TRPCError)) return false;
  const causeCode = (error.cause as { code?: unknown } | undefined)?.code;
  return (
    causeCode === PRO_REQUIRED_ERROR_CODE ||
    error.message.startsWith(`${PRO_REQUIRED_ERROR_CODE}:`)
  );
}
