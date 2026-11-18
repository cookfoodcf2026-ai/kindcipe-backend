import assert from "node:assert/strict";
import test from "node:test";
import { processAIChefChat } from "../routers/aiRecipe";

delete process.env.DATABASE_URL;

const row = (id: number, name: string, dishType: string) => ({
  id,
  name,
  source: "official",
  dishType,
  cookTime: 20,
  servings: 4,
  ingredients: [
    { name: "主要食材", quantity: "1", unit: "份" },
    { name: "配料", quantity: "1", unit: "份" },
  ],
  steps: ["1", "2"],
  tags: [],
});

const replaced = row(10, "蒜香牛油三文魚配西蘭花", "seafood");
const seafoodA = row(11, "豉汁蒸鱸魚", "seafood");
const seafoodB = row(12, "清蒸海魚", "seafood");
const beef = row(13, "香煎牛扒", "meat");
const chicken = row(14, "豉油雞", "meat");

// Real production swap payload: it contains「最多 3 個替換」, which the intent
// classifier reads as a multi-card request.
const PROMPT = "請從食譜庫提供最多 3 個替換「蒜香牛油三文魚配西蘭花」嘅食譜。庫內搜尋：海鮮；同類別：seafood";
const EXCLUDE = ["蒜香牛油三文魚配西蘭花"];

type RunOptions = { prompt?: string; structuredSearch?: Record<string, unknown> | undefined };

const run = (
  familyId: number,
  pool: Record<string, unknown>[],
  search: (query: string, limit: number, cookTimeMax?: number) => Promise<Record<string, unknown>[]> = async () => pool,
  options: RunOptions = {},
) => processAIChefChat(
  [{ role: "user", content: options.prompt ?? PROMPT }],
  familyId,
  undefined,
  "library",
  EXCLUDE,
  undefined,
  "zh-TW",
  [],
  false,
  "structuredSearch" in options ? options.structuredSearch : {},
  "replace",
  true,
  true,
  search,
);

test("swap: production payload never returns an excludeNames card", async () => {
  const result = await run(910001, [replaced, seafoodA, seafoodB]);

  assert.ok(
    (result.recipes ?? []).every((recipe) => recipe.name !== "蒜香牛油三文魚配西蘭花"),
    "the card being replaced must never be returned",
  );
  assert.equal(result.recipes.length, 1);
});

test("swap: honours 同類別 when message also contains 最多 3 個替換", async () => {
  const result = await run(910002, [seafoodA, beef, chicken, seafoodB]);

  assert.equal(result.recipes.length, 1);
  assert.ok(
    result.recipes.every((recipe) => recipe.dishType === "seafood"),
    "a seafood swap must only return seafood cards",
  );
  assert.ok(
    [seafoodA.name, seafoodB.name].includes(result.recipes[0]?.name ?? ""),
    "the served card must come from the seafood pool",
  );
});

test("swap: 0 same-dishType cards → 0 cards (never fallback to other dishType)", async () => {
  const result = await run(910003, [beef, chicken]);

  assert.equal(result.recipes.length, 0);
  assert.ok(
    (result.recipes ?? []).every((recipe) => recipe.dishType === "seafood"),
    "a seafood swap must not fall back to meat",
  );
  assert.ok((result.alternatives ?? []).every((card) => card.dishType === "seafood"));
});

test("swap: credits=0, aiCards=0", async () => {
  const result = await run(910004, [replaced, seafoodA, seafoodB]);
  const aiCards = (result.recipes ?? []).filter((recipe) => (recipe.source ?? "ai") === "ai").length;

  assert.equal(result.llmUsed, false);
  assert.equal(aiCards, 0);
  assert.ok((result.recipes ?? []).every((recipe) => (recipe.source ?? "ai") !== "ai"));
});

test("swap: production payload without 庫內搜尋 search marker never returns the current card", async () => {
  const prompt = "請從食譜庫提供最多 3 個替換「蒜香牛油三文魚配西蘭花」嘅食譜。同類別：seafood";
  const result = await run(910005, [replaced, seafoodA, seafoodB], undefined, {
    prompt,
    structuredSearch: undefined,
  });

  assert.ok(
    (result.recipes ?? []).every((recipe) => recipe.name !== "蒜香牛油三文魚配西蘭花"),
    "the card being replaced must never be returned",
  );
  assert.ok(
    (result.recipes ?? []).length === 0
      || (result.recipes ?? []).every((recipe) => recipe.dishType === "seafood"),
    "a seafood swap must return 0 cards or only seafood cards",
  );
});

test("swap: keyword-only swap without 同類別 marker never returns the current card", async () => {
  const prompt = "請從食譜庫提供最多 3 個替換「蒜香牛油三文魚配西蘭花」嘅食譜。庫內搜尋：海鮮";
  const result = await run(910006, [replaced, seafoodA, seafoodB], undefined, {
    prompt,
    structuredSearch: undefined,
  });

  assert.ok(
    (result.recipes ?? []).every((recipe) => recipe.name !== "蒜香牛油三文魚配西蘭花"),
    "a keyword-only swap may never recycle the current card",
  );
});

test("swap: keyword-only without 同類別 returns at most one card and never the current card", async () => {
  const prompt = "請從食譜庫提供最多 3 個替換「蒜香牛油三文魚配西蘭花」嘅食譜。庫內搜尋：海鮮";
  const result = await run(910007, [replaced, seafoodA, seafoodB], undefined, {
    prompt,
    structuredSearch: undefined,
  });

  assert.ok(
    (result.recipes ?? []).length <= 1,
    `a swap must never serve more than one card, got ${(result.recipes ?? []).length}`,
  );
  assert.ok(
    (result.recipes ?? []).every((recipe) => recipe.name !== "蒜香牛油三文魚配西蘭花"),
    "excludeNames card must never be recycled by a keyword-only swap",
  );
});

// NOTE: the state-seen half of swapHardExcludeNames cannot be exercised here:
// DATABASE_URL is deleted, so getLastMealState() and stateKey are unavailable
// (userId/stateUserId are not passed). This test only locks the excludeNames
// half through the relaxed retry; the state-seen half needs a DB integration test.
test("swap: relaxed retry never returns an excludeNames card", async () => {
  const prompt = "請從食譜庫提供最多 3 個替換「蒜香牛油三文魚配西蘭花」嘅食譜。庫內搜尋：三文魚；同類別：seafood";
  const search = async (query: string) => {
    if (query === "三文魚") return [replaced];
    if (query === "海鮮") return [replaced, seafoodA];
    return [replaced, seafoodA, seafoodB];
  };
  const result = await run(910008, [replaced, seafoodA, seafoodB], search, {
    prompt,
    structuredSearch: undefined,
  });

  assert.equal(result.recipes.length, 1);
  assert.equal(result.recipes[0]?.name, seafoodA.name);
});

// Regression (production 2026-11-16): swapping「雞胸藜麥 Poke Bowl」returned 0
// cards because「雞胸」in the swap sentence was read as a protein constraint and
// the only same-dishType candidate「番茄芝士焗豬肉丸」was dropped (kept=0).
test("swap: dish name in the swap sentence must not act as a constraint", async () => {
  const prev = process.env.AI_CHEF_HARD_CONSTRAINT_V2;
  process.env.AI_CHEF_HARD_CONSTRAINT_V2 = "true";
  try {
    const prompt = "請從食譜庫提供最多 3 個替換「雞胸藜麥 Poke Bowl」嘅食譜。庫內搜尋：肉；同類別：meat";
    const meatball = row(20, "番茄芝士焗豬肉丸", "meat");
    const result = await run(910009, [meatball], undefined, {
      prompt,
      structuredSearch: undefined,
    });

    assert.equal(result.recipes.length, 1);
    assert.equal(result.recipes[0]?.name, meatball.name);
  } finally {
    if (prev === undefined) delete process.env.AI_CHEF_HARD_CONSTRAINT_V2;
    else process.env.AI_CHEF_HARD_CONSTRAINT_V2 = prev;
  }
});

test("swap: explicit 唔要 term still filters", async () => {
  const prev = process.env.AI_CHEF_HARD_CONSTRAINT_V2;
  process.env.AI_CHEF_HARD_CONSTRAINT_V2 = "true";
  try {
    const prompt = "請從食譜庫提供最多 3 個替換「雞胸藜麥 Poke Bowl」嘅食譜。庫內搜尋：肉；同類別：meat 唔要豬";
    const pork = {
      ...row(21, "番茄芝士焗豬肉丸", "meat"),
      ingredients: [
        { name: "豬肉丸", quantity: "200", unit: "克" },
        { name: "番茄", quantity: "2", unit: "個" },
      ],
    };
    const result = await run(910010, [pork], undefined, {
      prompt,
      structuredSearch: undefined,
    });

    assert.equal(result.recipes.length, 0);
  } finally {
    if (prev === undefined) delete process.env.AI_CHEF_HARD_CONSTRAINT_V2;
    else process.env.AI_CHEF_HARD_CONSTRAINT_V2 = prev;
  }
});

// ── named-dish miss bypass on swap turns (production 2026-11-18) ─────────────
// The swap sentence「…替換「辣炒年糕」…庫內搜尋：飯；同類別：carb」made the
// keyword search return only the current card (rows=1). The swap then excluded
// it → 0 served → false library_miss, even though the carb pool held 115 cards.

type CallOptions = {
  prompt: string;
  exclude?: string[];
  mode?: "chat" | "ai" | "library";
  search?: (query: string, limit: number, cookTimeMax?: number) => Promise<Record<string, unknown>[]>;
};

const call = (familyId: number, opts: CallOptions) => processAIChefChat(
  [{ role: "user", content: opts.prompt }],
  familyId,
  undefined,
  opts.mode ?? "library",
  opts.exclude ?? [],
  undefined,
  "zh-TW",
  [],
  false,
  {},
  "replace",
  true,
  true,
  opts.search ?? (async () => []),
);

test("swap (1): keyword rows=1 = current card → still serves one same-dishType card", async () => {
  const current = row(30, "辣炒年糕", "carb");
  const altA = row(31, "揚州炒飯", "carb");
  const altB = row(32, "福建炒飯", "carb");
  const prompt = "請從食譜庫提供最多 3 個替換「辣炒年糕」嘅食譜。庫內搜尋：飯；同類別：carb";
  const search = async (query: string) =>
    query.includes("辣炒年糕") ? [current] : [current, altA, altB];

  const result = await call(920001, { prompt, exclude: [current.name], search });

  assert.equal(result.recipes.length, 1, "production case must serve 1 replacement");
  assert.equal(result.recipes[0]?.dishType, "carb");
  assert.ok(!["辣炒年糕"].includes(result.recipes[0]?.name ?? ""), "never the current card");
  assert.notEqual(result.clarifyReason, "library_miss");
});

test("swap (2): zero cards left after exclusion → existing clarify, no crash/silent empty", async () => {
  const current = row(33, "辣炒年糕", "carb");
  const prompt = "請從食譜庫提供最多 3 個替換「辣炒年糕」嘅食譜。庫內搜尋：飯；同類別：carb";

  const result = await call(920002, {
    prompt,
    exclude: [current.name],
    search: async () => [current],
  });

  assert.ok(Array.isArray(result.recipes), "recipes must be an array, never undefined");
  assert.ok((result.content ?? "").length > 0, "must carry a clarify message");
  assert.equal(result.clarifyReason, "library_miss");
  assert.equal(result.status, "clarify");
  assert.ok(
    (result as { swapFailed?: boolean }).swapFailed === true || (result.recipes ?? []).length === 0,
    "a failed swap must carry the existing clarify marker",
  );
});

test("swap (3): non-swap named dish missing from library still clarifies", async () => {
  const result = await call(920003, {
    prompt: "請從食譜庫提供「佛跳牆」嘅食譜",
    search: async () => [],
  });

  assert.equal(result.clarifyReason, "library_miss");
  assert.equal((result.recipes ?? []).length, 0);
});

test("swap (4): mode=ai named dish miss is unchanged (never the library miss gate)", async () => {
  const result = await call(920004, {
    prompt: "請從食譜庫提供「佛跳牆」嘅食譜",
    mode: "ai",
    search: async () => [],
  });

  assert.notEqual(result.clarifyReason, "library_miss");
});

test("swap (5): vegetarian swap only serves vegetarian cards", async () => {
  const current = { ...row(40, "清炒時蔬", "vegetable"), tags: ["vegetarian"] };
  const vegA = { ...row(41, "蒜蓉炒西蘭花", "vegetable"), tags: ["vegetarian"] };
  const vegB = { ...row(42, "金銀蛋莧菜", "vegetable"), tags: ["vegetarian"] };
  const meat = {
    ...row(43, "回鍋肉", "vegetable"),
    ingredients: [
      { name: "五花腩", quantity: "300", unit: "克" },
      { name: "椰菜", quantity: "半個", unit: "個" },
    ],
    tags: [],
  };
  const prompt = "請從食譜庫提供最多 3 個替換「清炒時蔬」嘅食譜。庫內搜尋：蔬菜；同類別：vegetable；素食";
  const search = async (query: string) =>
    query.includes("清炒時蔬") ? [current] : [current, vegA, vegB, meat];

  const result = await call(920005, { prompt, exclude: [current.name], search });

  assert.ok(result.recipes.length >= 1, "vegetarian swap must still serve a card");
  const names = result.recipes.map((recipe) => recipe.name);
  assert.ok(!names.includes(meat.name), "must never serve a non-vegetarian card");
  assert.ok(!names.includes(current.name), "must never serve the current card");
  assert.ok(names.every((name) => [vegA.name, vegB.name].includes(name)));
});

test("swap (6): library 三餸一湯 still serves 4 cards", async () => {
  const pool = [
    row(50, "香煎雞扒", "meat"),
    row(51, "蒜蓉炒西蘭花", "vegetable"),
    row(52, "清蒸鱸魚", "seafood"),
    row(53, "冬瓜排骨湯", "soup"),
    row(54, "番茄炒蛋", "vegetable"),
    row(55, "粟米羹", "soup"),
  ];
  const result = await call(920006, { prompt: "今晚三餸一湯", search: async () => pool });

  assert.equal(result.recipes.length, 4);
});

test("swap (7): three consecutive swaps return three different cards", async () => {
  const pool = [
    row(60, "揚州炒飯", "carb"),
    row(61, "福建炒飯", "carb"),
    row(62, "印尼炒飯", "carb"),
    row(63, "海南雞飯", "carb"),
  ];
  const served: string[] = [];
  let currentName = "辣炒年糕";
  let exclude = [currentName];

  for (let i = 0; i < 3; i += 1) {
    const prompt = `請從食譜庫提供最多 3 個替換「${currentName}」嘅食譜。庫內搜尋：飯；同類別：carb`;
    const search = async (query: string) => (query.includes(currentName) ? [] : pool);
    const result = await call(920007, { prompt, exclude, search });

    assert.equal(result.recipes.length, 1, `swap ${i + 1} must serve exactly one card`);
    served.push(String(result.recipes[0]?.name ?? ""));
    currentName = String(result.recipes[0]?.name ?? "");
    exclude = [...exclude, currentName];
  }

  assert.equal(new Set(served).size, 3, `swaps must not repeat: ${served.join(", ")}`);
});
