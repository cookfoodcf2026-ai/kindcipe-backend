export type GeneratedRecipeSteps = {
  ingredients?: { name?: string }[];
  steps?: unknown;
};

export type StepQualityResult = {
  ok: boolean;
  issues: string[];
};

const MIN_STEPS = 4;
const MAX_STEPS = 8;
const MIN_STEP_CHARS = 15;
const MAX_STEP_CHARS = 80;
const BANNED_WHOLE_STEPS = new Set(["適量", "煮至熟", "調味即可"]);
const FORBIDDEN_STEP_MARKERS = ["{", "}", '"', "stepsEn", "stepsFil", "stepsId", "instruction"] as const;
// Colons are allowed in ratios/times such as 1:1 or 10:30; they are only a
// corruption signal when they are the JSON key separator (stepsEn": ...).
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
 * Deterministic hard gate for AI-generated recipe steps.
 *
 * Only objective, machine-checkable rules belong here. Cooking quality
 * (does the step contain a verb / heat / only listed ingredients?) is left to
 * the prompt and eval fixtures, not runtime heuristics.
 */
export function validateGeneratedRecipeSteps(recipe: GeneratedRecipeSteps): StepQualityResult {
  const issues: string[] = [];
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  const rawSteps = Array.isArray(recipe.steps) ? recipe.steps : null;

  if (ingredients.length < 2) issues.push("材料少於 2 項");
  if (!rawSteps) {
    issues.push("steps 必須係中文 string array");
    return { ok: false, issues };
  }

  const steps = rawSteps.map((step) => (typeof step === "string" ? step.trim() : ""));
  if (steps.length < MIN_STEPS || steps.length > MAX_STEPS) {
    issues.push(`步驟數目 ${steps.length}，必須 ${MIN_STEPS}–${MAX_STEPS} 步`);
  }

  steps.forEach((step, index) => {
    const stepNo = index + 1;
    if (typeof rawSteps[index] !== "string") {
      issues.push(`第 ${stepNo} 步唔係文字`);
      return;
    }
    if (!step) {
      issues.push(`第 ${stepNo} 步係空字串`);
      return;
    }
    const length = Array.from(step).length;
    if (length < MIN_STEP_CHARS || length > MAX_STEP_CHARS) {
      issues.push(`第 ${stepNo} 步 ${length} 字，必須 ${MIN_STEP_CHARS}–${MAX_STEP_CHARS} 字`);
    }
    if (BANNED_WHOLE_STEPS.has(step)) {
      issues.push(`第 ${stepNo} 步只係空泛字眼「${step}」`);
    }
    if (hasJsonFragmentStepText(step)) {
      issues.push(`第 ${stepNo} 步含 JSON 碎片或 JSON key`);
    }
  });

  return { ok: issues.length === 0, issues };
}
