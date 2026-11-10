/**
 * KOL (creator) recipes are FREE for every plan since 2026-11-10 (owner
 * decision): free users can view, save, add to a meal plan and push their
 * ingredients to the shopping list.
 *
 * Rationale: three separate KOL gates (search / save / shopping) each shipped
 * with its own bug; one "always allow" rule removes the whole failure class.
 *
 * The helpers below are kept so call sites stay typed, but they never block.
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

/** Always allows. Kept for call-site compatibility. */
export function evaluatePlanItemGate(_input: PlanItemGateInput): PlanItemGateDecision {
  return { ok: true, skipped: false, reason: null };
}

export interface ShoppingRecipeGateInput {
  /** Canonical `official_<n>` / `user_<n>` ref carried by the shopping item. */
  fromRecipeId: string | null | undefined;
  /** custom_recipes.source_type for `user_<n>` refs; null/undefined otherwise. */
  sourceType: string | null | undefined;
  isPro: boolean;
}

/** Always allows. Kept for call-site compatibility. */
export function evaluateShoppingRecipeGate(
  input: ShoppingRecipeGateInput,
): PlanItemGateDecision {
  const ref = parseRecipeRef(input.fromRecipeId ?? null);
  if (!ref) return { ok: true, skipped: false, reason: null };
  return evaluatePlanItemGate({
    ref,
    sourceType: ref.type === "user" ? input.sourceType : null,
    isPro: input.isPro,
  });
}

export type ProRequiredContext = "plan" | "shopping";

/** Kept for parity with other typed errors; unused while KOL is free. */
export function proRequiredError(context: ProRequiredContext = "plan"): TRPCError {
  const where = context === "shopping" ? "加入購物清單" : "加入餐單";
  return new TRPCError({
    code: "FORBIDDEN",
    message: `${PRO_REQUIRED_ERROR_CODE}: 網紅食譜只限 Pro 用戶${where}。`,
    cause: { code: PRO_REQUIRED_ERROR_CODE, context },
  });
}

export function assertPlanItemGate(
  decision: PlanItemGateDecision,
  context: ProRequiredContext = "plan",
): void {
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
