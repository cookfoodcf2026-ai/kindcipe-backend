import assert from "node:assert/strict";
import test from "node:test";
import {
  mkExcludeSets,
  pickSoupMeal,
  processAIChefChat,
  readChefPipelineTelemetry,
  recordFamilySeenNames,
  splitSeenWindowRows,
} from "../routers/aiRecipe";

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

test("swap recycles a name that is only in the 7-day seen window", async () => {
  const familyId = 880002;
  await recordFamilySeenNames(familyId, ["清蒸海魚"]);

  const result = await processAIChefChat(
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
    async () => [seafoodA],
  );

  assert.equal(result.recipes.length, 1);
  assert.equal(result.recipes[0]?.name, "清蒸海魚");
  assert.ok(
    (result.recipes ?? []).every((recipe) => (recipe.source ?? "ai") !== "ai"),
    "a recycled swap card must stay a library card, never an AI card",
  );
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
  // The client sends the cards currently on screen as excludeNames on every swap.
  const firstCardNames = first.recipes.map((recipe) => recipe.name);

  const second = await processAIChefChat(
    [{ role: "user", content: "換一張 庫內搜尋：海鮮" }],
    familyId,
    undefined,
    "library",
    firstCardNames,
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

const seenRow = (id: number, name: string, dishType: string, source = "official") => ({
  ...row(id, name, dishType),
  source,
});

test("swap with an exhausted 7-day window recycles the oldest-seen same-category recipe", async () => {
  const familyId = 880020;
  const names = ["肉甲", "肉乙", "肉丙", "肉丁", "肉戊"];
  // Oldest → newest, so the 7-day window (newest-first) ends with 肉甲.
  for (const name of names) await recordFamilySeenNames(familyId, [name]);
  const pool = names.map((name, i) => seenRow(300 + i, name, "meat"));

  const result = await processAIChefChat(
    [{ role: "user", content: "換一張 庫內搜尋：肉；同類別：meat" }],
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

  assert.ok(result.recipes.length > 0, "an exhausted window must still serve a card");
  assert.equal(result.recipes[0].name, "肉甲", "must recycle the recipe seen longest ago");
  assert.equal(result.recipes[0].dishType, "meat");
  assert.ok(
    result.recipes.every((recipe) => (recipe.source ?? "ai") !== "ai"),
    "recycled swap cards must stay library cards",
  );
});

test("swap never recycles a hard-excluded name from the client", async () => {
  const familyId = 880021;
  const names = ["硬甲", "硬乙"];
  for (const name of names) await recordFamilySeenNames(familyId, [name]);
  const pool = names.map((name, i) => seenRow(320 + i, name, "meat"));

  const result = await processAIChefChat(
    [{ role: "user", content: "換一張 庫內搜尋：肉；同類別：meat" }],
    familyId,
    undefined,
    "library",
    ["硬甲"],
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

  assert.equal(result.recipes.length, 1);
  assert.equal(result.recipes[0].name, "硬乙");
  assert.ok(result.recipes.every((recipe) => recipe.name !== "硬甲"));
});

test("a swap response never serves the same name twice", async () => {
  const familyId = 880022;
  const names = ["重甲", "重乙"];
  for (const name of names) await recordFamilySeenNames(familyId, [name]);
  const pool = [
    seenRow(340, "重甲", "meat"),
    seenRow(341, "重甲", "meat"),
    seenRow(342, "重乙", "meat"),
  ];

  const result = await processAIChefChat(
    [{ role: "user", content: "換一張 庫內搜尋：肉；同類別：meat" }],
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

  const cardNames = result.recipes.map((recipe) => recipe.name);
  assert.ok(cardNames.length > 0);
  assert.equal(cardNames.length, new Set(cardNames).size, "duplicate names must be deduped");
});

test("more than 40 seen names are all excluded when fresh names exist", () => {
  const seenNames = Array.from({ length: 45 }, (_, i) => `已見肉${i}`);
  const freshNames = Array.from({ length: 5 }, (_, i) => `新鮮肉${i}`);
  const rows = [
    ...seenNames.map((name, i) => seenRow(i + 1, name, "meat")),
    ...freshNames.map((name, i) => seenRow(100 + i, name, "meat")),
  ];

  const picked = pickSoupMeal(
    rows,
    mkExcludeSets(seenNames, []),
    3,
    0,
    undefined,
    seenNames,
  );

  assert.equal(picked.length, 3);
  const seen = new Set(seenNames);
  assert.ok(picked.every((recipe) => !seen.has(recipe.name)), "recycled a seen name while fresh ones existed");
  assert.ok(picked.every((recipe) => freshNames.includes(recipe.name)));
});

test("splitSeenWindowRows keeps the whole 7-day window, not just 40", () => {
  const now = Date.now();
  const rows = Array.from({ length: 60 }, (_, i) => ({
    name: `已見${i}`,
    seenAt: now - (i + 1) * 60 * 60 * 1000,
  }));

  const split = splitSeenWindowRows(rows, now);
  assert.equal(split.seen7d.length, 60);
  assert.equal(split.seen1d.length, 23);
});

test("custom recipes keep the 1-day window", () => {
  const now = Date.now();
  const rows = [
    { name: "舊自訂", seenAt: now - 2 * 24 * 60 * 60 * 1000 },
    { name: "新自訂", seenAt: now - 60 * 60 * 1000 },
  ];

  const split = splitSeenWindowRows(rows, now);
  assert.deepEqual(split.seen7d, ["舊自訂", "新自訂"]);
  assert.deepEqual(split.seen1d, ["新自訂"]);
});

test("a category with zero fresh names recycles oldest-first", () => {
  const seenNames = ["肉甲", "肉乙", "肉丙", "肉丁", "肉戊"];
  const rows = seenNames.map((name, i) => seenRow(i + 1, name, "meat"));
  const recycled: Array<{ dishType: string; count: number }> = [];

  const picked = pickSoupMeal(
    rows,
    mkExcludeSets(seenNames, []),
    1,
    0,
    undefined,
    seenNames,
    [],
    (dishType, count) => recycled.push({ dishType, count }),
  );

  assert.equal(picked.length, 1);
  assert.equal(picked[0].name, "肉戊", "should recycle the recipe seen longest ago");
  assert.deepEqual(recycled, [{ dishType: "meat", count: 1 }]);
});

test("recycle counts are request-scoped", async () => {
  const familyA = 880010;
  const familyB = 880011;
  const poolA = [
    seenRow(201, "肉甲", "meat"),
    seenRow(202, "肉乙", "meat"),
    seenRow(203, "肉丙", "meat"),
    seenRow(204, "湯甲", "soup"),
  ];
  const poolB = [
    seenRow(211, "菜甲", "vegetable"),
    seenRow(212, "菜乙", "vegetable"),
    seenRow(213, "湯乙", "soup"),
  ];
  await recordFamilySeenNames(familyA, poolA.map((r) => r.name));
  await recordFamilySeenNames(familyB, poolB.map((r) => r.name));

  const run = (familyId: number, text: string, rows: Record<string, unknown>[]) =>
    processAIChefChat(
      [{ role: "user", content: text }],
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
      false,
      false,
      async () => rows,
    );

  const [resultA, resultB] = await Promise.all([
    run(familyA, "3餸1湯", poolA),
    run(familyB, "2餸1湯", poolB),
  ]);
  const recycleA = readChefPipelineTelemetry(resultA)?.recycle ?? "";
  const recycleB = readChefPipelineTelemetry(resultB)?.recycle ?? "";

  assert.match(recycleA, /(^|,)soup:\d+/, "request A should record the recycled soup");
  assert.match(recycleA, /(^|,)meat:\d+/, "request A should record the recycled meat");
  assert.doesNotMatch(recycleA, /(^|,)vegetable:/, "request A must not see request B's counts");
  assert.match(recycleB, /(^|,)soup:\d+/, "request B should record the recycled soup");
  assert.match(recycleB, /(^|,)vegetable:\d+/, "request B should record the recycled vegetable");
  assert.doesNotMatch(recycleB, /(^|,)meat:/, "request B must not see request A's counts");

  const countSum = (value: string) =>
    value
      .split(",")
      .filter(Boolean)
      .reduce((sum, part) => sum + Number(part.split(":")[1] ?? 0), 0);
  assert.equal(countSum(recycleA), resultA.recipes.length, "request A count should match its recycled cards");
  assert.equal(countSum(recycleB), resultB.recipes.length, "request B count should match its recycled cards");
});
