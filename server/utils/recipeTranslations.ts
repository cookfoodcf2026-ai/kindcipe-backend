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
    const merged = await localizeIngredientNames(ingredients);
    if (merged) patch.ingredients = JSON.stringify(merged);
  }

  return patch;
}

/**
 * Dictionary-first ingredient localization with per-item LLM fallback.
 * Never throws; returns null when nothing could be resolved.
 */
export async function localizeIngredientNames(ingredients: any[]): Promise<any[] | null> {
  const arr = Array.isArray(ingredients) ? [...ingredients] : [];
  if (arr.length === 0) return null;

  // 1) common-ingredient dictionary (free, consistent)
  try {
    const { resolveCommonIngredientByName } = await import("../db");
    for (let i = 0; i < arr.length; i++) {
      const ing = arr[i];
      const nm = String(ing?.name ?? "").trim();
      if (!nm) continue;
      if (ing.nameEn && ing.nameFil && ing.nameId) continue;
      try {
        const ci: any = await resolveCommonIngredientByName(nm);
        if (ci) {
          arr[i] = {
            ...ing,
            nameEn: ing.nameEn || ci.nameEn || undefined,
            nameFil: ing.nameFil || ci.nameFil || undefined,
            nameId: ing.nameId || ci.nameId || undefined,
          };
        }
      } catch { /* ignore per-item */ }
    }
  } catch { /* ignore dictionary */ }

  // 2) LLM batch for the still-missing names
  const still = arr
    .map((ing, i) => ({ ing, i }))
    .filter(({ ing }) => ing && String(ing.name ?? "").trim() && (!ing.nameEn || !ing.nameFil || !ing.nameId));
  if (still.length > 0) {
    try {
      const trs = await translateIngredientNames(still.map(({ ing }) => String(ing.name).trim()));
      if (trs.length === still.length) {
        still.forEach(({ i }, k) => {
          const t = trs[k] || {};
          const ing = arr[i];
          arr[i] = {
            ...ing,
            nameEn: ing.nameEn || t.en || undefined,
            nameFil: ing.nameFil || t.fil || undefined,
            nameId: ing.nameId || t.id || undefined,
          };
        });
      }
    } catch { /* ignore */ }
  }

  const anyFilled = arr.some((ing) => ing && (ing.nameEn || ing.nameFil || ing.nameId));
  return anyFilled ? arr : null;
}

/**
 * Return a JSON string of the ingredients array with bilingual names filled in
 * (dictionary-first, then per-item LLM fallback). Falls back to the original
 * JSON if nothing could be resolved.
 */
export async function withIngredientTranslations(ingredients: any): Promise<string> {
  const arr = Array.isArray(ingredients) ? ingredients : [];
  const needs = arr.some(
    (i: any) => i && String(i?.name ?? "").trim() && (!i.nameEn || !i.nameFil || !i.nameId),
  );
  if (!needs) return JSON.stringify(arr);
  const merged = await localizeIngredientNames(arr);
  return JSON.stringify(merged ?? arr);
}
