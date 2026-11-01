import { createHash } from "node:crypto";
import {
  groundIngredient,
  normalizeForMatch,
  stripTitleLines,
  type IngredientLike,
} from "./importGrounding";

export type WarningIngredient = IngredientLike & {
  quantity?: unknown;
  unit?: unknown;
  category?: unknown;
  grounded?: boolean;
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

export const AI_FILLED_TAG = "ai_filled";

export function isTextGroundingWarningEnabled(): boolean {
  const value = process.env.IMPORT_TEXT_GROUNDING_WARNING;
  return value === "1" || value === "true";
}

export interface PartitionedIngredients {
  grounded: WarningIngredient[];
  inferred: WarningIngredient[];
  total: number;
  blacklistHits: number;
}

export function partitionIngredients(
  ingredients: WarningIngredient[] | null | undefined,
  sourceText: string,
  name: string,
): PartitionedIngredients {
  const list = Array.isArray(ingredients) ? ingredients : [];
  const source = stripTitleLines(String(sourceText ?? ""), String(name ?? ""));
  const grounded: WarningIngredient[] = [];
  const inferred: WarningIngredient[] = [];
  let blacklistHits = 0;

  for (const ingredient of list) {
    const result = groundIngredient(ingredient, source);
    if (result.reason === "blacklist") {
      blacklistHits += 1;
      continue;
    }
    if (result.grounded) {
      grounded.push({ ...ingredient, grounded: true });
    } else {
      inferred.push({ ...ingredient, grounded: false });
    }
  }

  return {
    grounded,
    inferred,
    total: grounded.length + inferred.length,
    blacklistHits,
  };
}

export function buildImportWarning(
  ingredients: WarningIngredient[] | null | undefined,
  sourceText: string,
  name: string,
  stepsInferred?: boolean,
): ImportWarning | null {
  const list = Array.isArray(ingredients) ? ingredients : [];
  const partitioned = partitionIngredients(list, sourceText, name);
  const threshold = Math.max(2, Math.ceil(partitioned.total * 0.25));
  const ingredientWarn =
    partitioned.total === 0
      ? list.length > 0
      : partitioned.inferred.length >= threshold;
  const stepWarn = stepsInferred === true;

  if (!ingredientWarn && !stepWarn) return null;

  const code: ImportWarningCode =
    ingredientWarn && stepWarn
      ? "both"
      : ingredientWarn
        ? "ingredients_inferred"
        : "steps_inferred";

  return {
    code,
    totalIngredients: partitioned.total,
    groundedCount: partitioned.grounded.length,
    inferredCount: partitioned.inferred.length,
    inferredIngredients: partitioned.inferred,
    blacklistHits: partitioned.blacklistHits,
    shouldWarn: true,
    requiresAck: true,
    version: 1,
  };
}

export interface MergeInferredResult {
  ingredients: WarningIngredient[];
  addedInferred: number;
  conflicts: number;
  droppedOverCap: number;
}

function keysFor(ingredient: WarningIngredient): string[] {
  return [ingredient?.name, ingredient?.nameEn]
    .map((value) => normalizeForMatch(value))
    .filter(Boolean);
}

export function mergeInferredIngredients(
  groundedIngredients: WarningIngredient[] | null | undefined,
  inferredIngredients: WarningIngredient[] | null | undefined,
  cap = 50,
): MergeInferredResult {
  const ingredients = (Array.isArray(groundedIngredients) ? groundedIngredients : []).map(
    (ingredient) => ({ ...ingredient, grounded: true }),
  );
  const seen = new Set<string>();
  for (const ingredient of ingredients) {
    for (const key of keysFor(ingredient)) seen.add(key);
  }

  const maxInferred = Math.max(0, Math.floor(cap));
  let addedInferred = 0;
  let conflicts = 0;
  let droppedOverCap = 0;

  for (const ingredient of Array.isArray(inferredIngredients) ? inferredIngredients : []) {
    if (addedInferred >= maxInferred) {
      droppedOverCap += 1;
      continue;
    }
    const keys = keysFor(ingredient);
    if (keys.some((key) => seen.has(key))) {
      conflicts += 1;
      continue;
    }
    ingredients.push({ ...ingredient, grounded: false });
    for (const key of keys) seen.add(key);
    addedInferred += 1;
  }

  return { ingredients, addedInferred, conflicts, droppedOverCap };
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
