import assert from "node:assert/strict";
import test from "node:test";
import { processAIChefChat, recordFamilySeenNames } from "../routers/aiRecipe";

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

const seafoodA = row(1, "清蒸海魚", "seafood");
const seafoodB = row(2, "豉汁蒸鱸魚", "seafood");

test("swap never returns a name the client excluded, even when it is the only candidate", async () => {
  const result = await processAIChefChat(
    [{ role: "user", content: "換一張 庫內搜尋：海鮮" }],
    880001,
    undefined,
    "library",
    ["清蒸海魚"],
    undefined,
    "zh-TW",
    [],
    false,
    {},
    "replace",
    true,
    true,
    async () => [seafoodA],
  );

  assert.ok((result.recipes ?? []).every((recipe) => recipe.name !== "清蒸海魚"));
});

test("swap never returns a name already shown in this session, even when it is the only candidate", async () => {
  await recordFamilySeenNames(880002, ["清蒸海魚"]);

  const result = await processAIChefChat(
    [{ role: "user", content: "換一張 庫內搜尋：海鮮" }],
    880002,
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
    async () => [seafoodA],
  );

  assert.ok((result.recipes ?? []).every((recipe) => recipe.name !== "清蒸海魚"));
});

test("a second swap in the same session returns no name from the first result", async () => {
  const familyId = 880003;
  const pool = [seafoodA, seafoodB];

  const first = await processAIChefChat(
    [{ role: "user", content: "換一張 庫內搜尋：海鮮" }],
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

  const firstServed = first.recipes[0]?.name;
  assert.ok(firstServed, "first swap should serve a card");

  const second = await processAIChefChat(
    [{ role: "user", content: "換一張 庫內搜尋：海鮮" }],
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

  assert.ok((second.recipes ?? []).every((recipe) => recipe.name !== firstServed));
});
