/**
 * Meal-plan recipe-ref validation and date-move transaction body.
 *
 * Pure helpers: the router supplies the real drizzle transaction, tests supply
 * an in-memory store.
 */
import { TRPCError } from "@trpc/server";
import { formatRecipeRef, parseRecipeRef, type RecipeRef } from "./recipeRef";

export type MealPlanRefKind = "canonical" | "invalid";

export interface MealPlanRefValidation {
  kind: MealPlanRefKind;
  value: string;
  reason?: string;
  ref: RecipeRef | null;
}

const CANONICAL_RE = /^(official|user)_([1-9][0-9]*)$/;
const COLON_RE = /^(official|user):/;

function invalid(value: string, reason: string): MealPlanRefValidation {
  return { kind: "invalid", value, reason, ref: null };
}

export function validateMealPlanRef(raw: unknown): MealPlanRefValidation {
  if (typeof raw !== "string") {
    return invalid("", "not_string");
  }
  if (raw === "") {
    return invalid(raw, "empty");
  }
  if (raw.length > 64) {
    return invalid(raw, "too_long");
  }
  if (raw.trim() !== raw) {
    return invalid(raw, "whitespace");
  }

  const canonical = CANONICAL_RE.exec(raw);
  if (canonical) {
    const ref = parseRecipeRef(raw);
    if (!ref) return invalid(raw, "id_out_of_range");
    return { kind: "canonical", value: formatRecipeRef(ref), ref };
  }

  // Legacy colon refs are never normalised: they are invalid on the wire.
  if (COLON_RE.test(raw)) {
    return invalid(raw, "colon_ref");
  }

  if (/^(official|user)_0(?:[0-9]+)?$/.test(raw) || /^0+[0-9]*$/.test(raw)) {
    return invalid(raw, "leading_zero");
  }
  if (/^[A-Z][A-Z0-9_]*$/.test(raw) || /^(OFFICIAL|USER)/.test(raw)) {
    return invalid(raw, "uppercase");
  }
  if (/^[0-9]+$/.test(raw)) {
    return invalid(raw, "bare_number");
  }

  return invalid(raw, "invalid_format");
}

export function resolveMealPlanRefOrThrow(raw: unknown): MealPlanRefValidation {
  const validation = validateMealPlanRef(raw);
  if (validation.kind === "invalid") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `invalid_recipe_ref: ${validation.reason}`,
    });
  }
  return validation;
}

export interface MealPlanBatchValidation {
  ok: boolean;
  validations: MealPlanRefValidation[];
  writes: string[];
  errors: Array<{ index: number; reason: string }>;
}

export function validateMealPlanRefBatch(
  raws: unknown[],
): MealPlanBatchValidation {
  const validations = raws.map((raw) => validateMealPlanRef(raw));
  const errors = validations
    .map((validation, index) => ({ validation, index }))
    .filter(({ validation }) => validation.kind === "invalid")
    .map(({ validation, index }) => ({ index, reason: validation.reason ?? "invalid_format" }));

  const ok = errors.length === 0;
  const writes = ok ? validations.map((validation) => validation.value) : [];
  return { ok, validations, writes, errors };
}

/**
 * Value to persist: canonical only. Throws BAD_REQUEST for anything invalid so
 * a caller can never accidentally persist a raw/invalid ref.
 */
export function mealPlanRefWriteValue(validation: MealPlanRefValidation): string {
  if (validation.kind !== "canonical" || !validation.ref) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `invalid_recipe_ref: ${validation.reason ?? "invalid_format"}`,
    });
  }
  return formatRecipeRef(validation.ref);
}

export interface MealPlanDateInput {
  familyId: number;
  planId: number;
  newDate: string;
  moveShoppingItems: boolean;
  shoppingDate?: string | null;
}

export interface UpdateDateTx {
  updatePlanDate(familyId: number, planId: number, newDate: string): Promise<void>;
  updateShoppingDateByPlanId(familyId: number, planId: number, plannedDate: string): Promise<void>;
}

export function validateBuyDate(newDate: string, shoppingDate?: string | null): void {
  const target = shoppingDate || newDate;
  if (target > newDate) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "購物日期不能遲過排餐日" });
  }
}

/**
 * Runs inside `db.transaction`. The caller throws away the whole transaction
 * when any step throws, so plan date and shopping dates can never diverge.
 */
export async function applyMealPlanDateUpdate(
  tx: UpdateDateTx,
  input: MealPlanDateInput,
): Promise<{ newDate: string }> {
  if (input.moveShoppingItems) {
    validateBuyDate(input.newDate, input.shoppingDate);
  }

  await tx.updatePlanDate(input.familyId, input.planId, input.newDate);

  if (input.moveShoppingItems) {
    const target = input.shoppingDate || input.newDate;
    await tx.updateShoppingDateByPlanId(input.familyId, input.planId, target);
  }

  return { newDate: input.newDate };
}
