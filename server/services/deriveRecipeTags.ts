/**
 * Deterministic derived tags for recipes.
 *
 * Stored in the separate `derived_tags` column (JSON string array) so the
 * user-facing `tags` column/UI and its 20-tag cap are untouched.
 *
 * First version is deliberately deterministic: no LLM call. If we cannot
 * recognise any food signal we return [] rather than guessing.
 */
import {
  detectCookingMethod,
  explicitProteinTags,
  type ProteinGroup,
} from "../utils/mealDiversity";
import { stripFoodTermNeutral, stripFoodTermNoise, VEGETABLE_NAME_RE } from "../utils/foodTermGuard";

export type DeriveRecipeTagsInput = {
  name?: string | null;
  ingredients?: unknown;
  difficulty?: string | null;
  cookTime?: number | null;
};

function parseIngredients(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function ingredientNames(ingredients: unknown[]): string {
  return ingredients
    .map((item: any) => (typeof item === "string" ? item : String(item?.name ?? item?.nameEn ?? "")))
    .filter(Boolean)
    .join(" ");
}

function difficultyTag(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (["easy", "簡單", "简单", "beginner", "1"].includes(raw)) return "difficulty:easy";
  if (["medium", "中等", "intermediate", "2"].includes(raw)) return "difficulty:medium";
  if (["hard", "困難", "困难", "advanced", "3"].includes(raw)) return "difficulty:hard";
  return null;
}

function timeTag(minutes: number | null | undefined): string | null {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n <= 20) return "time:quick";
  if (n <= 45) return "time:medium";
  return "time:long";
}

export function deriveRecipeTags(input: DeriveRecipeTagsInput): string[] {
  const name = String(input.name ?? "");
  const ingredients = parseIngredients(input.ingredients);
  const ingText = ingredientNames(ingredients);

  const rawText = `${name} ${ingText}`.trim();
  if (!rawText) return [];

  const guardedName = stripFoodTermNeutral(name);
  const guardedText = stripFoodTermNoise(rawText);

  const foodTags: string[] = [];
  const proteins: ProteinGroup[] = explicitProteinTags({ name: guardedName, ingredients });
  for (const protein of proteins) foodTags.push(`protein:${protein}`);
  // 菜心/南瓜/茄子/菇… 冇肉類規則命中時仍然標 veg。
  if (proteins.length === 0 && VEGETABLE_NAME_RE.test(guardedText)) foodTags.push("protein:veg");

  if (guardedName) {
    const method = detectCookingMethod({ name: guardedName });
    if (method) foodTags.push(`method:${method}`);
  }
  // Fallback for dishes whose method keyword lives in the ingredient text.
  if (!foodTags.some((tag) => tag.startsWith("method:")) && guardedText) {
    const method = detectCookingMethod({ name: guardedText });
    if (method) foodTags.push(`method:${method}`);
  }

  if (foodTags.length === 0) return [];

  const tags = [...foodTags];
  const diff = difficultyTag(input.difficulty);
  if (diff) tags.push(diff);
  const time = timeTag(input.cookTime);
  if (time) tags.push(time);

  return Array.from(new Set(tags));
}

export function serializeDerivedTags(tags: string[]): string {
  return JSON.stringify(tags);
}

export function parseDerivedTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Env gate: default OFF. */
export function isDerivedTagsEnabled(): boolean {
  const value = process.env.AI_CHEF_DERIVED_TAGS;
  return value === "1" || value === "true" || value === "on";
}

/**
 * Returns the JSON string to persist, or undefined when the flag is OFF.
 * The `derived_tags` DB default ('') is kept when undefined.
 */
export function maybeDerivedTags(input: DeriveRecipeTagsInput): string | undefined {
  if (!isDerivedTagsEnabled()) return undefined;
  return serializeDerivedTags(deriveRecipeTags(input));
}
