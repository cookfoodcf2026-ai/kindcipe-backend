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
