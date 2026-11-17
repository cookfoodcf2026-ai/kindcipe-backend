import assert from "node:assert/strict";
import test from "node:test";
import { processAIChefChat, recordFamilySeenNames } from "../routers/aiRecipe";

delete process.env.DATABASE_URL;

const row = (
  id: number,
  name: string,
  dishType: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  name,
  source: "official",
  dishType,
  cookTime: 20,
  servings: 4,
  ingredients: [
    { name: "主要食材", quantity: "1", unit: "1" },
    { name: "配料", quantity: "1", unit: "1" },
  ],
  steps: ["1", "2"],
  tags: [],
  ...extra,
});

const SWAP_PROMPT = "換一張 庫內搜尋：海鮮；同類別：seafood";

async function withFlag<T>(on: boolean, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.AI_CHEF_SWAP_RECYCLE;
  if (on) process.env.AI_CHEF_SWAP_RECYCLE = "1";
  else delete process.env.AI_CHEF_SWAP_RECYCLE;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.AI_CHEF_SWAP_RECYCLE;
    else process.env.AI_CHEF_SWAP_RECYCLE = prev;
  }
}

function runSwap(
  familyId: number,
  pool: Record<string, unknown>[],
  excludeNames: string[] = [],
  prompt = SWAP_PROMPT,
  swapSeenNames?: string[],
) {
  return processAIChefChat(
    [{ role: "user", content: prompt }],
    familyId,
    undefined,
    "library",
    excludeNames,
    undefined,
    "zh-TW",
    [],
    false,
    {},
    "replace",
    true,
    true,
    async () => pool,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    swapSeenNames,
  );
}

// ── Swap (3) ────────────────────────────────────────────────────────────────

test("swap v2: only 7-day-seen candidates left → recycles one with recycled:true and never a hard-excluded card", async () => {
  await withFlag(true, async () => {
    const familyId = 950001;
    const pooled = "回鍋肉";
    const sibling = row(2, "糖醋排骨", "meat");
    const current = row(1, pooled, "meat");
    const seen = row(3, "陳年滷肉", "meat");
    await recordFamilySeenNames(familyId, [seen.name]);

    const result = await runSwap(
      familyId,
      [current, sibling, seen],
      [current.name, sibling.name],
      "換一張 庫內搜尋：肉；同類別：meat",
    );

    assert.ok(result.recipes.length >= 1, "must serve at least one recycled card");
    assert.equal(result.recipes[0]?.name, seen.name);
    assert.equal(result.recipes[0]?.recycled, true, "a served seen card must be flagged recycled");
    const names = result.recipes.map((recipe) => recipe.name);
    assert.ok(!names.includes(current.name), "the current card is hard-excluded");
    assert.ok(!names.includes(sibling.name), "the on-table sibling is hard-excluded");
  });
});

test("swap v2: when even the seen pool is exhausted (all hard-excluded) → [] + library_miss, no fabrication", async () => {
  await withFlag(true, async () => {
    const familyId = 950002;
    const current = row(1, "回鍋肉", "meat");
    const sibling = row(2, "糖醋排骨", "meat");

    const result = await runSwap(
      familyId,
      [current, sibling],
      [current.name, sibling.name],
      "換一張 庫內搜尋：肉；同類別：meat",
    );

    assert.equal(result.recipes.length, 0);
    assert.equal(result.clarifyReason, "library_miss");
    assert.ok((result.alternatives ?? []).every((card) => card.recycled !== true));
  });
});

test("swap v2: flag OFF keeps the field-by-field base shape, and a second swap never immediately re-serves the first recycled card", async () => {
  await withFlag(false, async () => {
    const familyId = 950003;
    const cardRow = {
      id: 50,
      name: "回鍋肉測試",
      source: "official",
      dishType: "meat",
      cookTime: 20,
      servings: 4,
      ingredients: [{ name: "五花肉", quantity: "200", unit: "克" }],
      steps: ["炒"],
      tags: [],
    };

    const first = await runSwap(
      familyId,
      [cardRow],
      [],
      "換一張 庫內搜尋：肉；同類別：meat",
    );
    assert.equal(first.recipes.length, 1);
    // Exact base shape expected from 7cd2e01's rowsToSuggested default branch.
    const expected = {
      name: "回鍋肉測試",
      description: "",
      cookTime: 20,
      servings: 4,
      difficulty: "medium",
      ingredients: [{ name: "五花肉", quantity: "200", unit: "克" }],
      steps: ["炒"],
      tags: [],
      source: "official",
      officialId: 50,
      dishType: "meat",
    };
    assert.equal(JSON.stringify(first.recipes[0]), JSON.stringify(expected));
    assert.equal(
      Object.prototype.hasOwnProperty.call(first.recipes[0], "recycled"),
      false,
      "flag OFF must never emit a recycled field (undefined, not false)",
    );

    // Same session: the client sends the served card as the current card.
    const second = await runSwap(
      familyId,
      [cardRow],
      first.recipes.map((recipe) => recipe.name),
      "換一張 庫內搜尋：肉；同類別：meat",
    );
    assert.ok(second.recipes.every((recipe) => recipe.name !== "回鍋肉測試"));
  });
});

// ── Non-swap regressions (same familyId, flag OFF then ON, field-by-field) ──
// Discipline: both runs MUST use the same familyId. A different familyId would
// hide the exact bug these tests exist to catch (family-level seen-name state
// leaking into non-swap picking). The pool for each case is sized so the
// second run is deterministic even though the first run recorded seen names.

async function expectOffOnIdentical(
  familyId: number,
  run: () => ReturnType<typeof processAIChefChat>,
): Promise<{ off: Awaited<ReturnType<typeof processAIChefChat>>; on: Awaited<ReturnType<typeof processAIChefChat>> }> {
  const off = await withFlag(false, run);
  const on = await withFlag(true, run);
  assert.equal(
    JSON.stringify(on.recipes),
    JSON.stringify(off.recipes),
    `flag ON must be field-by-field identical to flag OFF for family ${familyId}`,
  );
  assert.equal(on.clarifyReason, off.clarifyReason, "clarifyReason must not change with the flag");
  assert.equal(on.status, off.status, "status must not change with the flag");
  assert.ok(
    !JSON.stringify(on.recipes).includes('"recycled"'),
    "non-swap responses must never carry a recycled field",
  );
  return { off, on };
}

test("regression: 3 dishes + 1 soup is identical for flag OFF then ON on the same family", async () => {
  const familyId = 951001;
  const pool = [
    row(1, "香煎牛扒", "meat"),
    row(2, "清蒸海魚", "seafood"),
    row(3, "蒜蓉炒菜", "vegetable"),
    row(4, "老火例湯", "soup"),
  ];
  const run = () =>
    processAIChefChat(
      [{ role: "user", content: "3餸1湯" }],
      familyId,
      undefined,
      "library",
      [],
      undefined,
      "zh-TW",
      [],
      false,
      {},
      "replace",
      true,
      true,
      async () => pool,
    );

  const { on } = await expectOffOnIdentical(familyId, run);
  assert.equal(on.recipes.length, 4, "flag ON must still serve 4 cards");
  assert.equal(on.recipes.filter((recipe) => recipe.dishType === "soup").length, 1);
});

test("regression: vegetarian single card (incl. widened/picked fallback) is identical for flag OFF then ON on the same family", async () => {
  const familyId = 951002;
  const veg = row(1, "清炒時蔬", "vegetable", {
    ingredients: [{ name: "青菜", quantity: "1", unit: "份" }],
  });
  const meat = row(2, "香煎雞扒", "meat", {
    ingredients: [{ name: "雞扒", quantity: "1", unit: "份" }],
  });
  const pool = [veg, meat];
  const search = async (query: string) => (query === "素食" ? [] : pool);
  const run = () =>
    processAIChefChat(
      [{ role: "user", content: "素食" }],
      familyId,
      undefined,
      "library",
      [],
      undefined,
      "zh-TW",
      [],
      false,
      {},
      "replace",
      true,
      true,
      search,
    );

  const { on } = await expectOffOnIdentical(familyId, run);
  assert.ok(on.recipes.length >= 1, "flag ON must still serve a veg card");
  assert.ok(on.recipes.every((recipe) => recipe.name === veg.name));
});

test("regression: single-card structured library lookup is identical for flag OFF then ON on the same family", async () => {
  const familyId = 951003;
  const pool = [row(1, "香煎三文魚", "seafood"), row(2, "香煎牛扒", "meat")];
  const run = () =>
    processAIChefChat(
      [{ role: "user", content: "我想食三文魚" }],
      familyId,
      undefined,
      "library",
      [],
      undefined,
      "zh-TW",
      [],
      false,
      {},
      "replace",
      true,
      true,
      async () => pool,
    );

  const { on } = await expectOffOnIdentical(familyId, run);
  assert.equal(on.recipes.length, 1, "flag ON must still serve one card");
  assert.equal(on.recipes[0]?.name, "香煎三文魚");
});

test("regression: pantry-first pick is identical for flag OFF then ON on the same family", async () => {
  const familyId = 951004;
  const pantryCard = row(1, "青菜豆腐湯", "soup", {
    ingredients: [
      { name: "青菜", quantity: "1", unit: "份" },
      { name: "洋蔥", quantity: "1", unit: "個" },
      { name: "豆腐", quantity: "1", unit: "盒" },
    ],
  });
  const pool = [pantryCard];
  const run = () =>
    processAIChefChat(
      [{ role: "user", content: "我有青菜、洋蔥、豆腐" }],
      familyId,
      undefined,
      "chat",
      [],
      undefined,
      "zh-TW",
      [],
      false,
      {},
      "replace",
      true,
      true,
      async () => pool,
    );

  const { on } = await expectOffOnIdentical(familyId, run);
  assert.equal(on.recipes.length, 1, "flag ON pantry must still serve one card");
  assert.equal(on.recipes[0]?.name, pantryCard.name);
});
