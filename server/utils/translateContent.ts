import { invokeLLM, extractJSON } from "../_core/llm";

// Small in-process caches. AI Chef often reuses the same dish across a meal /
// chat session; without this, every non-Chinese request re-translates it.
const RECIPE_CACHE = new Map<string, Record<string, unknown>>();
const RECIPE_CACHE_MAX = 400;
const INGREDIENT_CACHE = new Map<string, Array<{ en?: string; fil?: string; id?: string }>>();
const INGREDIENT_CACHE_MAX = 600;

function cacheGet<T>(map: Map<string, T>, key: string): T | undefined {
  const hit = map.get(key);
  if (hit === undefined) return undefined;
  // LRU refresh
  map.delete(key);
  map.set(key, hit);
  return hit;
}

function cacheSet<T>(map: Map<string, T>, key: string, value: T, max: number) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const first = map.keys().next().value;
    if (first === undefined) break;
    map.delete(first);
  }
}

/**
 * Translate a recipe (name + steps + description + ingredient names) from ANY
 * source language into Traditional Chinese (the app's canonical base).
 * Returns {} on failure (never throws).
 */
export async function translateToChinese(
  name: string,
  steps: string[],
  description: string | undefined,
  ingredientNames: string[],
  srcLang: string,
): Promise<{ name?: string; description?: string; steps?: string[]; ingredientNames?: string[] }> {
  try {
    const hasDesc = typeof description === "string" && description.trim().length > 0;
    const prompt = `Translate the following recipe from ${srcLang} into Traditional Chinese (繁體中文).
Return ONLY JSON: {"name":"...","description":"...","steps":["..."],"ingredientNames":["..."]}
Keep the SAME number and order of steps and ingredientNames. Keep quantities/times.
Terminology (use these EXACT Chinese terms when they appear): silver pin noodles = 銀針粉; ho fun / flat rice noodles = 河粉; rice vermicelli = 米粉; rice noodles = 河粉 (never 銀針粉 unless "silver pin").
Dish name: ${name}${hasDesc ? `\nDescription: ${description}` : ""}
Steps: ${JSON.stringify(steps)}
Ingredients: ${JSON.stringify(ingredientNames)}`;
    const resp = await invokeLLM({
      messages: [{ role: "user", content: prompt }],
      maxTokens: 2600,
      temperature: 0.2,
      timeoutMs: 30000,
      responseFormat: { type: "json_object" },
    });
    const raw = resp.choices?.[0]?.message?.content || "{}";
    const p: any = extractJSON(raw);
    const arr = (v: any) => (Array.isArray(v) ? v.map((x: any) => String(x)) : undefined);
    return {
      name: p?.name ? String(p.name) : undefined,
      description: p?.description ? String(p.description) : undefined,
      steps: arr(p?.steps),
      ingredientNames: arr(p?.ingredientNames),
    };
  } catch (e) {
    console.warn("[translateToChinese] failed:", (e as Error)?.message);
    return {};
  }
}

/**
 * Translate a recipe dish name + cooking steps into English / Filipino / Indonesian.
 * Shared by the URL-import / KOL pipeline and the AI Edit pipeline (fallback).
 * Returns {} on failure (never throws).
 */
export async function translateRecipeContent(
  name: string,
  steps: string[],
  description?: string
): Promise<{
  nameEn?: string;
  nameFil?: string;
  nameId?: string;
  descriptionEn?: string;
  descriptionFil?: string;
  descriptionId?: string;
  stepsEn?: string[];
  stepsFil?: string[];
  stepsId?: string[];
}> {
  const cacheKey = JSON.stringify([name, steps, description ?? ""]);
  const cached = cacheGet(RECIPE_CACHE, cacheKey);
  if (cached) return cached as any;
  try {
    const hasDesc = typeof description === "string" && description.trim().length > 0;
    const prompt = `Translate this recipe content into (1) English, (2) Filipino, (3) Indonesian.
Return ONLY JSON, no extra text, exactly: {"nameEn":"...","nameFil":"...","nameId":"..."${hasDesc ? ',"descriptionEn":"...","descriptionFil":"...","descriptionId":"..."' : ""},"stepsEn":["..."],"stepsFil":["..."],"stepsId":["..."]}
Keep the SAME number and order of steps. Keep quantities/times.
Dish name: ${name}${hasDesc ? `\nDescription: ${description}` : ""}
Steps: ${JSON.stringify(steps)}`;
    const resp = await invokeLLM({
      messages: [{ role: "user", content: prompt }],
      maxTokens: 2600,
      temperature: 0.2,
      timeoutMs: 30000,
      responseFormat: { type: "json_object" },
    });
    const raw = resp.choices?.[0]?.message?.content || "{}";
    const p: any = extractJSON(raw);
    const arr = (v: any) => (Array.isArray(v) ? v.map((x: any) => String(x)) : undefined);
    const str = (v: any) => (v ? String(v) : undefined);
    const out = {
      nameEn: str(p?.nameEn),
      nameFil: str(p?.nameFil),
      nameId: str(p?.nameId),
      descriptionEn: str(p?.descriptionEn),
      descriptionFil: str(p?.descriptionFil),
      descriptionId: str(p?.descriptionId),
      stepsEn: arr(p?.stepsEn),
      stepsFil: arr(p?.stepsFil),
      stepsId: arr(p?.stepsId),
    };
    if (Object.values(out).some((v) => v !== undefined)) cacheSet(RECIPE_CACHE, cacheKey, out, RECIPE_CACHE_MAX);
    return out;
  } catch (e) {
    console.warn("[translateRecipeContent] failed:", (e as Error)?.message);
    return {};
  }
}

/**
 * Translate a list of ingredient names into English / Filipino / Indonesian.
 * Returns an array in the SAME order/length as input (entries may be empty on
 * partial failure). Returns [] only when the whole call fails.
 */
export async function translateIngredientNames(
  names: string[]
): Promise<Array<{ en?: string; fil?: string; id?: string }>> {
  const clean = names.map((n) => String(n ?? "").trim());
  if (clean.length === 0) return [];
  const cacheKey = JSON.stringify(clean);
  const cached = cacheGet(INGREDIENT_CACHE, cacheKey);
  if (cached) return cached;
  try {
    const prompt = `Translate each ingredient name into English, Filipino, and Indonesian.
Return ONLY JSON of the exact shape {"items":[{"en":"...","fil":"...","id":"..."}]} with the SAME number and order as the input array.
Keep brand names / untranslatable terms as-is.
Input: ${JSON.stringify(clean)}`;
    const resp = await invokeLLM({
      messages: [{ role: "user", content: prompt }],
      maxTokens: 2000,
      temperature: 0.2,
      timeoutMs: 30000,
      responseFormat: { type: "json_object" },
    });
    const raw = resp.choices?.[0]?.message?.content || "{}";
    const p: any = extractJSON(raw);
    const items: any[] = Array.isArray(p?.items) ? p.items : [];
    const str = (v: any) => (v ? String(v) : undefined);
    const out = clean.map((_, i) => {
      const it = items[i] || {};
      return { en: str(it.en), fil: str(it.fil), id: str(it.id) };
    });
    if (out.some((x) => x.en || x.fil || x.id)) cacheSet(INGREDIENT_CACHE, cacheKey, out, INGREDIENT_CACHE_MAX);
    return out;
  } catch (e) {
    console.warn("[translateIngredientNames] failed:", (e as Error)?.message);
    return [];
  }
}

const TARGET_LANG_NAMES: Record<string, string> = {
  en: "English",
  fil: "Filipino",
  id: "Indonesian",
};
const TARGET_RECIPE_CACHE = new Map<string, { name?: string; description?: string; steps?: string[] }>();
const TARGET_RECIPE_CACHE_MAX = 600;

export async function translateRecipesForLang(
  recipes: Array<{ name: string; description?: string; steps: string[] }>,
  lang: "en" | "fil" | "id"
): Promise<Array<{ name?: string; description?: string; steps?: string[] }>> {
  if (recipes.length === 0) return [];
  const out: Array<{ name?: string; description?: string; steps?: string[] }> = new Array(recipes.length);
  const missing: Array<{ index: number; name: string; description?: string; steps: string[]; key: string }> = [];
  for (let i = 0; i < recipes.length; i++) {
    const rec = recipes[i];
    const key = JSON.stringify([lang, rec.name, rec.description ?? "", rec.steps]);
    const cached = cacheGet(TARGET_RECIPE_CACHE, key);
    if (cached) out[i] = cached;
    else missing.push({ index: i, ...rec, key });
  }
  if (missing.length === 0) return out;

  try {
    const target = TARGET_LANG_NAMES[lang];
    const payload = missing.map((m) => ({
      name: m.name,
      ...(m.description ? { description: m.description } : {}),
      steps: m.steps,
    }));
    const prompt = `Translate each recipe into ${target}. Return ONLY JSON exactly {"items":[{"name":"...","description":"...","steps":["..."]}]} with the SAME number and order as the input. Keep quantities/times. If an input has no description, omit description. Do not add any other language.
Input: ${JSON.stringify(payload)}`;
    const resp = await invokeLLM({
      messages: [{ role: "user", content: prompt }],
      maxTokens: 3200,
      temperature: 0.1,
      timeoutMs: 20000,
      responseFormat: { type: "json_object" },
    });
    const raw = resp.choices?.[0]?.message?.content || "{}";
    const parsed: any = extractJSON(raw);
    const items: any[] = Array.isArray(parsed?.items) ? parsed.items : [];
    for (let i = 0; i < missing.length; i++) {
      const m = missing[i];
      const item = items[i];
      if (!item || typeof item !== "object") continue;
      const steps = Array.isArray(item.steps) ? item.steps.map((s: any) => String(s)) : undefined;
      const value = {
        name: item.name ? String(item.name) : undefined,
        description: item.description ? String(item.description) : undefined,
        steps,
      };
      out[m.index] = value;
      if (value.name || value.description || value.steps?.length) {
        cacheSet(TARGET_RECIPE_CACHE, m.key, value, TARGET_RECIPE_CACHE_MAX);
      }
    }
  } catch (e) {
    console.warn("[translateRecipesForLang] failed:", (e as Error)?.message);
  }
  return out;
}
