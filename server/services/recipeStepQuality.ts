export type GeneratedRecipeSteps = {
  ingredients?: { name?: string }[];
  steps?: unknown;
};

export type StepQualityResult = {
  ok: boolean;
  issues: string[];
};

const FORBIDDEN_STEP_MARKERS = ["{", "}", '"', "stepsEn", "stepsFil", "stepsId", "instruction"] as const;
// Ratios/times such as 1:1 or 10:30 are normal cooking text, not JSON key separators.
const RATIO_COLON_RE = /\d+\s*:\s*\d+/g;

export function hasJsonFragmentStepText(text: string): boolean {
  const lower = text.toLowerCase();
  if (FORBIDDEN_STEP_MARKERS.some((marker) => lower.includes(marker.toLowerCase()))) return true;
  return lower.replace(RATIO_COLON_RE, "").includes(":");
}

export function isStructurallyCorruptStepText(step: unknown): boolean {
  if (typeof step !== "string") return true;
  const text = step.trim();
  if (!text) return true;
  return hasJsonFragmentStepText(text);
}

/**
 * Write-boundary guard: reject JSON fragments/key names in steps. Cooking
 * quality (step count, length, verbs, seasoning) belongs to the prompt/eval,
 * not this runtime gate.
 */
export function validateGeneratedRecipeSteps(recipe: GeneratedRecipeSteps): StepQualityResult {
  const issues: string[] = [];
  if (!Array.isArray(recipe.steps)) {
    return { ok: false, issues: ["steps 必須係 string array"] };
  }
  recipe.steps.forEach((step, index) => {
    if (isStructurallyCorruptStepText(step)) {
      issues.push(`第 ${index + 1} 步含 JSON 碎片或非文字內容`);
    }
  });
  return { ok: issues.length === 0, issues };
}

export function filterValidGeneratedRecipes<T extends { steps?: unknown }>(recipes: T[]): T[] {
  return recipes.filter((recipe) => validateGeneratedRecipeSteps(recipe).ok);
}
