import { createHash } from "node:crypto";
import {
  analyzeGrounding,
  type IngredientLike,
} from "./importGrounding";

export type WarningIngredient = IngredientLike & {
  quantity?: unknown;
  unit?: unknown;
  category?: unknown;
};

export type ImportWarningCode =
  | "ingredients_inferred"
  | "steps_inferred"
  | "both";

export interface ImportWarning {
  code: ImportWarningCode;
  totalIngredients: number;
  groundedCount: number;
  inferredCount: number;
  inferredIngredients: WarningIngredient[];
  blacklistHits: number;
  shouldWarn: boolean;
  requiresAck: boolean;
  version: 1;
}

export function buildImportWarning(
  ingredients: WarningIngredient[] | null | undefined,
  sourceText: string,
  name: string,
  stepsInferred?: boolean,
): ImportWarning | null {
  const list = Array.isArray(ingredients) ? ingredients : [];
  const analysis = analyzeGrounding(list, sourceText, name, stepsInferred);
  const ingredientWarn = analysis.shouldWarnIngredients;
  const stepWarn = stepsInferred === true;

  if (!ingredientWarn && !stepWarn) return null;

  const inferredIngredients = analysis.inferredIndexes
    .map((index) => list[index])
    .filter((ingredient): ingredient is WarningIngredient => Boolean(ingredient));

  const code: ImportWarningCode =
    ingredientWarn && stepWarn
      ? "both"
      : ingredientWarn
        ? "ingredients_inferred"
        : "steps_inferred";

  return {
    code,
    totalIngredients: analysis.total,
    groundedCount: analysis.groundedCount,
    inferredCount: inferredIngredients.length,
    inferredIngredients,
    blacklistHits: analysis.blacklistHits,
    shouldWarn: true,
    requiresAck: true,
    version: 1,
  };
}

function text(value: unknown): string {
  return String(value ?? "").normalize("NFKC").trim();
}

function canonicalIngredient(ingredient: WarningIngredient): Record<string, string> {
  return {
    name: text(ingredient?.name),
    nameEn: text(ingredient?.nameEn),
    nameFil: text(ingredient?.nameFil),
    nameId: text(ingredient?.nameId),
    quantity: text(ingredient?.quantity),
    unit: text(ingredient?.unit),
    category: text(ingredient?.category),
  };
}

function canonicalList(ingredients: WarningIngredient[] | null | undefined): string[] {
  return (Array.isArray(ingredients) ? ingredients : [])
    .map((ingredient) => JSON.stringify(canonicalIngredient(ingredient)))
    .sort();
}

export function computeParseToken(
  groundedIngredients: WarningIngredient[] | null | undefined,
  inferredIngredients: WarningIngredient[] | null | undefined,
): string {
  const payload = JSON.stringify({
    version: 1,
    grounded: canonicalList(groundedIngredients),
    inferred: canonicalList(inferredIngredients),
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
