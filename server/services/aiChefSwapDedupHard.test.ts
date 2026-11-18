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

const SWAP_PROMPT = "換一張 庫內搜尋：肉；同類別：meat";

async function withFlag<T>(on: boolean, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.AI_CHEF_SWAP_DEDUP_HARD;
  if (on) process.env.AI_CHEF_SWAP_DEDUP_HARD = "1";
  else delete process.env.AI_CHEF_SWAP_DEDUP_HARD;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.AI_CHEF_SWAP_DEDUP_HARD;
    else process.env.AI_CHEF_SWAP_DEDUP_HARD = prev;
  }
}

function run(
  familyId: number,
  pool: Record<string, unknown>[],
  excludeNames: string[] = [],
  prompt = SWAP_PROMPT,
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
  );
}

// ── P2: same-response hard dedupe ───────────────────────────────────────────

test("dedup hard ON: 3 dishes + 1 soup with duplicate fixture rows → 4 cards, ids all unique", async () => {
  await withFlag(true, async () => {
    const familyId = 960001;
    const pool = [
      row(1, "香煎牛扒", "meat"),
      row(1, "香煎牛扒", "meat"),
      row(2, "清蒸海魚", "seafood"),
      row(2, "清蒸海魚", "seafood"),
      row(3, "蒜蓉炒菜", "vegetable"),
      row(3, "蒜蓉炒菜", "vegetable"),
      row(4, "老火例湯", "soup"),
      row(4, "老火例湯", "soup"),
    ];
    const result = await run(familyId, pool, [], "3餸1湯");
    assert.equal(result.recipes.length, 4, "must still serve the requested 4 cards");
    const ids = result.recipes.map((card) => card.officialId ?? card.customId ?? card.name);
    assert.equal(new Set(ids).size, 4, `duplicate ids in response: ${JSON.stringify(ids)}`);
    const names = result.recipes.map((card) => card.name);
    assert.equal(new Set(names).size, 4, `duplicate names in response: ${JSON.stringify(names)}`);
  });
});

test("dedup hard ON: only seen cards left → still serves one, no panel, no AI", async () => {
  await withFlag(true, async () => {
    const familyId = 960002;
    const current = row(1, "回鍋肉", "meat");
    const seen = row(2, "陳年滷肉", "meat");
    await recordFamilySeenNames(familyId, [seen.name]);

    const result = await run(familyId, [current, seen], [current.name]);
    assert.equal(result.llmUsed, false, "a seen card must be served from the library, not AI");
    assert.equal(result.clarifyReason, undefined, "must not show the no-card panel");
    assert.equal(result.recipes.length, 1);
    assert.equal(result.recipes[0]?.name, seen.name);
    assert.equal(result.recipes[0]?.recycled, true, "a served seen card keeps the existing recycled marker");
  });
});

test("dedup hard ON: 0 cards after hard constraints → library_miss, no fabrication, no AI", async () => {
  await withFlag(true, async () => {
    const familyId = 960003;
    const current = row(1, "回鍋肉", "meat");
    const result = await run(familyId, [current], [current.name]);
    assert.equal(result.recipes.length, 0);
    assert.equal(result.clarifyReason, "library_miss");
    assert.equal(result.llmUsed, false);
    assert.ok((result.alternatives ?? []).every((card) => card.recycled !== true));
  });
});

test("dedup hard ON: 10 consecutive swaps over a 128-card pool → 0 repeats, 0 AI calls", async () => {
  await withFlag(true, async () => {
    const familyId = 960004;
    const pool = Array.from({ length: 128 }, (_, i) =>
      row(2000 + i, `肉類菜式${i + 1}測試`, "meat"),
    );
    const served: string[] = [];
    for (let i = 0; i < 10; i++) {
      const result = await run(familyId, pool, served);
      assert.equal(result.llmUsed, false, `swap ${i + 1} must not call AI`);
      assert.equal(result.recipes.length, 1, `swap ${i + 1} must serve one card`);
      const name = String(result.recipes[0]?.name ?? "");
      assert.ok(!served.includes(name), `swap ${i + 1} repeated ${name}`);
      served.push(name);
    }
    assert.equal(new Set(served).size, 10);
  });
});

test("dedup hard OFF: swap result is field-by-field the 996fdea base shape", async () => {
  await withFlag(false, async () => {
    const familyId = 960005;
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
    const result = await run(familyId, [cardRow]);
    assert.equal(result.recipes.length, 1);
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
    assert.equal(JSON.stringify(result.recipes[0]), JSON.stringify(expected));
    assert.equal(
      Object.prototype.hasOwnProperty.call(result.recipes[0], "recycled"),
      false,
      "flag OFF must not emit a recycled field (undefined, not false)",
    );
  });
});
