export type RecipeContentGate =
  | { ok: true }
  | { ok: false; missing: Array<"ingredients" | "steps">; message: string };

type IngredientLike = { name?: unknown };
type StepLike = string | { instruction?: unknown };

function hasIngredient(value: IngredientLike): boolean {
  return Array.isArray(value) ? false : String(value?.name ?? "").trim().length > 0;
}

function hasStep(value: StepLike): boolean {
  const text = typeof value === "string" ? value : value?.instruction;
  return String(text ?? "").trim().length > 0;
}

export function checkRecipeContent(
  ingredients: IngredientLike[] | null | undefined,
  steps: StepLike[] | null | undefined,
): RecipeContentGate {
  const missing: Array<"ingredients" | "steps"> = [];
  if (!Array.isArray(ingredients) || !ingredients.some(hasIngredient)) missing.push("ingredients");
  if (!Array.isArray(steps) || !steps.some(hasStep)) missing.push("steps");
  if (missing.length === 0) return { ok: true };
  const message = missing.length === 2
    ? "只抽到標題，請貼上材料同步驟。"
    : missing[0] === "ingredients"
      ? "只抽到標題，未讀到材料，請補上材料。"
      : "只抽到標題，未讀到步驟，請補上做法。";
  return { ok: false, missing, message };
}
