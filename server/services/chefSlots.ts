import { extractJSON, invokeLLM, type LLMParams, type LLMResult } from "../_core/llm";

export type ChefProtein =
  | "egg"
  | "chicken"
  | "pork"
  | "beef"
  | "seafood"
  | "fish"
  | "soy"
  | "veg";

export type ChefDishType =
  | "soup"
  | "stirfry"
  | "steam"
  | "braise"
  | "noodle"
  | "rice"
  | "snack";

export type ChefMethod =
  | "steam"
  | "stirfry"
  | "boil"
  | "braise"
  | "bake"
  | "deepfry"
  | "cold";

export type ChefDifficulty = "easy" | "medium" | "hard";

export type ChefSlots = {
  protein?: ChefProtein;
  dishType?: ChefDishType;
  method?: ChefMethod;
  maxMinutes?: number;
  difficulty?: ChefDifficulty;
  tags?: string[];
  keyword?: string;
  wantsCards: boolean;
  servingsHint?: number;
  /** Things the user explicitly rejected ("唔要牛", "走辣") — hard exclusions. */
  avoid?: string[];
};

export type ChefSlotsSource = "llm" | "cache" | "failed";

export type ParsedChefQuery = {
  slots: ChefSlots | null;
  source: ChefSlotsSource;
  llmCalls: number;
  normalizedText: string;
};

export type ChefSlotsCache = {
  get(normalizedText: string): Promise<ChefSlots | null>;
  set(normalizedText: string, slots: ChefSlots): Promise<void>;
};

export type ParseChefQueryOptions = {
  previousText?: string;
  cache?: ChefSlotsCache;
  invoke?: (params: LLMParams) => Promise<LLMResult>;
  timeoutMs?: number;
};

const PROTEINS: readonly ChefProtein[] = ["egg", "chicken", "pork", "beef", "seafood", "fish", "soy", "veg"];
const DISH_TYPES: readonly ChefDishType[] = ["soup", "stirfry", "steam", "braise", "noodle", "rice", "snack"];
const METHODS: readonly ChefMethod[] = ["steam", "stirfry", "boil", "braise", "bake", "deepfry", "cold"];
const DIFFICULTIES: readonly ChefDifficulty[] = ["easy", "medium", "hard"];

export const CHEF_SLOT_SCHEMA = {
  type: "object",
  properties: {
    protein: { type: ["string", "null"], enum: [...PROTEINS, null] },
    dishType: { type: ["string", "null"], enum: [...DISH_TYPES, null] },
    method: { type: ["string", "null"], enum: [...METHODS, null] },
    maxMinutes: { type: ["integer", "null"], minimum: 1, maximum: 240 },
    difficulty: { type: ["string", "null"], enum: [...DIFFICULTIES, null] },
    tags: { type: "array", items: { type: "string" }, maxItems: 8 },
    keyword: { type: ["string", "null"], maxLength: 40 },
    wantsCards: { type: "boolean" },
    servingsHint: { type: ["integer", "null"], minimum: 1, maximum: 20 },
  },
  required: ["wantsCards"],
  additionalProperties: false,
} as const;

export const CHEF_SLOT_PROMPT = `你只做一件事：把用戶最新一句說話解析成食譜檢索條件。你唔係廚師，唔准作答、唔准推薦菜式、唔准作食譜。

只可以輸出一個 JSON object，欄位如下；冇提到嘅欄位請用 null 或省略，唔准亂填：
{
  "protein": "egg" | "chicken" | "pork" | "beef" | "seafood" | "fish" | "soy" | "veg" | null,
  "dishType": "soup" | "stirfry" | "steam" | "braise" | "noodle" | "rice" | "snack" | null,
  "method": "steam" | "stirfry" | "boil" | "braise" | "bake" | "deepfry" | "cold" | null,
  "maxMinutes": integer | null,
  "difficulty": "easy" | "medium" | "hard" | null,
  "tags": string[],
  "keyword": string | null,
  "wantsCards": boolean,
  "servingsHint": integer | null,
  "avoid": string[]
}

判斷規則：
1. protein = 主角蛋白質。蛋/雞蛋 → egg；雞/鴨/鵝 → chicken；豬/排骨/叉燒 → pork；牛 → beef；魚/魚柳 → fish；蝦/蟹/蜆/蠔/海鮮 → seafood；豆腐/豆卜/腐竹 → soy；純蔬菜/素食 → veg。
   類別詞都要落到呢欄：蛋類/雞蛋 → protein egg；豆腐類/豆類 → protein soy；海鮮類/水產 → protein seafood；魚類 → protein fish；雞類 → chicken；牛類 → beef；豬類 → pork；菜類/蔬菜 → veg。
2. dishType = 用戶想要嘅菜式形態。湯 → soup；炒 → stirfry；蒸 → steam；炆/燉/滷 → braise；粉麵/米線/意粉 → noodle；飯/炒飯 → rice；小食/早餐/點心 → snack。
   類別詞都要落到呢欄：粉麵/米線/意粉 → dishType noodle；飯/米飯 → rice；湯/湯水/羹 → soup；早餐/點心/小食 → snack。
3. method = 煮法。蒸 → steam；炒/煎 → stirfry；烚/白灼/煲 → boil；炆/燉 → braise；焗/烤 → bake；炸 → deepfry；涼拌 → cold。
4. maxMinutes = 用戶明確講嘅時間上限（「20分鐘」「半個鐘」= 30）。冇講就 null。
5. tags = 語意條件，必須用以下英文 key（唔准用中文）：light（清淡/低卡/健康）、spicy（辣）、kids（小朋友）、one-pot（一鍋到底/電飯煲）、breakfast（早餐）、high-protein（高蛋白/增肌）、vegetarian（素食）、vegan、guest（宴客）、quick（快手）。保留用戶原意，唔好發明；冇就省略。
6. keyword = 用戶明確講嘅具體菜名或食材（例如 番茄、排骨、豆腐、蛋、牛肉）。如果已用 protein/dishType 表達類別，可以將最具體嘅食材放入 keyword；純類別（「想食肉」「有咩湯」）keyword = null。
7. wantsCards = 用戶想要食譜卡 → true。純打招呼、問煮食技巧、問營養/醫療、投訴、非食物 → false。
   「有咩 X」「想食 X」「有無 X 食譜」一律 wantsCards=true，即使 X 只係類別詞（湯水／餸／早餐／小食）。
   早餐類必須同時出 tags=["breakfast"]（例：有咩早餐 → {"dishType":"snack","tags":["breakfast"],"wantsCards":true}）。
   例：「有咩湯水」→ { "dishType": "soup", "wantsCards": true }；「有咩蒸嘅餸」→ { "method": "steam", "wantsCards": true }。
8. servingsHint = 用戶講幾多人食；冇講就 null。
9. 粵語口語、錯字、中英夾雜、省略都要理解；唔確定就寧願欄位留 null，唔准猜。
10. avoid = 用戶明確唔想要嘅食材或條件（「唔要牛」「走辣」「唔食海鮮」→ ["牛"]/["辣"]/["海鮮"]）。冇就 []。
11. 只輸出 JSON，唔准加解釋或 markdown。`;

/** Bump whenever the prompt or the slot semantics change: cached parses from an
 *  older parser must never be reused (stale maxMinutes/wantsCards bit us badly). */
export const CHEF_SLOT_PARSER_VERSION = "2026-11-04a";

/** Stable cache key: NFKC, lowercase, drop whitespace/punctuation. */
export function normalizeChefText(text: string): string {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s，,。！？!?、；;：:…·「」『』【】\[\]（）()]/g, "")
    .trim();
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

function clampInt(value: unknown, min: number, max: number): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/** Validate + clamp model output. Returns null when the contract is unusable.
 *  Category words (蛋類 / 粉麵 / 湯水 / 海鮮類 …) are the LLM's job: the prompt
 *  maps them to protein / dishType, so this layer keeps no keyword->facet table. */
export function normalizeChefSlots(raw: unknown): ChefSlots | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.wantsCards !== "boolean") return null;

  const tags = Array.isArray(v.tags)
    ? [...new Set(v.tags
        .map((tag) => String(tag ?? "").trim())
        .filter((tag) => tag.length > 0 && tag.length <= 24))]
        .slice(0, 8)
    : [];
  const keywordRaw = v.keyword == null ? "" : String(v.keyword).trim();
  const keyword = keywordRaw && keywordRaw.length <= 40 ? keywordRaw : undefined;

  const parsed: ChefSlots = {
    ...(asEnum(v.protein, PROTEINS) ? { protein: asEnum(v.protein, PROTEINS) } : {}),
    ...(asEnum(v.dishType, DISH_TYPES) ? { dishType: asEnum(v.dishType, DISH_TYPES) } : {}),
    ...(asEnum(v.method, METHODS) ? { method: asEnum(v.method, METHODS) } : {}),
    // A 1–4 minute "limit" is almost always parser noise (e.g. 「蛋類」→ 1),
    // and a hard filter on it empties the pool. Treat it as "no time limit".
    ...(clampInt(v.maxMinutes, 5, 240) ? { maxMinutes: clampInt(v.maxMinutes, 5, 240) } : {}),
    ...(asEnum(v.difficulty, DIFFICULTIES) ? { difficulty: asEnum(v.difficulty, DIFFICULTIES) } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(keyword ? { keyword } : {}),
    // Asking for a protein / keyword / tag is a card request even if the model
    // said wantsCards:false; otherwise the pipeline skips it entirely.
    // Any concrete food facet means the caller wants cards, even if the model
    // said no (it often does for "有咩蒸嘅餸" style method-only questions).
    wantsCards: v.wantsCards || Boolean(keyword) || Boolean(asEnum(v.protein, PROTEINS))
      || Boolean(asEnum(v.dishType, DISH_TYPES)) || Boolean(asEnum(v.method, METHODS)) || tags.length > 0,
    ...(clampInt(v.servingsHint, 1, 20) ? { servingsHint: clampInt(v.servingsHint, 1, 20) } : {}),
    ...(Array.isArray(v.avoid) && v.avoid.length > 0
      ? { avoid: [...new Set(v.avoid.map((x: unknown) => String(x ?? "").trim()).filter((x) => x.length > 0 && x.length <= 12))].slice(0, 6) }
      : {}),
  };
  return parsed;
}

/**
 * One cheap LLM call (temperature 0, JSON schema, one retry) converts the raw
 * sentence into fixed slots. The same normalized sentence is cached, so a
 * repeated query never pays for parsing again.
 *
 * This deliberately does NOT use regex/keyword tables to understand the user:
 * the only deterministic work here is schema validation and cache keying.
 */
export async function parseChefQuery(
  text: string,
  options: ParseChefQueryOptions = {},
): Promise<ParsedChefQuery> {
  const normalizedText = normalizeChefText(text);
  if (!normalizedText) return { slots: null, source: "failed", llmCalls: 0, normalizedText };
  const cacheKey = `${CHEF_SLOT_PARSER_VERSION}:${normalizedText}`;

  if (options.cache) {
    try {
      const cached = await options.cache.get(cacheKey);
      if (cached) return { slots: cached, source: "cache", llmCalls: 0, normalizedText };
    } catch (error) {
      console.warn("[Chef] slot cache read failed:", (error as Error)?.message || error);
    }
  }

  const invoke = options.invoke ?? invokeLLM;
  const context = options.previousText?.trim()
    ? `上一輪用戶講過：${options.previousText.trim()}\n\n`
    : "";
  let llmCalls = 0;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      llmCalls += 1;
      const result = await invoke({
        messages: [
          { role: "system", content: CHEF_SLOT_PROMPT },
          { role: "user", content: `${context}最新一句：${text}` },
        ],
        maxTokens: 320,
        temperature: 0,
        timeoutMs: options.timeoutMs ?? 7000,
        maxRetries: 0,
        enableSearch: false,
        responseFormat: {
          type: "json_schema",
          json_schema: { name: "chef_slots", strict: true, schema: CHEF_SLOT_SCHEMA },
        },
      });
      const raw = result.choices?.[0]?.message?.content ?? "";
      const parsed = normalizeChefSlots(extractJSON<Record<string, unknown>>(raw));
      if (!parsed) continue;
      if (options.cache) {
        try {
          await options.cache.set(cacheKey, parsed);
        } catch (error) {
          console.warn("[Chef] slot cache write failed:", (error as Error)?.message || error);
        }
      }
      return { slots: parsed, source: "llm", llmCalls, normalizedText };
    } catch (error) {
      console.warn(`[Chef] slot parse failed attempt=${attempt + 1}:`, (error as Error)?.message || error);
    }
  }

  return { slots: null, source: "failed", llmCalls, normalizedText };
}
