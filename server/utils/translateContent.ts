import { invokeLLM, extractJSON } from "../_core/llm";

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
