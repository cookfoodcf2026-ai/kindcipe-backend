import {
  parseChefConstraints,
  type ChefDiet,
  type ChefNegative,
  type ChefProtein,
} from "./chefConstraints";

/**
 * Commit C1a: ONE decision object per user sentence, built on top of the
 * already-frozen `parseChefConstraints` contract. This layer is telemetry-only
 * for now: no response, served, credit or aiCards may read it.
 */
export type ChefConstraintLayer = {
  /** Protein wishes after negatives have been removed. */
  positives: ChefProtein[];
  negatives: ChefNegative[];
  diet: ChefDiet | null;
  maxMinutes: number | null;
  dishCount: number | null;
  /** 1 when the sentence asks for soup, otherwise 0. */
  soups: number;
  pantry: string[];
  namedDish: string | null;
  /** Original sentence with every negative clause removed. */
  positiveText: string;
};

export type ConstraintMatcherInput = {
  text: string;
  cookTimeMax?: number;
  avoidIngredients?: string[];
};

export type ConstraintDiffClass =
  | "same"
  | "new_subset"
  | "new_superset"
  | "disjoint"
  | "new_zero";

export type ConstraintShadow = {
  oldNames: string[];
  newNames: string[];
  oldServed: number;
  newServed: number;
  wouldZero: boolean;
  diffClass: ConstraintDiffClass;
  avoid: string[];
  positives: ChefProtein[];
  diet: ChefDiet | null;
  maxMinutes: number | null;
};

const NEGATIVE_CLAUSE_RE = /唔要|不要|唔好食|戒|避開|唔食|唔可以|敏感|過敏|忌口|唔想食|走(?!地)/;
const CLAUSE_SPLIT_RE = /[，,；;。但]/;

const PROTEIN_TEXT: Record<ChefProtein, string> = {
  pork: "豬",
  beef: "牛",
  chicken: "雞",
  fish: "魚",
  seafood: "海鮮",
  egg: "蛋",
  soy: "豆腐",
};

const NEGATIVE_AVOID_TEXT: Record<ChefNegative, string> = {
  spicy: "辣",
  pork: "豬",
  beef: "牛",
  chicken: "雞",
  seafood: "海鮮",
  dairy: "奶",
  nuts: "果仁",
};

function stripNegativeClauses(rawText: string): string {
  const clauses = String(rawText ?? "")
    .split(CLAUSE_SPLIT_RE)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0 && !NEGATIVE_CLAUSE_RE.test(clause));
  return clauses.join("，").trim();
}

export function buildChefConstraintLayer(rawText: string): ChefConstraintLayer {
  const parsed = parseChefConstraints(rawText);
  return {
    positives: [...parsed.proteins],
    negatives: [...parsed.negatives],
    diet: parsed.diet,
    maxMinutes: parsed.maxMinutes,
    dishCount: parsed.dishCount,
    soups: parsed.wantsSoup ? 1 : 0,
    pantry: [...parsed.pantry],
    namedDish: parsed.namedDish,
    positiveText: stripNegativeClauses(rawText),
  };
}

/** Terms that the unified avoid matcher must treat as hard negatives. */
export function constraintNegativeAvoidTerms(layer: ChefConstraintLayer): string[] {
  return [...new Set(layer.negatives.map((negative) => NEGATIVE_AVOID_TEXT[negative]))];
}

/**
 * Translate the decision object into the exact input shape accepted by the
 * existing `cardPassesHardConstraint` / unified avoid matcher. This keeps the
 * shadow comparison on the same matcher as production filtering.
 */
export function constraintMatcherInput(
  layer: ChefConstraintLayer,
  avoidIngredients: string[] = [],
): ConstraintMatcherInput {
  const positiveText = layer.positiveText.trim();
  // `cardPassesHardConstraint` recognises 素食 but not 純素/全素; feed the
  // generic word so vegan and vegetarian take the same meat red line.
  const dietText = layer.diet ? "素食" : "";
  const text = [positiveText, dietText].filter(Boolean).join(" ").trim();
  const avoid = [...new Set([
    ...avoidIngredients.filter((item) => String(item ?? "").trim().length > 0),
    ...constraintNegativeAvoidTerms(layer),
  ])];
  return {
    text,
    ...(layer.maxMinutes != null ? { cookTimeMax: layer.maxMinutes } : {}),
    ...(avoid.length > 0 ? { avoidIngredients: avoid } : {}),
  };
}

export function classifyConstraintDiff(oldNames: string[], newNames: string[]): ConstraintDiffClass {
  const oldSet = new Set(oldNames.filter(Boolean));
  const newSet = new Set(newNames.filter(Boolean));
  if (newSet.size === 0) return oldSet.size > 0 ? "new_zero" : "same";
  if (oldSet.size === newSet.size && [...newSet].every((name) => oldSet.has(name))) return "same";
  const newSubsetOld = [...newSet].every((name) => oldSet.has(name));
  if (newSubsetOld) return "new_subset";
  const oldSubsetNew = [...oldSet].every((name) => newSet.has(name));
  if (oldSubsetNew) return "new_superset";
  // The frozen contract has no "partial overlap" class; anything neither a
  // subset nor a superset is reported as disjoint/not comparable.
  return "disjoint";
}

function cardNames<T extends { name?: unknown }>(cards: T[]): string[] {
  return cards.map((card) => String(card?.name ?? "").trim()).filter(Boolean);
}

/**
 * Diagnostic only. `newCards` is produced by the injected matcher (the router
 * passes the real `cardPassesHardConstraint`), `oldCards` is the existing
 * filtered result. This function never mutates its inputs and its output is
 * only written to chef_query_log.slots.__debug.constraintShadow.
 */
export function computeConstraintShadow<T extends { name?: unknown }>(
  preFilterCards: T[],
  oldCards: T[],
  layer: ChefConstraintLayer,
  avoidIngredients: string[],
  passes: (card: T, input: ConstraintMatcherInput) => boolean,
): ConstraintShadow {
  const matcher = constraintMatcherInput(layer, avoidIngredients);
  const newCards = preFilterCards.filter((card) => passes(card, matcher));
  const oldNames = cardNames(oldCards);
  const newNames = cardNames(newCards);
  return {
    oldNames,
    newNames,
    oldServed: oldCards.length,
    newServed: newCards.length,
    wouldZero: oldCards.length > 0 && newCards.length === 0,
    diffClass: classifyConstraintDiff(oldNames, newNames),
    avoid: matcher.avoidIngredients ?? [],
    positives: [...layer.positives],
    diet: layer.diet,
    maxMinutes: layer.maxMinutes,
  };
}
