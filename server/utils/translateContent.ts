import { invokeLLM, extractJSON } from "../_core/llm";

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
    return {
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
    return clean.map((_, i) => {
      const it = items[i] || {};
      return { en: str(it.en), fil: str(it.fil), id: str(it.id) };
    });
  } catch (e) {
    console.warn("[translateIngredientNames] failed:", (e as Error)?.message);
    return [];
  }
}
