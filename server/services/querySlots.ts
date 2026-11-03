/**
 * AI Chef query slot parser (intent layer, deterministic validation).
 *
 * The LLM only extracts structured slots. All false-positive guards, hard
 * constraints and soft ranking are deterministic server-side code.
 *
 * Cache: normalized text → translation_cache (kind="query_slots") plus a small
 * in-process L1. Same normalized text therefore calls the LLM at most once.
 */
import { invokeLLM, extractJSON } from "../_core/llm";
import { getTranslationCache, setTranslationCache, translationCacheKey } from "./translationCache";
import { guardDishTypeByName, type DishKind } from "../utils/dishType";
import { COOKING_METHODS, explicitProteinTags, proteinTags, cookingMethod, type CookingMethod, type ProteinGroup } from "../utils/mealDiversity";
import { findFoodTermPattern, matchesByTermName, matchesByTermIngredient } from "../utils/foodTermMap";
import { isGenericDishTerm, stripFoodTermNeutral, stripFoodTermNoise, VEGETABLE_NAME_RE } from "../utils/foodTermGuard";

export type QuerySlots = {
  foodTerm: string | null;
  protein: ProteinGroup | null;
  dishType: DishKind | null;
  method: CookingMethod | null;
  maxMinutes: number | null;
  difficulty: "easy" | "medium" | "hard" | null;
  tags: string[];
  wantsCards: boolean;
};

export type SlotRecipe = {
  name?: string;
  ingredients?: unknown;
  cookTime?: number;
  difficulty?: string;
};

export type SlotDispatchItem = { label: string; kind: "ingredient"; qty: 1 };

export const QUERY_SLOT_PROMPT_VERSION = 1;
export const QUERY_SLOT_MODEL = process.env.AI_CHEF_SLOT_MODEL ?? "qwen3.7-flash";

export const QUERY_SLOTS_JSON_SCHEMA = {
  type: "object",
  properties: {
    foodTerm: { type: ["string", "null"] },
    protein: { type: ["string", "null"] },
    dishType: { type: ["string", "null"] },
    method: { type: ["string", "null"] },
    maxMinutes: { type: ["integer", "null"] },
    difficulty: { type: ["string", "null"] },
    tags: { type: "array", items: { type: "string" } },
    wantsCards: { type: "boolean" },
  },
  required: ["foodTerm", "protein", "dishType", "method", "maxMinutes", "difficulty", "tags", "wantsCards"],
  additionalProperties: false,
} as const;

const SLOT_PROMPT = `你係 Kindcipe 香港家庭煮食查詢解析器。只做「拆 slot」，唔准作食譜、價錢、營養數字。
只輸出一個 JSON object，schema 固定：
{
  "foodTerm": string|null,
  "protein": "pork"|"beef"|"chicken"|"lamb"|"seafood"|"egg"|"soy"|"veg"|null,
  "dishType": "soup"|"meat"|"seafood"|"vegetable"|"carb"|"appetizer"|"dessert"|"drink"|"other"|null,
  "method": "steam"|"stirfry"|"panfry"|"braise"|"boil"|"bake"|"raw"|null,
  "maxMinutes": integer|null,
  "difficulty": "easy"|"medium"|"hard"|null,
  "tags": string[],
  "wantsCards": boolean
}

規則：
1. foodTerm：用戶想食嘅具體食物／食材／菜名（保留原詞，例如「蛋類」「魚」「番茄炒蛋」）；冇就 null。
2. protein：只按真正蛋白判斷。以下唔可以當蛋白：魚香（魚香茄子）、牛油果、牛油、牛奶、羊肚菌（本身可當食材但唔係肉）、湯圓、豬仔包、蟹味菇。
3. dishType：湯圓／湯丸／糖水 = dessert，唔係 soup；湯麵／湯飯 = carb。
4. 「家常菜／宴客菜／開胃菜／小菜／菜式／菜色」係泛稱，dishType 唔可以填 vegetable。
5. 「蔬菜」包括南瓜、茄子、番茄、菇、青椒、瓜、豆、苗。
6. maxMinutes：用戶講「20 分鐘內／20分鐘可完成」→ 20；冇就 null。
7. tags 只可以用：light、easy、quick、healthy、清淡、簡單、快、減肥、低卡、高蛋白，或 "avoid:<食材>"。唔好自創。
8. wantsCards：想睇食譜卡 = true；問技巧／純聊天／非食物 = false。
9. 唔肯定就 null，唔准估。`;

const VALID_PROTEINS = new Set<ProteinGroup>(["pork", "beef", "chicken", "lamb", "seafood", "egg", "soy", "veg"]);
const VALID_DISH_TYPES = new Set<DishKind>([
  "soup", "meat", "seafood", "vegetable", "carb", "appetizer", "dessert", "drink", "other",
]);
const VALID_METHODS = new Set<CookingMethod>(COOKING_METHODS);

const PROTEIN_ALIASES: Record<string, ProteinGroup> = {
  pork: "pork", 豬: "pork", 猪: "pork",
  beef: "beef", 牛: "beef",
  chicken: "chicken", 雞: "chicken", 鸡: "chicken",
  lamb: "lamb", 羊: "lamb",
  seafood: "seafood", 海鮮: "seafood", 海鲜: "seafood", 魚: "seafood", 鱼: "seafood",
  egg: "egg", 蛋: "egg", 雞蛋: "egg", 鸡蛋: "egg",
  soy: "soy", 豆腐: "soy", tofu: "soy",
  veg: "veg", vegetable: "veg", 蔬菜: "veg",
};

const METHOD_ALIASES: Record<string, CookingMethod> = {
  steam: "steam", 蒸: "steam",
  stirfry: "stirfry", 炒: "stirfry",
  panfry: "panfry", 煎: "panfry", 炸: "panfry",
  braise: "braise", 炆: "braise", 燉: "braise", 红烧: "braise", 紅燒: "braise",
  boil: "boil", 灼: "boil", 煮: "boil", 湯: "boil", 汤: "boil",
  bake: "bake", 焗: "bake", 烤: "bake",
  raw: "raw", 沙律: "raw", 沙拉: "raw", 涼拌: "raw", 凉拌: "raw",
};

function normalizeText(text: string): string {
  return String(text ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function ingredientNames(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((item: any) => (typeof item === "string" ? item : String(item?.name ?? item?.nameEn ?? "")))
    .filter(Boolean)
    .join(" ");
}

function recipeText(row: SlotRecipe): string {
  return `${String(row.name ?? "")} ${ingredientNames(row.ingredients)}`.trim();
}

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, 40) : null;
}

function normalizeProtein(value: unknown): ProteinGroup | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  return PROTEIN_ALIASES[raw] ?? (VALID_PROTEINS.has(raw as ProteinGroup) ? (raw as ProteinGroup) : null);
}

function normalizeDishType(value: unknown): DishKind | null {
  const raw = String(value ?? "").trim().toLowerCase();
  return VALID_DISH_TYPES.has(raw as DishKind) ? (raw as DishKind) : null;
}

function normalizeMethod(value: unknown): CookingMethod | null {
  const raw = String(value ?? "").trim().toLowerCase();
  return METHOD_ALIASES[raw] ?? (VALID_METHODS.has(raw as CookingMethod) ? (raw as CookingMethod) : null);
}

function normalizeDifficulty(value: unknown): "easy" | "medium" | "hard" | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["easy", "簡單", "简单", "beginner", "1"].includes(raw)) return "easy";
  if (["medium", "中等", "intermediate", "2"].includes(raw)) return "medium";
  if (["hard", "困難", "困难", "advanced", "3"].includes(raw)) return "hard";
  return null;
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const tag = String(item ?? "").trim().slice(0, 24);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= 12) break;
  }
  return out;
}

/**
 * Deterministic post-validation. This is the single place that enforces the
 * false-positive guards, even if the LLM gets them wrong.
 */
export function validateQuerySlots(value: unknown, rawText = ""): QuerySlots | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const normalized = normalizeText(rawText);
  const guarded = stripFoodTermNoise(normalized);

  let foodTerm = asString(v.foodTerm);
  if (foodTerm && isGenericDishTerm(foodTerm)) foodTerm = null;
  if (foodTerm) {
    // A bare protein word is only trusted when it survives the guards.
    if (foodTerm.length === 1 && !guarded.includes(foodTerm)) foodTerm = null;
  }

  let protein = normalizeProtein(v.protein);
  const explicit = explicitProteinTags({ name: guarded });
  if (protein && !explicit.includes(protein)) {
    protein = protein === "veg" && VEGETABLE_NAME_RE.test(guarded) ? "veg" : null;
  }
  if (!protein && explicit.length === 1) protein = explicit[0];

  let dishType = normalizeDishType(v.dishType);
  if (dishType) {
    const current = dishType;
    dishType = isGenericDishTerm(normalized) && current === "vegetable"
      ? null
      : guardDishTypeByName(normalized, current);
    if (dishType === "meat" || dishType === "seafood" || dishType === "soup") {
      const explicit = explicitProteinTags({ name: guarded });
      const realSoup = /湯|汤|soup/i.test(guarded);
      if (explicit.length === 0 && !(dishType === "soup" && realSoup)) {
        dishType = VEGETABLE_NAME_RE.test(guarded) ? "vegetable" : null;
      }
    }
  }

  const method = normalizeMethod(v.method);
  const maxRaw = Number(v.maxMinutes);
  const maxMinutes = Number.isFinite(maxRaw) && maxRaw > 0
    ? Math.max(1, Math.min(180, Math.round(maxRaw)))
    : null;
  const difficulty = normalizeDifficulty(v.difficulty);
  const tags = normalizeTags(v.tags);
  const wantsCards = v.wantsCards === undefined ? true : v.wantsCards === true;

  return {
    foodTerm,
    protein,
    dishType,
    method,
    maxMinutes,
    difficulty,
    tags,
    wantsCards,
  };
}

const memoryCache = new Map<string, { at: number; value: QuerySlots | null }>();
const MEMORY_HIT_MS = 6 * 60 * 60 * 1000;
const MEMORY_MISS_MS = 5 * 60 * 1000;

function memoryGet(key: string): QuerySlots | null | undefined {
  const hit = memoryCache.get(key);
  if (!hit) return undefined;
  const ttl = hit.value === null ? MEMORY_MISS_MS : MEMORY_HIT_MS;
  if (Date.now() - hit.at > ttl) {
    memoryCache.delete(key);
    return undefined;
  }
  return hit.value;
}

export async function parseQuerySlots(rawText: string): Promise<QuerySlots | null> {
  const text = normalizeText(rawText);
  if (!text) return null;

  const memory = memoryGet(text);
  if (memory !== undefined) return memory;

  const cacheKey = translationCacheKey({
    kind: "query_slots",
    promptVersion: QUERY_SLOT_PROMPT_VERSION,
    model: QUERY_SLOT_MODEL,
    text,
  });

  const cached = await getTranslationCache<unknown>(cacheKey);
  const cachedSlots = cached ? validateQuerySlots(cached, text) : null;
  if (cachedSlots) {
    memoryCache.set(text, { at: Date.now(), value: cachedSlots });
    return cachedSlots;
  }

  try {
    const response = await invokeLLM({
      model: QUERY_SLOT_MODEL,
      messages: [
        { role: "system", content: SLOT_PROMPT },
        { role: "user", content: text },
      ],
      maxTokens: 260,
      temperature: 0,
      timeoutMs: 5000,
      maxRetries: 0,
      responseFormat: { type: "json_object" },
    });
    const raw = response.choices?.[0]?.message?.content ?? "";
    const parsed = raw ? extractJSON<Record<string, unknown>>(raw) : null;
    const slots = parsed ? validateQuerySlots(parsed, text) : null;
    if (!slots) {
      memoryCache.set(text, { at: Date.now(), value: null });
      return null;
    }
    memoryCache.set(text, { at: Date.now(), value: slots });
    void setTranslationCache(cacheKey, "query_slots", slots);
    return slots;
  } catch (error) {
    console.warn("[AI Chef] slot parser failed:", (error as Error)?.message || error);
    memoryCache.set(text, { at: Date.now(), value: null });
    return null;
  }
}

const PROTEIN_TERMS: Record<ProteinGroup, string> = {
  pork: "豬",
  beef: "牛",
  chicken: "雞",
  lamb: "羊",
  seafood: "海鮮",
  egg: "蛋",
  soy: "豆腐",
  veg: "蔬菜",
};

/** Empty dispatch items → one deterministic item from slots.foodTerm/protein. */
export function slotsToDispatchItems(slots: QuerySlots | null): SlotDispatchItem[] {
  if (!slots || !slots.wantsCards) return [];
  const label = slots.foodTerm || (slots.protein ? PROTEIN_TERMS[slots.protein] : null);
  if (!label || isGenericDishTerm(label)) return [];
  return [{ label, kind: "ingredient", qty: 1 }];
}

function avoidTermsFromSlots(slots: QuerySlots): string[] {
  const out: string[] = [];
  for (const tag of slots.tags) {
    const match = tag.match(/^(?:avoid|避開|避开|唔要|不要|走)\s*[:：]?\s*(.+)$/i);
    if (match?.[1]?.trim()) out.push(match[1].trim());
  }
  return out;
}

/**
 * Hard constraints: maxMinutes + avoid/allergen + foodTerm/protein.
 * Deterministic and strict: if every row violates a hard constraint we return [].
 */
export function filterRecipesBySlots<T extends SlotRecipe>(
  rows: T[],
  slots: QuerySlots,
  opts: { avoid?: string[] } = {},
): T[] {
  let out = [...rows];
  const avoid = [...avoidTermsFromSlots(slots), ...(opts.avoid ?? [])]
    .map((term) => String(term ?? "").trim())
    .filter(Boolean);

  if (avoid.length > 0) {
    out = out.filter((row) => {
      const text = recipeText(row);
      return !avoid.some((term) => text.includes(term));
    });
  }

  if (slots.maxMinutes && slots.maxMinutes > 0) {
    out = out.filter((row) => {
      const cookTime = Number(row.cookTime);
      return Number.isFinite(cookTime) && cookTime > 0 && cookTime <= slots.maxMinutes!;
    });
  }

  if (slots.foodTerm) {
    const pattern = findFoodTermPattern(slots.foodTerm);
    const raw = stripFoodTermNeutral(slots.foodTerm);
    out = out.filter((row) => {
      if (pattern) return matchesByTermName(row, pattern) || matchesByTermIngredient(row, pattern);
      return raw ? recipeText(row).includes(raw) : true;
    });
  }

  // Protein is a hard constraint only when there is no explicit foodTerm.
  // With a foodTerm (e.g. 蔬菜), the food term already defines the target and
  // 番茄炒蛋/青椒炒肉 must not be dropped just because they also contain egg/pork.
  if (slots.protein && !slots.foodTerm) {
    out = out.filter((row) => proteinTags({ name: String(row.name ?? ""), ingredients: row.ingredients }).includes(slots.protein!));
  }

  return out;
}

const LIGHT_TAGS = new Set(["light", "清淡", "健康", "healthy", "減肥", "减肥", "低卡", "減脂", "减脂"]);
const EASY_TAGS = new Set(["easy", "簡單", "简单", "新手", "簡易", "简易"]);
const QUICK_TAGS = new Set(["quick", "快", "快手", "快速"]);

function difficultyScore(value: string | undefined): number {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["easy", "簡單", "简单", "beginner", "1"].includes(raw)) return 2;
  if (["medium", "中等", "intermediate", "2"].includes(raw)) return 1;
  return 0;
}

/**
 * Soft ranking: light / easy / quick only changes order, never removes cards.
 * When no soft tag is present the original order is preserved.
 */
export function rankRecipesBySlots<T extends SlotRecipe>(rows: T[], slots: QuerySlots): T[] {
  const tags = new Set(slots.tags.map((tag) => tag.toLowerCase()));
  const wantsLight = slots.tags.some((tag) => LIGHT_TAGS.has(tag.toLowerCase()));
  const wantsEasy = slots.tags.some((tag) => EASY_TAGS.has(tag.toLowerCase()));
  const wantsQuick = slots.tags.some((tag) => QUICK_TAGS.has(tag.toLowerCase())) || slots.maxMinutes !== null;
  if (!wantsLight && !wantsEasy && !wantsQuick) return rows;

  return rows
    .map((row, index) => {
      let score = 0;
      const cookTime = Number(row.cookTime);
      if (wantsQuick) {
        score += Number.isFinite(cookTime) && cookTime > 0 ? Math.max(0, 60 - cookTime) / 10 : 0;
      }
      if (wantsEasy) score += difficultyScore(row.difficulty);
      if (wantsLight) {
        const method = cookingMethod({ name: String(row.name ?? "") });
        if (method === "steam" || method === "boil" || method === "raw") score += 2;
        if (Number.isFinite(cookTime) && cookTime > 0 && cookTime <= 20) score += 1;
        score += difficultyScore(row.difficulty) * 0.5;
      }
      return { row, index, score };
    })
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map((entry) => entry.row);
}
