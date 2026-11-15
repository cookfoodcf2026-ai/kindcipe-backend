import { CATEGORY_TO_TERMS } from "./foodLexicon";

/**
 * Single source of truth for avoid/allergen matching.
 *
 * Phase A decision: a recipe is judged ONLY on its name + ingredients. The old
 * aiRecipe matcher also scanned description/tags/recipeCategory, which produced
 * false positives (e.g. 「魚香」 in a description killed a fish-free dish).
 * Allergen groups stay in chefAllergens.ts; they are passed in as `extras`.
 */
export const AVOID_MATCHER_VERSION = "unified_v1";

type AvoidRecipe = {
  name?: unknown;
  ingredients?: unknown;
};

export type AvoidSpec = {
  key: string;
  terms: string[];
  strip: string[];
};

export type AvoidHit = {
  key: string;
  term: string;
};

// Compounds that contain a meat/fish/egg/dairy character but are not that
// ingredient. Applied per avoid KEY (never globally): 「牛奶」 must still match
// avoid「奶」, while avoid「牛」 must ignore it.
const FALSE_FRIENDS: Record<string, string[]> = {
  牛: ["牛油果", "牛肝菌", "牛蒡", "牛至", "牛奶", "牛油", "奶油", "牛角包"],
  魚: ["魚腥草", "魚香", "木魚"],
  海鮮: ["魚香", "木魚", "魚腥草"],
  蛋: ["高蛋白", "蛋白質", "蛋白粉", "蛋白棒"],
  奶: ["燕麥奶", "椰奶", "豆奶"],
  雞: ["雞蛋", "鴨蛋", "鵪鶉蛋", "鹹蛋", "皮蛋", "蛋黃", "chicken of the woods"],
  鴨: ["鴨蛋", "鹹鴨蛋", "皮蛋"],
};

const KEY_ALIASES: Record<string, string> = {
  beef: "牛",
  pork: "豬",
  chicken: "雞",
  seafood: "海鮮",
  meat: "肉",
  fish: "魚",
  egg: "蛋",
  eggs: "蛋",
  milk: "奶",
  dairy: "奶",
  prawn: "蝦",
  shrimp: "蝦",
  crab: "蟹",
};

const AVOID_TERM_EXPANSIONS: Record<string, string[]> = {
  花生: ["花生", "peanut", "groundnut"],
  堅果: ["堅果", "果仁", "花生", "杏仁", "腰果", "核桃", "合桃", "榛子", "開心果", "almond", "cashew", "walnut", "pecan", "nut"],
  海鮮: ["海鮮", "魚", "蝦", "蟹", "蜆", "蠔", "魷魚", "章魚", "墨魚", "帶子", "海參", "鮑魚", "龍蝦", "青口", "扇貝", "seafood", "fish", "shrimp", "prawn", "crab", "squid", "oyster", "scallop"],
  甲殼類: ["蝦", "蟹", "龍蝦", "甲殼", "shrimp", "prawn", "crab", "lobster", "crustacean"],
  牛: ["牛", "牛肉", "beef", "steak", "veal"],
  豬: ["豬", "豬肉", "pork", "ham", "bacon", "sausage"],
  雞: ["雞", "雞肉", "chicken", "poultry"],
  魚: ["魚", "魚肉", "鱸魚", "三文魚", "鯇魚", "tuna", "salmon", "fish"],
  蛋: ["蛋", "雞蛋", "蛋黃", "蛋白", "egg"],
  奶: ["奶", "牛奶", "芝士", "牛油", "忌廉", "奶油", "乳酪", "milk", "cheese", "butter", "cream", "yogurt"],
  麩質: ["麵", "麵包", "麵粉", "意粉", "烏冬", "麥", "麩", "wheat", "flour", "bread", "pasta", "noodle", "gluten"],
  大豆: ["大豆", "黃豆", "豆腐", "豆乾", "豆皮", "腐竹", "豉油", "生抽", "老抽", "醬油", "soy", "tofu"],
  芝麻: ["芝麻", "sesame"],
};

function normalize(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/\s+/g, "");
}

function canonicalAvoidKey(raw: string): string {
  const key = String(raw ?? "").trim();
  return KEY_ALIASES[key.toLowerCase()] ?? key;
}

function strippedHaystack(haystack: string, key: string): string {
  const friends = FALSE_FRIENDS[key];
  if (!friends || friends.length === 0) return haystack;
  let out = haystack;
  for (const friend of [...friends].sort((a, b) => b.length - a.length)) {
    out = out.split(normalize(friend)).join(" ");
  }
  return out;
}

function termsForAvoidKey(key: string, extras?: Record<string, string[]>): string[] {
  const terms = new Set<string>();
  terms.add(key.toLowerCase());
  for (const term of AVOID_TERM_EXPANSIONS[key] ?? []) terms.add(term.toLowerCase());
  for (const term of CATEGORY_TO_TERMS[key] ?? []) terms.add(term.toLowerCase());
  for (const term of extras?.[key] ?? []) terms.add(term.toLowerCase());
  return [...terms].filter(Boolean);
}

export function buildAvoidSpecs(avoid: string[], extras?: Record<string, string[]>): AvoidSpec[] {
  const seen = new Set<string>();
  const specs: AvoidSpec[] = [];
  for (const raw of avoid) {
    const key = canonicalAvoidKey(String(raw ?? ""));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    specs.push({
      key,
      terms: termsForAvoidKey(key, extras),
      strip: FALSE_FRIENDS[key] ?? [],
    });
  }
  return specs;
}

/** Name + ingredients only. Description/tags/category are deliberately ignored. */
export function recipeAvoidText(recipe: AvoidRecipe): string {
  const ingredients = Array.isArray(recipe.ingredients)
    ? recipe.ingredients
        .map((ingredient: any) => typeof ingredient === "string" ? ingredient : ingredient?.name ?? "")
        .join(" ")
    : "";
  return normalize(`${recipe.name ?? ""} ${ingredients}`);
}

export function findAvoidHitsWithSpecs(recipe: AvoidRecipe, specs: AvoidSpec[]): AvoidHit[] {
  if (specs.length === 0) return [];
  const haystack = recipeAvoidText(recipe);
  if (!haystack) return [];
  const hits: AvoidHit[] = [];
  for (const spec of specs) {
    const cleaned = strippedHaystack(haystack, spec.key);
    const term = spec.terms.find((candidate) => candidate.length > 0 && cleaned.includes(candidate));
    if (term) hits.push({ key: spec.key, term });
  }
  return hits;
}

export function findAvoidHits(recipe: AvoidRecipe, avoid: string[], extras?: Record<string, string[]>): AvoidHit[] {
  return findAvoidHitsWithSpecs(recipe, buildAvoidSpecs(avoid, extras));
}

export function recipeContainsAvoid(recipe: AvoidRecipe, avoid: string[], extras?: Record<string, string[]>): boolean {
  if (avoid.length === 0) return false;
  return findAvoidHits(recipe, avoid, extras).length > 0;
}

export function filterCardsByAvoid<T extends AvoidRecipe>(recipes: T[], avoid: string[], extras?: Record<string, string[]>): T[] {
  if (avoid.length === 0) return recipes;
  const specs = buildAvoidSpecs(avoid, extras);
  return recipes.filter((recipe) => findAvoidHitsWithSpecs(recipe, specs).length === 0);
}

/**
 * Diagnostic only: what the unified matcher WOULD drop from these cards.
 * Never feed this back into filtering.
 */
export function summarizeAvoidShadow<T extends { name?: unknown; ingredients?: unknown }>(
  cards: T[],
  avoid: string[],
  extras?: Record<string, string[]>,
): {
  wouldDrop: number;
  wouldDropNames: string[];
  removedByTerm: Record<string, number>;
} {
  const specs = buildAvoidSpecs(avoid, extras);
  const wouldDropNames: string[] = [];
  const removedByTerm: Record<string, number> = {};
  let wouldDrop = 0;
  for (const card of cards) {
    const hits = findAvoidHitsWithSpecs(card, specs);
    if (hits.length === 0) continue;
    wouldDrop += 1;
    const name = String(card.name ?? "").trim();
    if (name && wouldDropNames.length < 5) wouldDropNames.push(name);
    for (const hit of hits) removedByTerm[hit.key] = (removedByTerm[hit.key] ?? 0) + 1;
  }
  return { wouldDrop, wouldDropNames, removedByTerm };
}
