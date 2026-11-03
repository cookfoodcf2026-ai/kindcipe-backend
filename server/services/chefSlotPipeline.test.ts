import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeChefSlots,
  parseChefQuery,
  type ChefSlots,
  type ParsedChefQuery,
} from "./chefSlots";
import {
  retrieveChefCards,
  validateGeneratedCard,
  type ChefLibraryRecipe,
} from "./chefRetrieval";
import { runChefSlotPipeline } from "./chefPipeline";

const wantsCards: ChefSlots = { wantsCards: true };

function mockInvoke(content: string) {
  return async () => ({
    choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
  });
}

function recipe(partial: Partial<ChefLibraryRecipe> & { name: string }): ChefLibraryRecipe {
  const { name, ...rest } = partial;
  return {
    id: rest.id ?? `official:${name}`,
    name,
    ingredients: rest.ingredients ?? [],
    tags: rest.tags ?? [],
    derivedTags: rest.derivedTags ?? [],
    ...rest,
  };
}

test("parseChefQuery: mock LLM JSON becomes validated slots", async () => {
  const result = await parseChefQuery("想食蒸水蛋，20分鐘", {
    invoke: mockInvoke('{"protein":"egg","dishType":"steam","maxMinutes":20,"wantsCards":true}') as any,
  });
  assert.equal(result.source, "llm");
  assert.equal(result.llmCalls, 1);
  assert.equal(result.slots?.protein, "egg");
  assert.equal(result.slots?.dishType, "steam");
  assert.equal(result.slots?.maxMinutes, 20);
  assert.equal(result.slots?.wantsCards, true);
});

test("parseChefQuery: garbage from the LLM returns null after retry", async () => {
  const result = await parseChefQuery("想食雞", {
    invoke: mockInvoke("sorry I cannot help") as any,
  });
  assert.equal(result.slots, null);
  assert.equal(result.source, "failed");
  assert.equal(result.llmCalls, 2);
});

test("parseChefQuery: cache hit skips the LLM entirely", async () => {
  let calls = 0;
  const cached: ChefSlots = { protein: "chicken", wantsCards: true };
  const result = await parseChefQuery("想食雞", {
    cache: {
      get: async () => cached,
      set: async () => {},
    },
    invoke: (async () => {
      calls += 1;
      return { choices: [{ message: { content: "{}" }, finish_reason: "stop" }] };
    }) as any,
  });
  assert.equal(result.source, "cache");
  assert.equal(result.llmCalls, 0);
  assert.equal(calls, 0);
  assert.deepEqual(result.slots, cached);
});

test("normalizeChefSlots: invalid protein is dropped and maxMinutes=-1 is clamped", () => {
  const slots = normalizeChefSlots({
    protein: "dragon",
    dishType: "soup",
    maxMinutes: -1,
    wantsCards: true,
  });
  assert.ok(slots);
  assert.equal(slots.protein, undefined);
  assert.equal(slots.dishType, "soup");
  // floor is 5: anything below is treated as parser noise, not a real limit
  assert.equal(slots.maxMinutes, 5);
});

test("normalizeChefSlots: missing wantsCards or non-object returns null", () => {
  assert.equal(normalizeChefSlots({ protein: "egg" }), null);
  assert.equal(normalizeChefSlots(null), null);
  assert.equal(normalizeChefSlots([]), null);
});

test("retrieveChefCards: strict 0 hit relaxes stage by stage and records relaxLevel", () => {
  const pool = [
    recipe({
      name: "辣炒雞柳",
      ingredients: ["雞肉", "辣椒"],
      dishType: "meat",
      derivedTags: ["protein:chicken", "method:stirfry", "tag:spicy"],
    }),
  ];
  const result = retrieveChefCards(
    { protein: "chicken", dishType: "soup", tags: ["辣"], wantsCards: true },
    pool,
  );
  assert.ok(result.relaxLevel > 0);
  assert.equal(result.cards.length, 1);
  assert.equal(result.cards[0].name, "辣炒雞柳");
  assert.equal(result.reason, "relax_2");
  assert.deepEqual(result.stageCandidates, [0, 0, 1]);
});

test("retrieveChefCards: vegetarian query never returns meat", () => {
  const pool = [
    recipe({
      name: "黑椒牛柳",
      ingredients: ["牛肉", "黑椒"],
      derivedTags: ["protein:beef", "method:stirfry"],
    }),
    recipe({
      name: "清炒菜心",
      ingredients: ["菜心", "蒜"],
      derivedTags: ["protein:veg", "diet:vegetarian", "tag:vegetarian"],
    }),
  ];
  const result = retrieveChefCards({ tags: ["素食"], wantsCards: true }, pool);
  assert.ok(result.cards.length > 0);
  assert.equal(result.cards.some((card) => card.name === "黑椒牛柳"), false);
  assert.equal(result.cards.every((card) => card.derivedTags?.includes("diet:vegetarian")), true);
});

test("validateGeneratedCard: over the time limit is rejected", () => {
  assert.equal(
    validateGeneratedCard(
      { name: "慢煮雞", cookTime: 45, ingredients: [{ name: "雞肉" }], steps: ["煮"] },
      { ...wantsCards, protein: "chicken", maxMinutes: 20 },
    ),
    false,
  );
});

test("validateGeneratedCard: wrong protein is rejected", () => {
  assert.equal(
    validateGeneratedCard(
      { name: "黑椒牛柳", cookTime: 20, ingredients: [{ name: "牛肉" }], steps: ["炒"] },
      { ...wantsCards, protein: "chicken" },
    ),
    false,
  );
});

test("validateGeneratedCard: matching card passes", () => {
  assert.equal(
    validateGeneratedCard(
      { name: "豉油雞", cookTime: 20, ingredients: [{ name: "雞肉" }, { name: "豉油" }], steps: ["煮"] },
      { ...wantsCards, protein: "chicken", maxMinutes: 30 },
    ),
    true,
  );
});

test("runChefSlotPipeline: library hit serves cards with 0 credits and no generation", async () => {
  let generated = 0;
  const parsed: ParsedChefQuery = {
    slots: { protein: "chicken", wantsCards: true },
    source: "cache",
    llmCalls: 0,
    normalizedText: "想食雞",
  };
  const result = await runChefSlotPipeline<string>("想食雞", {
    parsed,
    loadPool: async () => [
      {
        name: "豉油雞",
        ingredients: ["雞肉", "豉油"],
        tags: [],
        derivedTags: ["protein:chicken"],
        cookTime: 25,
      },
    ],
    toCard: (card) => card.name,
    generate: async () => {
      generated += 1;
      return null;
    },
  });
  assert.equal(result.status, "cards");
  assert.deepEqual(result.cards, ["豉油雞"]);
  assert.equal(result.debug.layer, "library");
  assert.equal(result.debug.credits, 0);
  assert.equal(generated, 0);
});

test("runChefSlotPipeline: library miss falls back to AI and marks the card", async () => {
  const parsed: ParsedChefQuery = {
    slots: { protein: "chicken", wantsCards: true },
    source: "cache",
    llmCalls: 0,
    normalizedText: "想食雞",
  };
  const result = await runChefSlotPipeline<{ name: string; source: string }>("想食雞", {
    parsed,
    loadPool: async () => [],
    toCard: (card, source) => ({ name: card.name, source }),
    generate: async () => ({
      name: "AI 豉油雞",
      cookTime: 20,
      ingredients: [{ name: "雞肉" }, { name: "豉油" }],
      steps: ["煮"],
    }),
  });
  assert.equal(result.status, "cards");
  assert.equal(result.debug.layer, "ai");
  assert.equal(result.debug.credits, 1);
  assert.equal(result.cards[0].source, "ai");
  assert.match(result.content, /AI 建議/);
});

test("runChefSlotPipeline: full miss returns a clarify with real text", async () => {
  const parsed: ParsedChefQuery = {
    slots: { protein: "chicken", wantsCards: true },
    source: "cache",
    llmCalls: 0,
    normalizedText: "想食雞",
  };
  const result = await runChefSlotPipeline<string>("想食雞", {
    parsed,
    loadPool: async () => [],
    toCard: (card) => card.name,
  });
  assert.equal(result.status, "clarify");
  assert.equal(result.debug.layer, "clarify");
  assert.ok(result.content.trim().length > 0);
  assert.equal(result.content.includes("暫時未能用免費 AI"), false);
});

test("wiring: empty dispatch items + protein slots always takes the library", async () => {
  process.env.DATABASE_URL = "";
  process.env.DASHSCOPE_API_KEY = "";
  process.env.GEMINI_API_KEY = "";
  process.env.CHEF_SLOT_PIPELINE = "true";
  try {
    const { processAIChefChat } = await import("../routers/aiRecipe");
    let dispatchCalls = 0;
    const parsed: ParsedChefQuery = {
      slots: { protein: "chicken", wantsCards: true },
      source: "cache",
      llmCalls: 0,
      normalizedText: "想食雞",
    };
    const result = await processAIChefChat(
      [{ role: "user", content: "想食雞" }],
      undefined,
      undefined,
      "chat",
      [],
      undefined,
      "zh-TW",
      [],
      false,
      { ai_chef_single_card_library: false, ai_chef_any_library_miss_offer: false },
      "replace",
      true,
      true,
      async () => [{
        source: "official",
        id: 901,
        name: "豉油雞",
        description: "",
        cookTime: 25,
        servings: 4,
        difficulty: "easy",
        category: "meat",
        ingredients: [{ name: "雞肉", quantity: "1", unit: "隻" }, { name: "豉油", quantity: "2", unit: "湯匙" }],
        steps: ["煮熟"],
        tags: [],
        dishType: "meat",
      }],
      async () => {
        dispatchCalls += 1;
        return {
          intent: "cards" as const,
          items: [],
          confidence: 0.9,
          ask: { needed: false, question: "" },
          replyText: "",
        };
      },
      undefined,
      undefined,
      { parsed },
    );
    assert.equal(result.recipes.length, 1);
    assert.equal(result.recipes[0].name, "豉油雞");
    assert.equal(result.intentOverride?.reason, "chef_slot_library");
    assert.equal(dispatchCalls, 0);
  } finally {
    delete process.env.CHEF_SLOT_PIPELINE;
  }
});

test("flag: CHEF_SLOT_PIPELINE defaults OFF", async () => {
  const previous = process.env.CHEF_SLOT_PIPELINE;
  delete process.env.CHEF_SLOT_PIPELINE;
  try {
    const { isChefSlotPipelineEnabled } = await import("../routers/aiRecipe");
    assert.equal(isChefSlotPipelineEnabled(), false);
    process.env.CHEF_SLOT_PIPELINE = "true";
    assert.equal(isChefSlotPipelineEnabled(), true);
  } finally {
    if (previous == null) delete process.env.CHEF_SLOT_PIPELINE;
    else process.env.CHEF_SLOT_PIPELINE = previous;
  }
});

function insuranceRow(id: number, name: string, ingredients: string[], cookTime = 20) {
  return {
    source: "official",
    id,
    name,
    description: "",
    cookTime,
    servings: 4,
    difficulty: "easy",
    category: "meat",
    dishType: "meat",
    ingredients: ingredients.map((ingredient) => ({ name: ingredient, quantity: "1", unit: "份" })),
    steps: ["洗淨。", "煮熟。"],
    tags: [],
  };
}

test("ambiguous food enters the slot pipeline when the flag is ON", async () => {
  process.env.DATABASE_URL = "";
  process.env.DASHSCOPE_API_KEY = "";
  process.env.GEMINI_API_KEY = "";
  process.env.CHEF_SLOT_PIPELINE = "true";
  try {
    const { processAIChefChat } = await import("../routers/aiRecipe");
    const parsed: ParsedChefQuery = {
      slots: { protein: "chicken", wantsCards: true },
      source: "cache",
      llmCalls: 0,
      normalizedText: "小朋友食咩好",
    };
    const result = await processAIChefChat(
      [{ role: "user", content: "小朋友食咩好" }],
      undefined, undefined, "chat", [], undefined, "zh-TW", [], false, {},
      "replace", true, true,
      async () => [insuranceRow(1, "豉油雞", ["雞肉", "豉油", "糖"])],
      undefined, undefined, undefined,
      { parsed },
    );
    assert.equal(result.recipes.length, 1);
    assert.equal(result.recipes[0].name, "豉油雞");
  } finally {
    delete process.env.CHEF_SLOT_PIPELINE;
  }
});

test("zero-card insurance serves the closest 3 quality cards", async () => {
  process.env.DATABASE_URL = "";
  process.env.DASHSCOPE_API_KEY = "";
  process.env.GEMINI_API_KEY = "";
  process.env.CHEF_SLOT_PIPELINE = "true";
  try {
    const { processAIChefChat } = await import("../routers/aiRecipe");
    const parsed: ParsedChefQuery = {
      slots: { keyword: "唔存在嘅菜", wantsCards: true },
      source: "cache",
      llmCalls: 0,
      normalizedText: "小朋友食咩好",
    };
    const pool = [
      insuranceRow(1, "番茄炒蛋", ["番茄", "雞蛋", "蔥"]),
      insuranceRow(2, "蒜蓉炒菜心", ["菜心", "蒜", "鹽"]),
      insuranceRow(3, "豉汁蒸排骨", ["排骨", "豆豉", "薑"]),
      insuranceRow(4, "清蒸鱸魚", ["鱸魚", "薑", "蔥"]),
    ];
    const result = await processAIChefChat(
      [{ role: "user", content: "小朋友食咩好" }],
      undefined, undefined, "chat", [], undefined, "zh-TW", [], false, {},
      "replace", true, true,
      async () => pool,
      undefined, undefined, undefined,
      { parsed },
    );
    assert.equal(result.recipes.length, 3);
    assert.equal(result.clarifyReason, undefined);
    assert.match(result.content, /最接近/);
  } finally {
    delete process.env.CHEF_SLOT_PIPELINE;
  }
});

test("zero-card insurance never serves the wrong protein", async () => {
  process.env.DATABASE_URL = "";
  process.env.DASHSCOPE_API_KEY = "";
  process.env.GEMINI_API_KEY = "";
  process.env.CHEF_SLOT_PIPELINE = "true";
  try {
    const { processAIChefChat } = await import("../routers/aiRecipe");
    const parsed: ParsedChefQuery = {
      slots: { protein: "egg", keyword: "蛋類", wantsCards: true },
      source: "cache",
      llmCalls: 0,
      normalizedText: "蛋類",
    };
    const pool = [
      insuranceRow(1, "黑椒牛柳", ["牛肉", "黑椒", "洋蔥"]),
      insuranceRow(2, "番茄炒蛋", ["番茄", "雞蛋", "蔥"]),
      insuranceRow(3, "蒸水蛋", ["雞蛋", "水", "鹽"]),
      insuranceRow(4, "滷水豆腐", ["豆腐", "豉油", "糖"]),
    ];
    const result = await processAIChefChat(
      [{ role: "user", content: "蛋類" }],
      undefined, undefined, "chat", [], undefined, "zh-TW", [], false, {},
      "replace", true, true,
      async () => pool,
      undefined, undefined, undefined,
      { parsed },
    );
    assert.ok(result.recipes.length > 0);
    assert.equal(result.recipes.some((recipe) => /牛|豆腐/.test(recipe.name)), false);
  } finally {
    delete process.env.CHEF_SLOT_PIPELINE;
  }
});

test("chef query log never throws when the DB is unavailable", async () => {
  process.env.DATABASE_URL = "";
  const { logChefQuery } = await import("./chefQueryLog");
  await logChefQuery({
    familyId: null,
    userId: null,
    rawText: "蛋類",
    slots: { protein: "egg", wantsCards: true },
    relaxLevel: 0,
    candidates: 1,
    served: 1,
    credits: 0,
    llmCalls: 0,
    durationMs: 1,
    reason: "test",
    servedSources: { library: 1, ai: 0 },
  });
});

test("normalizeChefSlots: category word becomes protein, not keyword", () => {
  const egg = normalizeChefSlots({ keyword: "蛋類", wantsCards: false });
  assert.ok(egg);
  assert.equal(egg.keyword, undefined);
  assert.equal(egg.protein, "egg");
  assert.equal(egg.wantsCards, true);

  const seafood = normalizeChefSlots({ keyword: "海鮮類", wantsCards: true });
  assert.equal(seafood?.protein, "seafood");

  const dish = normalizeChefSlots({ keyword: "番茄炒蛋", wantsCards: true });
  assert.equal(dish?.keyword, "番茄炒蛋");
  assert.equal(dish?.protein, undefined);
});
