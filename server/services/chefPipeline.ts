import {
  parseChefQuery,
  type ChefSlots,
  type ChefSlotsCache,
  type ParsedChefQuery,
} from "./chefSlots";
import {
  retrieveChefCards,
  deriveTagsFromText,
  toChefLibraryRecipe,
  validateGeneratedCard,
  type ChefLibraryRecipe,
} from "./chefRetrieval";

export type ChefGeneratedCard = {
  name: string;
  cookTime?: number;
  ingredients?: Array<{ name?: string } | string>;
  tags?: string[];
  dishType?: string;
  description?: string;
  steps?: string[];
};

export type ChefPipelineDeps<T> = {
  loadPool: () => Promise<Array<ChefLibraryRecipe | Record<string, unknown>>>;
  toCard: (recipe: ChefLibraryRecipe, source: "library" | "ai") => T | null;
  generate?: (slots: ChefSlots, hint: string) => Promise<ChefGeneratedCard | null>;
  avoid?: string[];
  count?: number;
  lang?: string;
  previousText?: string;
  cache?: ChefSlotsCache;
  invoke?: Parameters<typeof parseChefQuery>[1] extends infer O
    ? O extends { invoke?: infer I } ? I : never
    : never;
  now?: () => number;
  parsed?: ParsedChefQuery;
};

export type ChefPipelineDebug = {
  slots: ChefSlots | null;
  normalizedText: string;
  parseSource: ParsedChefQuery["source"];
  relaxLevel: number;
  stageCandidates: number[];
  candidates: number;
  served: number;
  layer: "library" | "ai" | "clarify" | "skipped";
  reason: string;
  llmCalls: number;
  credits: number;
};

export type ChefPipelineResult<T> = {
  status: "cards" | "clarify" | "skipped";
  cards: T[];
  content: string;
  clarifyReason?: "library_miss" | "ai_failed" | "ambiguous_food";
  slots: ChefSlots | null;
  relaxLevel: number;
  debug: ChefPipelineDebug;
};

const PROTEIN_LABEL: Record<NonNullable<ChefSlots["protein"]>, string> = {
  egg: "蛋類",
  chicken: "雞肉",
  pork: "豬肉",
  beef: "牛肉",
  seafood: "海鮮",
  fish: "魚",
  soy: "豆腐/豆製品",
  veg: "蔬菜",
};

const DISH_TYPE_LABEL: Record<NonNullable<ChefSlots["dishType"]>, string> = {
  soup: "湯水",
  stirfry: "炒餸",
  steam: "蒸餸",
  braise: "炆燉",
  noodle: "粉麵",
  rice: "飯",
  snack: "小食/早餐",
};

const METHOD_LABEL: Record<NonNullable<ChefSlots["method"]>, string> = {
  steam: "蒸",
  stirfry: "炒/煎",
  boil: "烚/白灼/煲",
  braise: "炆/燉",
  bake: "焗/烤",
  deepfry: "炸",
  cold: "涼拌",
};

function buildHint(slots: ChefSlots): string {
  const parts: string[] = [];
  if (slots.protein) parts.push(`主角蛋白質：${PROTEIN_LABEL[slots.protein]}`);
  if (slots.dishType) parts.push(`菜式形態：${DISH_TYPE_LABEL[slots.dishType]}`);
  if (slots.method) parts.push(`煮法：${METHOD_LABEL[slots.method]}`);
  if (slots.keyword) parts.push(`指定食材/菜名：${slots.keyword}`);
  if (slots.maxMinutes) parts.push(`${slots.maxMinutes} 分鐘內完成`);
  if (slots.difficulty === "easy") parts.push("難度：簡單");
  if (slots.tags?.length) parts.push(`條件：${slots.tags.join("、")}`);
  return parts.join("；") || "家常菜";
}

function clarifyText(lang: string, reason: "library_miss" | "ai_failed" | "ambiguous_food"): string {
  if (lang.startsWith("en")) {
    return reason === "ai_failed"
      ? "I couldn't find or generate a recipe that matches all your conditions. Tell me which condition I can relax (time, ingredient, or cooking method)."
      : "I couldn't find a recipe that matches all your conditions. Tell me which condition I can relax, or ask me to cook it with AI (1 credit).";
  }
  return reason === "ai_failed"
    ? "我今次搵唔到又生成唔到完全符合你條件嘅食譜。你可以話我知邊個條件可以放寬（時間、食材或煮法）。"
    : "我未搵到完全符合你條件嘅食譜。可以話我知邊個條件可以放寬，或者叫我用 AI 即場煮（1 credit）。";
}

function cardsText(lang: string, layer: "library" | "ai"): string {
  if (layer === "ai") {
    return lang.startsWith("en")
      ? "The library has no full match, so here is a new AI suggestion."
      : lang.startsWith("fil")
        ? "Walang eksaktong tugma sa library, kaya ito ang bagong AI suggestion."
        : lang.startsWith("id")
          ? "Tidak ada yang cocok di pustaka, jadi ini saran AI baru."
          : "食譜庫未有完全符合嘅選擇，以下係 AI 即場煮嘅新建議（已標示 AI 建議）。";
  }
  return lang.startsWith("en")
    ? "Here are the best matches from the recipe library."
    : lang.startsWith("fil")
      ? "Ito ang pinakaangkop na recipe sa library."
      : lang.startsWith("id")
        ? "Berikut resep yang paling cocok di pustaka."
        : "以下係食譜庫最符合你要求嘅選擇。";
}

/**
 * Full request flow: one slot parse → deterministic retrieval → optional AI
 * generation → never a silent zero-card reply.
 *
 * Pure orchestration: callers inject the pool, card mapper and generator so the
 * whole ladder is testable without a DB or an LLM key.
 */
export async function runChefSlotPipeline<T>(
  text: string,
  deps: ChefPipelineDeps<T>,
): Promise<ChefPipelineResult<T>> {
  const startedAt = (deps.now ?? Date.now)();
  const lang = deps.lang ?? "zh-TW";
  const parsed = deps.parsed ?? await parseChefQuery(text, {
    previousText: deps.previousText,
    cache: deps.cache,
    invoke: deps.invoke,
  });
  let slots = parsed.slots;

  const build = (
    status: ChefPipelineResult<T>["status"],
    cards: T[],
    content: string,
    layer: ChefPipelineDebug["layer"],
    reason: string,
    relaxLevel = 0,
    stageCandidates: number[] = [0, 0, 0, 0, 0],
    candidates = 0,
    extraLlmCalls = 0,
    clarifyReason?: ChefPipelineResult<T>["clarifyReason"],
  ): ChefPipelineResult<T> => {
    const llmCalls = parsed.llmCalls + extraLlmCalls;
    const credits = cards.length > 0 && layer === "ai" ? 1 : 0;
    const debug: ChefPipelineDebug = {
      slots,
      normalizedText: parsed.normalizedText,
      parseSource: parsed.source,
      relaxLevel,
      stageCandidates,
      candidates,
      served: cards.length,
      layer,
      reason,
      llmCalls,
      credits,
    };
    console.log(
      `[Chef] q="${String(text).slice(0, 80)}" slots=${JSON.stringify(slots ?? null)} ` +
      `parse=${parsed.source} relax=${relaxLevel} candidates=${candidates} served=${cards.length} ` +
      `llmCalls=${llmCalls} credits=${credits} ms=${(deps.now ?? Date.now)() - startedAt} layer=${layer} reason=${reason}`,
    );
    return { status, cards, content, ...(clarifyReason ? { clarifyReason } : {}), slots, relaxLevel, debug };
  };

  if (!slots) {
    return build("skipped", [], "", "skipped", "slot_parse_failed");
  }
  if (!slots.wantsCards) {
    return build("skipped", [], "", "skipped", "not_a_card_request");
  }

  let pool: ChefLibraryRecipe[] = [];
  try {
    pool = (await deps.loadPool()).map((row) => {
      const candidate = row as ChefLibraryRecipe;
      if (typeof candidate.name === "string" && Array.isArray(candidate.derivedTags)) return candidate;
      return toChefLibraryRecipe(row as Record<string, unknown>);
    });
  } catch (error) {
    console.warn("[Chef] library pool load failed:", (error as Error)?.message || error);
    pool = [];
  }

  // Parser sometimes drops a pure tag phrase ("一鍋到底"); recover it before
  // retrieval so the constraint actually filters instead of returning popular cards.
  if ((slots.tags?.length ?? 0) === 0) {
    const fallbackTags = deriveTagsFromText(text);
    if (fallbackTags.length > 0) {
      slots = { ...slots, tags: fallbackTags };
      console.log(`[AI Chef] slot_pipeline tag_fallback=${fallbackTags.join("|")}`);
    }
  }
  // User-stated exclusions ("唔要牛") are hard: fold them into the avoid list.
  const avoidAll = [...(deps.avoid ?? []), ...(slots.avoid ?? [])];
  const retrieval = retrieveChefCards(slots, pool, { count: deps.count ?? 3, avoid: avoidAll });
  // Level 3 relaxes protein for recall, but serving the wrong protein would be a
  // correctness bug. Keep only matching cards; if none remain, generate/clarify.
  const libraryRecipes = slots.protein && retrieval.relaxLevel >= 3
    ? retrieval.cards.filter((recipe) => {
        const check = validateGeneratedCard(
          { name: recipe.name, cookTime: recipe.cookTime, ingredients: recipe.ingredients, tags: recipe.tags, dishType: recipe.dishType },
          { ...slots, maxMinutes: undefined, keyword: undefined },
        );
        return check;
      })
    : retrieval.cards;

  if (libraryRecipes.length > 0) {
    const cards = libraryRecipes.map((recipe) => deps.toCard(recipe, "library")).filter(Boolean) as T[];
    if (cards.length > 0) {
      return build(
        "cards", cards, cardsText(lang, "library"), "library", retrieval.reason,
        retrieval.relaxLevel, retrieval.stageCandidates, retrieval.candidates,
      );
    }
  }

  if (deps.generate) {
    const generated = await deps.generate(slots, buildHint(slots)).catch((error) => {
      console.warn("[Chef] generation failed:", (error as Error)?.message || error);
      return null;
    });
    if (generated && validateGeneratedCard(generated, slots)) {
      const recipe: ChefLibraryRecipe = {
        id: `ai:${generated.name}`,
        name: generated.name,
        ingredients: (generated.ingredients ?? []).map((ingredient) => typeof ingredient === "string" ? ingredient : String(ingredient?.name ?? "")).filter(Boolean),
        tags: generated.tags ?? [],
        dishType: generated.dishType,
        cookTime: generated.cookTime,
        derivedTags: [],
      };
      const card = deps.toCard(recipe, "ai");
      if (card) {
        return build(
          "cards", [card], cardsText(lang, "ai"), "ai",
          `${retrieval.reason}:generated`, retrieval.relaxLevel, retrieval.stageCandidates, retrieval.candidates, 1,
        );
      }
    }
  }

  return build(
    "clarify", [], clarifyText(lang, "library_miss"), "clarify", retrieval.reason,
    retrieval.relaxLevel, retrieval.stageCandidates, retrieval.candidates,
    deps.generate ? 1 : 0,
    "library_miss",
  );
}
