const CJK = /[\u3400-\u9FFF\uF900-\uFAFF]/;

export type RecipeTranslationFields = {
  nameEn?: string | null;
  nameFil?: string | null;
  nameId?: string | null;
  descriptionEn?: string | null;
  descriptionFil?: string | null;
  descriptionId?: string | null;
  stepsEn?: unknown;
  stepsFil?: unknown;
  stepsId?: unknown;
};

export class RecipeTranslationGuardError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Unsafe recipe translation: ${issues.join("; ")}`);
    this.name = "RecipeTranslationGuardError";
    this.issues = issues;
  }
}

function stepTexts(value: unknown): string[] {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return stepTexts(parsed);
    } catch { /* plain text */ }
    return [value];
  }
  if (!Array.isArray(value)) return value ? [String(value)] : [];
  return value.map((step) => typeof step === "string" ? step : String((step as any)?.instruction ?? (step as any)?.text ?? step ?? ""));
}

export function findUnsafeRecipeTranslations(fields: RecipeTranslationFields): string[] {
  const issues: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!key.endsWith("En") || value == null) continue;
    const texts = key === "stepsEn" ? stepTexts(value) : [String(value)];
    if (texts.some((text) => CJK.test(text))) issues.push(`${key} contains CJK`);
  }

  const en = String(fields.nameEn ?? "").trim();
  if (en.length > 8) {
    const fil = String(fields.nameFil ?? "").trim();
    const id = String(fields.nameId ?? "").trim();
    if (fil && fil === en) issues.push("nameFil equals nameEn (length > 8)");
    if (id && id === en) issues.push("nameId equals nameEn (length > 8)");
  }
  return issues;
}

export function assertSafeRecipeTranslations(fields: RecipeTranslationFields): void {
  const issues = findUnsafeRecipeTranslations(fields);
  if (issues.length > 0) throw new RecipeTranslationGuardError(issues);
}
