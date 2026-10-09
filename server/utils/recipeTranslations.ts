/**
 * Translation lifecycle helpers.
 *
 * Content is authored in one source language (Chinese). For every recipe we
 * want name / steps / description / ingredient-names available in
 * en / fil / id. Because content can be edited and translations can fail, we
 * treat target languages as a cache that is (re)filled whenever it is missing.
 *
 * `buildTranslationPatch()` returns a partial DB patch containing only the
 * missing target-language fields. Callers (create / update / on-demand read /
 * backfill) apply it. It is idempotent and only fills gaps, so it never
 * overwrites existing translations.
 */
import { translateRecipeContent, translateIngredientNames } from "./translateContent";

export type TranslatableRow = {
  name?: string | null;
  steps?: string | null;          // JSON string (array of strings/objects)
  description?: string | null;
  ingredients?: string | null;    // JSON string (array of {name,...})
  nameEn?: string | null;
  nameFil?: string | null;
  nameId?: string | null;
  descriptionEn?: string | null;
  descriptionFil?: string | null;
  descriptionId?: string | null;
  stepsEn?: string | null;
  stepsFil?: string | null;
  stepsId?: string | null;
};

function parseSteps(raw?: string | null): string[] {
  if (!raw) return [];
  let arr: unknown = raw;
  if (typeof arr === "string") {
    try { arr = JSON.parse(arr); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((s: any) => (typeof s === "string" ? s : String(s?.instruction ?? s?.text ?? s?.step ?? "")))
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseArray(raw?: string | null): any[] {
  if (!raw) return [];
  let arr: unknown = raw;
  if (typeof arr === "string") {
    try { arr = JSON.parse(arr); } catch { return []; }
  }
  return Array.isArray(arr) ? arr : [];
}

/**
 * Build a partial patch of missing translations. Returns {} when nothing is
 * missing (or when the LLM produces nothing). Never throws.
 */
export async function buildTranslationPatch(row: TranslatableRow): Promise<Record<string, string>> {
  const patch: Record<string, string> = {};
  const hasSourceName = !!String(row.name ?? "").trim();
  const stepsArr = parseSteps(row.steps);
  const ingredients = parseArray(row.ingredients);

  const missingName = hasSourceName && (!row.nameEn || !row.nameFil || !row.nameId);
  const missingSteps = stepsArr.length > 0 && (!row.stepsEn || !row.stepsFil || !row.stepsId);
  const missingDesc = !!String(row.description ?? "").trim() &&
    (!row.descriptionEn || !row.descriptionFil || !row.descriptionId);

  if (missingName || missingSteps || missingDesc) {
    const tr = await translateRecipeContent(
      row.name ?? "",
      stepsArr,
      row.description ?? undefined,
    );
    if (missingName) {
      if (!row.nameEn && tr.nameEn) patch.nameEn = tr.nameEn;
      if (!row.nameFil && tr.nameFil) patch.nameFil = tr.nameFil;
      if (!row.nameId && tr.nameId) patch.nameId = tr.nameId;
    }
    if (missingDesc) {
      if (!row.descriptionEn && tr.descriptionEn) patch.descriptionEn = tr.descriptionEn;
      if (!row.descriptionFil && tr.descriptionFil) patch.descriptionFil = tr.descriptionFil;
      if (!row.descriptionId && tr.descriptionId) patch.descriptionId = tr.descriptionId;
    }
    if (missingSteps) {
      if (!row.stepsEn && tr.stepsEn) patch.stepsEn = JSON.stringify(tr.stepsEn);
      if (!row.stepsFil && tr.stepsFil) patch.stepsFil = JSON.stringify(tr.stepsFil);
      if (!row.stepsId && tr.stepsId) patch.stepsId = JSON.stringify(tr.stepsId);
    }
  }

  const ingredientsMissing = ingredients.some(
    (i: any) => i && String(i.name ?? "").trim() && (!i.nameEn || !i.nameFil || !i.nameId),
  );
  if (ingredientsMissing) {
    const names = ingredients.map((i: any) => String(i?.name ?? "").trim());
    const trs = await translateIngredientNames(names);
    if (trs.length === ingredients.length) {
      const merged = ingredients.map((ing: any, i: number) => ({
        ...ing,
        nameEn: ing?.nameEn ?? trs[i]?.en,
        nameFil: ing?.nameFil ?? trs[i]?.fil,
        nameId: ing?.nameId ?? trs[i]?.id,
      }));
      patch.ingredients = JSON.stringify(merged);
    }
  }

  return patch;
}

/**
 * Return a JSON string of the ingredients array with bilingual names filled in
 * (only translates names that are missing en/fil/id). Falls back to the
 * original JSON if translation fails or the count mismatches.
 */
export async function withIngredientTranslations(ingredients: any): Promise<string> {
  const arr = Array.isArray(ingredients) ? ingredients : [];
  const needs = arr.some(
    (i: any) => i && String(i?.name ?? "").trim() && (!i.nameEn || !i.nameFil || !i.nameId),
  );
  if (!needs) return JSON.stringify(arr);
  const names = arr.map((i: any) => String(i?.name ?? "").trim());
  const trs = await translateIngredientNames(names);
  if (trs.length !== arr.length) return JSON.stringify(arr);
  return JSON.stringify(
    arr.map((ing: any, i: number) => ({
      ...ing,
      nameEn: ing?.nameEn ?? trs[i]?.en,
      nameFil: ing?.nameFil ?? trs[i]?.fil,
      nameId: ing?.nameId ?? trs[i]?.id,
    })),
  );
}
