import assert from "node:assert/strict";
import test from "node:test";
import { processAIChefChat } from "../routers/aiRecipe";

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

async function withFlags<T>(flags: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(flags)) {
    prev[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function run(
  familyId: number,
  pool: Record<string, unknown>[],
  excludeNames: string[] = [],
  prompt = SWAP_PROMPT,
  avoidIngredients: string[] = [],
) {
  return processAIChefChat(
    [{ role: "user", content: prompt }],
    familyId,
    undefined,
    "library",
    excludeNames,
    undefined,
    "zh-TW",
    avoidIngredients,
    false,
    {},
    "replace",
    true,
    true,
    async () => pool,
  );
}

const withIsolation = <T>(fn: () => Promise<T>) =>
  withFlags({ SWAP_ISOLATION: "1" }, fn);

test("swap_does_not_return_zero_when_hard_constraint_drops_all", async () => {
  await withFlags({ SWAP_ISOLATION: "1", AI_CHEF_HARD_CONSTRAINT_V2: "1" }, async () => {
    const familyId = 970001;
    const unsafe = row(1, "花生燜肉", "meat", {
      ingredients: [{ name: "花生", quantity: "100", unit: "克" }],
    });
    const safe = row(2, "清蒸雞", "meat");
    const result = await run(familyId, [unsafe, safe], [], SWAP_PROMPT, ["花生"]);
    assert.equal(result.recipes.length, 1, "a valid candidate must still be served");
    assert.equal(result.recipes[0]?.name, safe.name);
    assert.equal(result.swapFailed, undefined);
  });
});

test("swap_preserves_meal_shape", async () => {
  await withIsolation(async () => {
    const familyId = 970002;
    const pool = [row(10, "香煎牛扒", "meat"), row(11, "清蒸海魚", "meat")];
    const result = await run(familyId, pool, [], "換一張 3餸1湯 庫內搜尋：肉；同類別：meat");
    assert.equal(result.recipes.length, 1, "swap must not be reshaped into a meal set");
    assert.deepEqual(result.missingRoles ?? [], [], "no missing meal roles on a swap");
  });
});

test("swap_refills_after_dedupe_collision", async () => {
  await withIsolation(async () => {
    const familyId = 970003;
    const retained = "回鍋肉";
    const pool = [row(20, retained, "meat"), row(21, "陳年滷肉", "meat")];
    const result = await run(familyId, pool, [retained]);
    assert.equal(result.recipes.length, 1);
    assert.notEqual(result.recipes[0]?.name, retained);
    assert.equal(result.recipes[0]?.name, "陳年滷肉");
  });
});

test("swap_never_returns_allergen_or_avoided", async () => {
  await withIsolation(async () => {
    const familyId = 970004;
    const pool = [
      row(30, "花生燜肉", "meat", {
        ingredients: [{ name: "花生", quantity: "100", unit: "克" }],
      }),
      row(31, "清蒸雞", "meat"),
    ];
    const result = await run(familyId, pool, [], SWAP_PROMPT, ["花生"]);
    assert.equal(result.recipes.length, 1);
    assert.ok(!String(result.recipes[0]?.name ?? "").includes("花生"));
    assert.ok(
      !(result.recipes[0]?.ingredients ?? []).some((ing: any) => String(ing?.name ?? "").includes("花生")),
    );
  });
});

test("swap_failure_does_not_consume_credit", async () => {
  await withIsolation(async () => {
    const familyId = 970005;
    const current = "回鍋肉";
    const result = await run(familyId, [row(40, current, "meat")], [current]);
    assert.equal(result.recipes.length, 0, "no fabricated replacement");
    assert.equal(result.swapFailed, true, "client keeps the original card");
    assert.equal(result.llmUsed, false, "a swap failure must not call AI");
    assert.equal((result as any).creditsCharged ?? 0, 0, "no credit consumed");
    assert.match(String(result.content), /替代|原本嘅卡|no credit/);
  });
});

test("flag_off_matches_legacy_output", async () => {
  await withFlags({ SWAP_ISOLATION: undefined }, async () => {
    const familyId = 970006;
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
    assert.equal(Object.prototype.hasOwnProperty.call(result, "swapFailed"), false);
  });
});
