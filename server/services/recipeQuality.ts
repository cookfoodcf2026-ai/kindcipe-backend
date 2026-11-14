import { validateGeneratedRecipeSteps } from "./recipeStepQuality";

/**
 * Single source of truth for "is this recipe card good enough to show?".
 *
 * Before this module the same rule was copy-pasted across the Zod schema,
 * manual conversion, role validation and the final result filter. Soup and
 * dessert cards legitimately need 4 steps, every other AI dish needs 5, and
 * library recipes are trusted as-is (1 step). Keeping that in one place stops
 * the schema/prompt contradiction from silently dropping valid cards.
 */

export type RecipeQualityInput = {
  name?: unknown;
  ingredients?: unknown;
  steps?: unknown;
};

export type RecipeQualityContext = {
  /** "official" | "custom" | "library" are library recipes; anything else is AI. */
  source?: string | null;
  /** Requested role: "soup" | "dessert" | "meat" | ... */
  role?: string | null;
  /** Canonical dish type: "soup" | "dessert" | "meat" | ... */
  dishType?: string | null;
  /** Explicit override for deliberate leniency (e.g. truncated-JSON salvage). */
  minSteps?: number | null;
  /**
   * "salvage" = recovering cards from a truncated LLM response. Those cards are
   * already the best available output; showing 3 steps beats 0 cards + refund.
   * Never set this on the normal generation path.
   */
  path?: "salvage" | null;
};

export type QualityVerdict = {
  ok: boolean;
  steps: number;
  minSteps: number;
  reasons: string[];
};

const LIBRARY_SOURCES = new Set(["official", "custom", "library"]);
const SOUP_DESSERT_VALUES = new Set(["soup", "dessert"]);

function normalize(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isLibrarySource(source: string | null | undefined): boolean {
  return LIBRARY_SOURCES.has(normalize(source));
}

/**
 * library = 1 step; truncated-JSON salvage = 3; AI soup/dessert = 4;
 * everything else (AI main dish, missing role/dishType) = 5, the conservative
 * value. Salvage leniency is opt-in via ctx.path so normal generation is never
 * relaxed.
 */
export function minStepsFor(ctx: RecipeQualityContext = {}): number {
  if (typeof ctx.minSteps === "number" && Number.isFinite(ctx.minSteps) && ctx.minSteps > 0) {
    return ctx.minSteps;
  }
  if (isLibrarySource(ctx.source)) return 1;
  if (ctx.path === "salvage") return 3;
  if (SOUP_DESSERT_VALUES.has(normalize(ctx.role)) || SOUP_DESSERT_VALUES.has(normalize(ctx.dishType))) {
    return 4;
  }
  return 5;
}

export function countValidSteps(steps: unknown): number {
  if (!Array.isArray(steps)) return 0;
  return steps.filter((step) => typeof step === "string" && step.trim().length > 0).length;
}

function countIngredients(ingredients: unknown): number {
  if (!Array.isArray(ingredients)) return 0;
  return ingredients.filter((item) => {
    if (!item || typeof item !== "object") return false;
    return typeof (item as { name?: unknown }).name === "string" && (item as { name: string }).name.trim().length > 0;
  }).length;
}

export function qualityVerdict(recipe: RecipeQualityInput | null | undefined, ctx: RecipeQualityContext = {}): QualityVerdict {
  const reasons: string[] = [];
  const minSteps = minStepsFor(ctx);
  const steps = countValidSteps(recipe?.steps);
  const name = typeof recipe?.name === "string" ? recipe.name.trim() : "";

  if (name.length < 2) reasons.push(`name 少於 2 字（${name.length}）`);
  else if (name.length > 50) reasons.push(`name 超過 50 字（${name.length}）`);
  if (name === "未命名食譜") reasons.push("name 未命名");

  const minIngredients = isLibrarySource(ctx.source) ? 1 : 2;
  const ingredientCount = countIngredients(recipe?.ingredients);
  if (ingredientCount < minIngredients) {
    reasons.push(`ingredients ${ingredientCount} < ${minIngredients}`);
  }

  if (!Array.isArray(recipe?.steps)) {
    reasons.push("steps 必須係 string array");
  } else if (steps < minSteps) {
    reasons.push(`steps ${steps} < ${minSteps}`);
  }

  if (Array.isArray(recipe?.steps)) {
    const stepQuality = validateGeneratedRecipeSteps({ steps: recipe.steps });
    if (!stepQuality.ok) reasons.push(...stepQuality.issues);
  }

  return { ok: reasons.length === 0, steps, minSteps, reasons };
}

export function isDisplayableRecipe(recipe: RecipeQualityInput | null | undefined, ctx: RecipeQualityContext = {}): boolean {
  return qualityVerdict(recipe, ctx).ok;
}
