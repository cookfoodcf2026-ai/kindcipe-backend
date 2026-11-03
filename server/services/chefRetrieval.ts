import { deriveRecipeFacets, deriveRecipeTags, type DerivedTagInput } from "./chefDerivedTags";
import type { ChefDishType, ChefMethod, ChefSlots } from "./chefSlots";

export type ChefLibraryRecipe = {
  id: string;
  name: string;
  ingredients: string[];
  tags: string[];
  dishType?: string;
  cookTime?: number;
  difficulty?: string;
  derivedTags?: string[];
  popularity?: number;
  visibility?: string;
  familyId?: number;
  raw?: unknown;
};

export type ChefRetrievalOptions = {
  count?: number;
  avoid?: string[];
};

export type ChefRetrievalResult = {
  cards: ChefLibraryRecipe[];
  relaxLevel: number;
  candidates: number;
  stageCandidates: number[];
  reason: string;
};

export const MAX_RELAX_LEVEL = 4;

function normalize(value: string): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s，,。！？!?、；;：:…·「」『』【】\[\]（）()]/g, "");
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [value];
    } catch {
      return value.split(/[,，、;；]+/).map((part) => part.trim()).filter(Boolean);
    }
  }
  return [];
}

/** Convert a DB row (or fixture row) into the retrieval shape. */
export function toChefLibraryRecipe(row: Record<string, unknown>): ChefLibraryRecipe {
  const source = row.source === "custom" ? "custom" : "official";
  const ingredients = Array.isArray(row.ingredients)
    ? row.ingredients.map((ingredient: any) => String(ingredient?.name ?? ingredient ?? "")).filter(Boolean)
    : [];
  const input: DerivedTagInput = {
    name: String(row.name ?? ""),
    description: String(row.description ?? ""),
    dishType: row.dishType == null ? undefined : String(row.dishType),
    recipeCategory: row.category == null ? String(row.recipeCategory ?? "") : String(row.category),
    cookTime: row.cookTime == null ? undefined : Number(row.cookTime),
    difficulty: row.difficulty == null ? undefined : String(row.difficulty),
    ingredients: ingredients.map((name) => ({ name })),
    steps: Array.isArray(row.steps) ? row.steps as string[] : [],
    tags: asStringArray(row.tags),
  };
  const existing = asStringArray(row.derivedTags);
  return {
    id: `${source}:${String(row.id ?? row.name ?? "")}`,
    name: String(row.name ?? ""),
    ingredients,
    tags: asStringArray(row.tags),
    ...(row.dishType == null ? {} : { dishType: String(row.dishType) }),
    ...(row.cookTime == null ? {} : { cookTime: Number(row.cookTime) }),
    ...(row.difficulty == null ? {} : { difficulty: String(row.difficulty) }),
    derivedTags: existing.length > 0 ? existing : deriveRecipeTags(input),
    popularity: Number(row.popularity ?? 50) || 50,
    visibility: String(row.visibility ?? source),
    familyId: Number(row.familyId ?? 0) || 0,
    raw: row,
  };
}

const TAG_RULES: Array<[RegExp, string[]]> = [
  [/清淡|清湯|清汤|少油|低脂|低卡|輕食|轻食|健康|少鹽|少盐|減肥|减肥|light|healthy/i, ["light", "healthy"]],
  [/辣|麻辣|辣椒|花椒|spicy|chilli|chili/i, ["spicy"]],
  [/小朋友|細路|儿童|兒童|親子|亲子|幼兒|幼儿|kids|children/i, ["kids"]],
  [/一鍋|一锅|電飯煲|电饭煲|電子鍋|电子锅|煲仔|燜|焖|炆|慢煮|壓力鍋|压力锅|one.?pot|rice.?cooker/i, ["one-pot", "ricecooker"]],
  [/高蛋白|蛋白質|蛋白质|增肌|健身|high.?protein/i, ["high-protein", "highProtein"]],
  [/宴客|大菜|喜慶|喜庆|節慶|节庆|招待|派對|派对|guest|party/i, ["guest"]],
  [/早餐|早點|早点|breakfast|brunch/i, ["breakfast"]],
  [/快煮|快手|快速|簡單|简单|quick|easy/i, ["quick"]],
  [/素食|吃素|食素|vegan|vegetarian/i, ["vegetarian"]],
];

/** Canonical tag keys implied by a raw user sentence (breakfast / spicy / kids / one-pot …). */
export function deriveTagsFromText(text: string): string[] {
  const hits: string[] = [];
  for (const [pattern, values] of TAG_RULES) {
    if (pattern.test(text)) hits.push(...values);
  }
  return [...new Set(hits)];
}

function tagKeysFor(slotTags: string[]): string[] {
  const keys: string[] = [];
  for (const raw of slotTags) {
    const tag = String(raw ?? "").trim();
    if (!tag) continue;
    const matched = TAG_RULES.filter(([pattern]) => pattern.test(tag)).flatMap(([, values]) => values);
    if (matched.length > 0) keys.push(...matched);
    else keys.push(normalize(tag));
  }
  return [...new Set(keys)];
}

function hasTags(recipe: ChefLibraryRecipe, keys: string[]): boolean {
  if (keys.length === 0) return true;
  const derived = new Set(recipe.derivedTags ?? []);
  const haystack = normalize([...recipe.tags, ...(recipe.derivedTags ?? [])].join(" "));
  return keys.some((key) =>
    derived.has(`tag:${key}`)
    || derived.has(`diet:${key}`)
    || haystack.includes(normalize(key)),
  );
}

function recipeText(recipe: ChefLibraryRecipe): string {
  return normalize(`${recipe.name} ${recipe.ingredients.join(" ")} ${recipe.tags.join(" ")}`);
}

function matchesKeyword(recipe: ChefLibraryRecipe, keyword?: string): boolean {
  if (!keyword) return true;
  const needle = normalize(keyword);
  if (!needle) return true;
  return normalize(recipe.name).includes(needle)
    || recipe.ingredients.some((ingredient) => normalize(ingredient).includes(needle));
}

function hasDerived(recipe: ChefLibraryRecipe, prefix: string): string[] {
  return (recipe.derivedTags ?? []).filter((tag) => tag.startsWith(prefix)).map((tag) => tag.slice(prefix.length));
}

function matchesProtein(recipe: ChefLibraryRecipe, protein?: ChefSlots["protein"]): boolean {
  if (!protein) return true;
  const proteins = new Set(hasDerived(recipe, "protein:"));
  const vegetarian = (recipe.derivedTags ?? []).includes("diet:vegetarian");
  if (protein === "seafood") return proteins.has("seafood") || proteins.has("fish");
  if (protein === "fish") return proteins.has("fish");
  if (protein === "egg") return proteins.has("egg");
  if (protein === "soy") return proteins.has("soy");
  if (protein === "veg") return vegetarian || proteins.has("veg") || normalize(recipe.dishType ?? "") === "vegetable";
  return proteins.has(protein);
}

function requiresVegetarian(slots: ChefSlots): boolean {
  return (slots.tags ?? []).some((tag) => /素食|吃素|食素|vegan|vegetarian/i.test(tag));
}

const NOODLE_NAME_RE = /麵|面|米線|米线|河粉|烏冬|乌冬|意粉|通粉|米粉|粉絲|粉丝|寬粉|宽粉|粿條|粿条|銀針粉|银针粉|noodle|ramen|udon|pasta/i;

/** Name-only shape check, shared with the router's constraint layer. */
export function matchesDishTypeName(name: string, dishType: string): boolean {
  const value = normalize(name);
  const N: Record<string, RegExp> = {
    noodle: NOODLE_NAME_RE,
    rice: /飯|饭|炒飯|炒饭|丼|rice/i,
    soup: /湯|汤|羹|soup|broth/i,
    stirfry: /炒|煎|爆炒|stir.?fry/i,
    steam: /蒸|steam/i,
    braise: /炆|燜|焖|燉|炖|滷|卤|紅燒|红烧|braise|stew/i,
    snack: /小食|小吃|點心|点心|甜品|糖水|snack|dessert/i,
  };
  const pattern = N[dishType];
  return pattern ? pattern.test(value) : true;
}

function matchesDishType(recipe: ChefLibraryRecipe, dishType?: ChefDishType): boolean {
  if (!dishType) return true;
  const value = normalize(recipe.dishType ?? "");
  const derived = new Set(hasDerived(recipe, "tag:"));
  // Shape must come from the dish NAME: ingredient text contains starch words
  // (生粉/粟粉/麵粉) that would otherwise make every dish look like a noodle.
  const name = normalize(recipe.name);
  if (dishType === "noodle") return derived.has("noodle") || NOODLE_NAME_RE.test(name);
  if (dishType === "rice") return derived.has("rice") || /飯|饭|炒飯|炒饭|丼|rice/i.test(name);
  if (dishType === "snack") return /appetizer|dessert|drink/.test(value) || derived.has("snack") || /小食|小吃|點心|点心|早餐|甜品|糖水|snack|dessert|breakfast/i.test(recipeText(recipe));
  if (dishType === "soup") return value === "soup" || derived.has("soup") || /湯|汤|羹|soup|broth/i.test(name);
  if (dishType === "steam") return derived.has("steam") || /蒸/i.test(recipeText(recipe));
  if (dishType === "stirfry") return /meat|seafood|vegetable|other/.test(value) || derived.has("stirfry") || /炒|煎|stir.?fry/i.test(recipeText(recipe));
  if (dishType === "braise") return derived.has("braise") || /炆|燜|焖|燉|炖|滷|卤|紅燒|红烧|braise|stew/i.test(recipeText(recipe));
  return true;
}

function matchesMethod(recipe: ChefLibraryRecipe, method?: ChefMethod): boolean {
  if (!method) return true;
  return (recipe.derivedTags ?? []).includes(`method:${method}`) || hasDerived(recipe, "tag:").includes(method);
}

function matchesDifficulty(recipe: ChefLibraryRecipe, difficulty?: string): boolean {
  if (!difficulty) return true;
  const value = normalize(recipe.difficulty ?? "");
  if (!value) return difficulty === "medium";
  if (difficulty === "easy") return /^easy$|簡單|简单|容易|初級|初级/.test(value);
  if (difficulty === "hard") return /^hard$|困難|困难|高級|高级|難|难/.test(value);
  return !/^easy$|^hard$|簡單|简单|困難|困难/.test(value);
}

function scoreRecipe(recipe: ChefLibraryRecipe, slots: ChefSlots, keys: string[], relaxLevel: number): number {
  let score = 0;
  if (slots.keyword && normalize(recipe.name).includes(normalize(slots.keyword))) score += 40;
  if (slots.protein && matchesProtein(recipe, slots.protein)) score += 35;
  if (relaxLevel < 2 && slots.dishType && matchesDishType(recipe, slots.dishType)) score += 50;
  if (relaxLevel < 3 && slots.method && matchesMethod(recipe, slots.method)) score += 30;
  if (relaxLevel < 1 && keys.length > 0) {
    const derived = new Set(recipe.derivedTags ?? []);
    const hits = keys.filter((key) => derived.has(`tag:${key}`) || derived.has(`diet:${key}`)).length;
    score += Math.min(45, hits * 15);
  }
  if (slots.difficulty && matchesDifficulty(recipe, slots.difficulty)) score += 10;
  // When the ask is for a proper dish (素食 / 清淡 / 高蛋白), mains should beat
  // desserts, snacks and sides. The reverse holds when 甜品/小食 is explicitly asked.
  const wantsDessert = keys.some((key) => key === "dessert" || key === "snack");
  const wantsMainDish = !wantsDessert
    && keys.some((key) => ["vegetarian", "light", "healthy", "high-protein", "kids", "quick", "one-pot"].includes(key));
  if (wantsMainDish) {
    const shape = `${recipe.dishType ?? ""} ${(recipe.tags ?? []).join(" ")}`;
    if (/蔬菜|vegetable|炒|stirfry|炆|braise|蒸|steam|湯|soup|meat|seafood/i.test(shape)) score += 18;
    if (/甜品|糖水|dessert|appetizer|小食|snack/i.test(shape)) score -= 25;
  }
  if (slots.maxMinutes && recipe.cookTime) score += Math.max(0, 10 - Math.abs(slots.maxMinutes - recipe.cookTime) / 10);
  score += Math.min(10, Math.max(0, (recipe.popularity ?? 50) / 10));
  return score;
}

function hardFilter(
  recipe: ChefLibraryRecipe,
  slots: ChefSlots,
  avoid: string[],
  relaxLevel: number,
): boolean {
  if (slots.maxMinutes && (!Number.isFinite(recipe.cookTime) || Number(recipe.cookTime) > slots.maxMinutes)) return false;
  // When the shape IS the ask (「想食粉麵」has no other facet), relaxing it away
  // yields random dishes; keep it hard at every relax level.
  const dishTypeIsTheAsk = Boolean(slots.dishType)
    && !slots.protein && !slots.keyword && !slots.method && (slots.tags?.length ?? 0) === 0;
  if (dishTypeIsTheAsk && !matchesDishType(recipe, slots.dishType)) return false;
  if (!matchesKeyword(recipe, slots.keyword)) return false;
  if (requiresVegetarian(slots) && !(recipe.derivedTags ?? []).includes("diet:vegetarian")) return false;
  if (relaxLevel < 3 && !matchesProtein(recipe, slots.protein)) return false;
  if (avoid.length > 0) {
    const haystack = recipeText(recipe);
    if (avoid.some((term) => normalize(term) && haystack.includes(normalize(term)))) return false;
  }
  return true;
}

/** Dietary tags are correctness; lifestyle tags (kids/quick/light/spicy) only rank. */
const HARD_TAGS = new Set(["vegetarian", "vegan", "high-protein"]);

function softFilter(recipe: ChefLibraryRecipe, slots: ChefSlots, keys: string[], relaxLevel: number): boolean {
  if (relaxLevel < 1) {
    const hardKeys = keys.filter((key) => HARD_TAGS.has(key));
    if (hardKeys.length > 0 && !hasTags(recipe, hardKeys)) return false;
    if (slots.difficulty && !matchesDifficulty(recipe, slots.difficulty)) return false;
  }
  if (relaxLevel < 2 && slots.dishType && !matchesDishType(recipe, slots.dishType)) return false;
  if (relaxLevel < 3 && slots.method && !matchesMethod(recipe, slots.method)) return false;
  return true;
}

/**
 * Deterministic retrieval with the required relax ladder:
 *   0 strict → 1 relax tags → 2 relax dishType → 3 relax protein → 4 popular pool.
 * maxMinutes, keyword and vegetarian remain hard at every level; they express
 * safety/correctness, not preference. Protein is relaxed only at level 3 and
 * the pipeline refuses to serve a mismatched protein card (it generates instead).
 */
export function retrieveChefCards(
  slots: ChefSlots,
  pool: ChefLibraryRecipe[],
  options: ChefRetrievalOptions = {},
): ChefRetrievalResult {
  if (!slots.wantsCards || pool.length === 0) {
    return { cards: [], relaxLevel: 0, candidates: 0, stageCandidates: [0, 0, 0, 0, 0], reason: "empty_pool" };
  }
  const keys = tagKeysFor(slots.tags ?? []);
  const avoid = options.avoid ?? [];
  const count = Math.max(1, Math.min(6, Math.round(options.count ?? 3)));
  const stageCandidates: number[] = [];

  for (let relaxLevel = 0; relaxLevel <= MAX_RELAX_LEVEL; relaxLevel++) {
    const eligible = pool.filter((recipe) =>
      hardFilter(recipe, slots, avoid, relaxLevel)
      && softFilter(recipe, slots, keys, relaxLevel),
    );
    stageCandidates.push(eligible.length);
    if (eligible.length === 0) continue;
    const ranked = [...eligible]
      .map((recipe) => ({ recipe, score: scoreRecipe(recipe, slots, keys, relaxLevel) }))
      .sort((a, b) => b.score - a.score
        || (Number(b.recipe.popularity ?? 0) - Number(a.recipe.popularity ?? 0))
        || a.recipe.id.localeCompare(b.recipe.id))
      .map((entry) => entry.recipe);
    const deduped: ChefLibraryRecipe[] = [];
    const names = new Set<string>();
    for (const recipe of ranked) {
      const key = normalize(recipe.name);
      if (!key || names.has(key)) continue;
      names.add(key);
      deduped.push(recipe);
      if (deduped.length >= count) break;
    }
    if (deduped.length > 0) {
      return {
        cards: deduped,
        relaxLevel,
        candidates: eligible.length,
        stageCandidates,
        reason: `relax_${relaxLevel}`,
      };
    }
  }

  return {
    cards: [],
    relaxLevel: MAX_RELAX_LEVEL,
    candidates: 0,
    stageCandidates,
    reason: "no_candidate",
  };
}

/** Re-check a generated card against the same hard slots before serving it. */
export function validateGeneratedCard(
  card: { name: string; cookTime?: number; ingredients?: Array<{ name?: string } | string>; tags?: string[]; dishType?: string; description?: string; steps?: string[] },
  slots: ChefSlots,
): boolean {
  const ingredientNames = (card.ingredients ?? []).map((ingredient) => typeof ingredient === "string" ? ingredient : String(ingredient?.name ?? ""));
  const derivedTags = deriveRecipeTags({
    name: card.name,
    description: card.description,
    dishType: card.dishType,
    cookTime: card.cookTime,
    ingredients: ingredientNames.map((name) => ({ name })),
    steps: card.steps,
    tags: card.tags,
  });
  const recipe: ChefLibraryRecipe = {
    id: "generated",
    name: card.name,
    ingredients: ingredientNames,
    tags: card.tags ?? [],
    dishType: card.dishType,
    cookTime: card.cookTime,
    difficulty: undefined,
    derivedTags,
  };
  if (!card.name || normalize(card.name).length < 2) return false;
  if (slots.maxMinutes && (!Number.isFinite(card.cookTime) || Number(card.cookTime) > slots.maxMinutes)) return false;
  if (!matchesKeyword(recipe, slots.keyword)) return false;
  if (!matchesProtein(recipe, slots.protein)) return false;
  if (requiresVegetarian(slots) && !derivedTags.includes("diet:vegetarian")) return false;
  return true;
}

export function facetsFor(recipe: ChefLibraryRecipe) {
  return deriveRecipeFacets({
    name: recipe.name,
    dishType: recipe.dishType,
    ingredients: recipe.ingredients.map((name) => ({ name })),
    tags: recipe.tags,
  });
}
