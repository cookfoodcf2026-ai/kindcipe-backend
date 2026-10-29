import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";
import { execSearchRecipes, processAIChefChat } from "../routers/aiRecipe";
import { getDb } from "../db";
import { buildChefReply } from "./aiChefLifecycle";
import { resolveChefIntent } from "./chefIntent";

const localUrl = process.env.TEST_DATABASE_URL;
if (!localUrl) throw new Error("TEST_DATABASE_URL is required for test:chef:db");
process.env.DATABASE_URL = localUrl;
process.env.DASHSCOPE_API_KEY = "";
process.env.GEMINI_API_KEY = "";

const sql = postgres(localUrl, { max: 1 });
const familyId = 900004;
const prefix = "BUG_SPEC_";

const steps = JSON.stringify(["Step 1", "Step 2", "Step 3", "Step 4", "Step 5"]);
const ingredients = (name: string) => JSON.stringify([
  { name, quantity: "1", unit: "份" },
  { name: "水", quantity: "適量", unit: "" },
]);

async function clear() {
  await sql`delete from official_recipes where name like ${prefix + "%"}`;
  await sql`delete from custom_recipes where name like ${prefix + "%"}`;
}

async function insertOfficial(params: {
  name: string;
  description?: string;
  category?: string;
  dishType?: string;
  tags?: string[];
  ingredientName?: string;
  createdAt: Date;
}) {
  await sql`insert into official_recipes
    (imported_by_user_id,name,description,cook_time,servings,difficulty,recipe_category,dish_type,ingredients,steps,tags,is_active,created_at)
    values ('bug-spec',${params.name},${params.description ?? ""},20,4,'easy',${params.category ?? "其他"},${params.dishType ?? "other"},${ingredients(params.ingredientName ?? "食材")},${steps},${JSON.stringify(params.tags ?? [])},true,${params.createdAt})`;
}

test.before(async () => {
  await clear();
});

test.after(async () => {
  await clear();
  await sql.end();
  // getDb's production pool keeps the process alive; the spec is a standalone
  // local-DB test, so exit with the runner's result.
  setTimeout(() => process.exit(process.exitCode ?? 0), 100);
});

test("BUG 1: role pool 30 false libNone when first 30 rows are avoided", async () => {
  const now = Date.now();
  for (let i = 0; i < 30; i++) {
    await insertOfficial({
      name: `${prefix}avoid-湯麵-${i}`,
      description: "湯麵",
      category: "麵食",
      dishType: "noodle",
      ingredientName: "花生",
      createdAt: new Date(now + 100000 + i * 1000),
    });
  }
  for (let i = 0; i < 43; i++) {
    await insertOfficial({
      name: `${prefix}safe-湯麵-${i}`,
      description: "湯麵",
      category: "麵食",
      dishType: "noodle",
      ingredientName: "麵",
      createdAt: new Date(now - 100000 + i * 1000),
    });
  }

  const result = await processAIChefChat(
    [{ role: "user", content: "一麵" }],
    familyId, undefined, "chat", [], undefined, "zh-TW", ["花生"], false,
    { ai_chef_single_card_library: true, ai_chef_any_library_miss_offer: false },
  );

  assert.equal(result.llmUsed, false);
  assert.ok(result.recipes.length > 0, "expected a safe noodle from the 43 safe rows, got libNone");
  assert.equal(result.recipes[0].source, "official");
});

test("BUG 2: noodle role must not accept rice", async () => {
  const now = Date.now();
  await insertOfficial({
    name: `${prefix}揚州炒飯`,
    description: "一麵",
    category: "飯類",
    dishType: "rice",
    ingredientName: "白飯",
    createdAt: new Date(now + 100000),
  });

  const result = await processAIChefChat(
    [{ role: "user", content: "一麵" }],
    familyId, undefined, "chat", [], undefined, "zh-TW", [], false,
    { ai_chef_single_card_library: true, ai_chef_any_library_miss_offer: false },
  );

  assert.equal(result.llmUsed, false);
  assert.ok(result.recipes.every((r) => !/炒飯|飯/.test(r.name)), "noodle role returned a rice dish");
});

test("BUG 3: role fallback must log pool/after_avoid/after_exclude counts", async () => {
  await insertOfficial({
    name: `${prefix}log-dessert`,
    description: "甜品",
    category: "甜品",
    dishType: "dessert",
    ingredientName: "芒果",
    createdAt: new Date(),
  });
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  try {
    await processAIChefChat(
      [{ role: "user", content: "一甜品" }],
      familyId, undefined, "chat", [], undefined, "zh-TW", [], false,
      { ai_chef_single_card_library: true, ai_chef_any_library_miss_offer: false },
    );
  } finally {
    console.log = original;
  }
  const joined = logs.join("\n");
  assert.match(joined, /library_role_pool=\d+/);
  assert.match(joined, /after_avoid=\d+/);
  assert.match(joined, /after_exclude=\d+/);
});



test("BUG 5: keyword hit must be role-filtered before returning", async () => {
  const now = Date.now();
  await insertOfficial({
    name: `${prefix}一湯種麵包`,
    description: "一湯",
    category: "麵包",
    dishType: "other",
    ingredientName: "麵粉",
    createdAt: new Date(now + 100000),
  });

  const result = await processAIChefChat(
    [{ role: "user", content: "一湯" }],
    familyId, undefined, "chat", [], undefined, "zh-TW", [], false,
    { ai_chef_single_card_library: true, ai_chef_any_library_miss_offer: false },
  );

  assert.equal(result.llmUsed, false);
  assert.ok(result.recipes.every((r) => !/麵包/.test(r.name)), "soup role returned bread");
});

test("BUG 4 contract: append partial and zero-card responses remain valid", () => {
  const partialIntent = resolveChefIntent("一肉一甜品", { mode: "chat" });
  const partial = buildChefReply({
    requestId: "bug4-partial",
    intent: partialIntent,
    operation: "append",
    result: {
      content: "partial",
      recipes: [{ name: "Mango", description: "", ingredients: [{ name: "Mango" }], steps: ["1", "2", "3", "4", "5"], source: "official" }],
      llmUsed: false,
      missingRoles: ["meat"],
      llmCalls: 0,
    },
  });
  assert.equal(partial.status, "partial_cards");
  assert.equal(partial.operation, "append");
  assert.equal(partial.served, 1);

  const zero = buildChefReply({
    requestId: "bug4-zero",
    intent: partialIntent,
    operation: "append",
    result: { content: "", recipes: [], llmUsed: false, missingRoles: ["meat", "dessert"], llmCalls: 0 },
  });
  assert.equal(zero.status, "no_cards");
  assert.equal(zero.operation, "append");
  assert.equal(zero.served, 0);
});

test("flag OFF: legacy wrong-role keyword result remains unchanged", async () => {
  await insertOfficial({
    name: `${prefix}flagoff-一湯種麵包`,
    description: "一湯",
    category: "麵包",
    dishType: "other",
    ingredientName: "麵粉",
    createdAt: new Date(),
  });
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  let result: Awaited<ReturnType<typeof processAIChefChat>>;
  try {
    result = await processAIChefChat(
      [{ role: "user", content: "一湯" }],
      familyId, undefined, "chat", [], undefined, "zh-TW", [], false,
      { ai_chef_single_card_library: false, ai_chef_any_library_miss_offer: false },
    );
  } finally {
    console.log = original;
  }
  assert.ok(result.recipes.some((r) => /麵包/.test(r.name)), "flag OFF must keep old wrong-role behavior");
  assert.doesNotMatch(logs.join("\n"), /library_role_pool=\d+/);
});

test("BUG 6: chicken + vegetable 3-dish 1-soup uses the user's ingredient words", async () => {
  const now = Date.now();
  const fixtures = [
    { name: `${prefix}醬油雞腿`, category: "家常", dishType: "meat", ingredientName: "雞腿" },
    { name: `${prefix}氣炸鍋酥脆烤雞腿`, category: "家常", dishType: "meat", ingredientName: "雞腿" },
    { name: `${prefix}豉油雞`, category: "家常", dishType: "meat", ingredientName: "雞" },
    { name: `${prefix}蒜蓉炒菜心`, category: "家常", dishType: "vegetable", ingredientName: "菜心" },
    { name: `${prefix}清炒西蘭花`, category: "家常", dishType: "vegetable", ingredientName: "西蘭花" },
    { name: `${prefix}番茄薯仔湯`, category: "家常", dishType: "soup", ingredientName: "番茄" },
    { name: `${prefix}紫菜蛋花湯`, category: "家常", dishType: "soup", ingredientName: "紫菜" },
  ];
  for (let i = 0; i < fixtures.length; i++) {
    await insertOfficial({ ...fixtures[i], createdAt: new Date(now + i * 1000) });
  }

  const result = await processAIChefChat(
    [{ role: "user", content: "今晚三餸一湯，有雞髀同菜" }],
    familyId, undefined, "chat", [], undefined, "zh-TW", [], false,
    { ai_chef_single_card_library: true, ai_chef_any_library_miss_offer: false },
  );

  assert.equal(result.recipes.length, 4);
  assert.ok(result.recipes.some((r) => /雞/.test(r.name)), `expected a chicken card, got ${result.recipes.map((r) => r.name).join("、")}`);
  assert.ok(result.recipes.some((r) => /菜/.test(r.name)), `expected a vegetable card, got ${result.recipes.map((r) => r.name).join("、")}`);
});

const CANNED_MEAL_PROMPT = `請為我設計今晚「3 餸 1 湯」晚餐，總共 4 道菜，適合4人食用。
煮食時間要求：普通約 1 小時。
食材欄每行只寫一種食材，唔好加入功效、備註、口味描述。
請提供完整 4 個食譜，分類如下：
1. 肉類主菜（如豬/牛/雞）
2. 海鮮/其他蛋白主菜（如魚/蝦/豆腐蛋）
3. 蔬菜/小炒
4. 湯水（老火湯）`;

test("BUG 7: canned 3-dish-1-soup prompt is all library and never uses tofu as meat", async () => {
  const now = Date.now();
  const fixtures = [
    { name: `${prefix}咕嚕肉`, category: "家常", dishType: "meat", ingredientName: "豬肉" },
    { name: `${prefix}椒鹽豆腐`, category: "家常", dishType: "meat", ingredientName: "肉" },
    { name: `${prefix}海鮮豆腐煲`, category: "家常", dishType: "seafood", ingredientName: "海鮮" },
    { name: `${prefix}清炒蔬菜`, category: "家常", dishType: "vegetable", ingredientName: "蔬菜" },
    { name: `${prefix}紫菜蛋花湯`, category: "家常", dishType: "soup", ingredientName: "湯" },
  ];
  for (let i = 0; i < fixtures.length; i++) {
    await insertOfficial({ ...fixtures[i], createdAt: new Date(now + i * 1000) });
  }

  const result = await processAIChefChat(
    [{ role: "user", content: CANNED_MEAL_PROMPT }],
    familyId, undefined, "library", [], undefined, "zh-TW", [], false,
    { ai_chef_single_card_library: true, ai_chef_any_library_miss_offer: false },
  );

  assert.equal(result.recipes.length, 4);
  assert.equal(result.llmUsed, false);
  assert.ok(result.recipes.every((r) => r.source === "official" || r.source === "custom"), `non-library card: ${result.recipes.map((r) => `${r.name}:${r.source}`).join("、")}`);
  assert.ok(result.recipes.some((r) => /肉/.test(r.name)), `expected meat card, got ${result.recipes.map((r) => r.name).join("、")}`);
  assert.ok(result.recipes.every((r) => !/椒鹽豆腐/.test(r.name)), `tofu leaked into meat: ${result.recipes.map((r) => r.name).join("、")}`);
});

test("BUG 8: P6 beef + vegetable meal returns beef, not chicken", async () => {
  const now = Date.now();
  const fixtures = [
    { name: `${prefix}經典西冷牛排`, category: "家常", dishType: "meat", ingredientName: "牛肉" },
    { name: `${prefix}中式牛柳`, category: "家常", dishType: "meat", ingredientName: "牛肉" },
    { name: `${prefix}雞腿`, category: "家常", dishType: "meat", ingredientName: "雞腿" },
    { name: `${prefix}蒜蓉炒菜心`, category: "家常", dishType: "vegetable", ingredientName: "菜心" },
  ];
  for (let i = 0; i < fixtures.length; i++) {
    await insertOfficial({ ...fixtures[i], createdAt: new Date(now + i * 1000) });
  }

  const result = await processAIChefChat(
    [{ role: "user", content: "食牛扒同菜" }],
    familyId, undefined, "chat", [], undefined, "zh-TW", [], false,
    { ai_chef_single_card_library: true, ai_chef_any_library_miss_offer: false },
  );

  assert.equal(result.recipes.length, 2);
  assert.ok(result.recipes.some((r) => /牛/.test(r.name)), `expected beef, got ${result.recipes.map((r) => r.name).join("、")}`);
  assert.ok(result.recipes.every((r) => !/雞腿/.test(r.name)), `chicken leaked into beef meal: ${result.recipes.map((r) => r.name).join("、")}`);
  assert.equal(result.llmUsed, false);
});

test("BUG 9: P8 correction returns one beef card, not zero cards", async () => {
  const now = Date.now();
  await insertOfficial({
    name: `${prefix}P8經典西冷牛排`,
    category: "家常",
    dishType: "meat",
    ingredientName: "牛肉",
    createdAt: new Date(now + 1000),
  });

  const result = await processAIChefChat(
    [
      { role: "user", content: "食牛扒同菜" },
      { role: "assistant", content: "準備好" },
      { role: "user", content: "你出雞？我要牛扒" },
    ],
    familyId, undefined, "chat", [], undefined, "zh-TW", [], false,
    { ai_chef_single_card_library: true, ai_chef_any_library_miss_offer: false },
  );

  assert.equal(result.recipes.length, 1);
  assert.match(result.recipes[0].name, /牛/);
  assert.doesNotMatch(result.recipes[0].name, /雞/);
  assert.equal(result.llmUsed, false);
});

test("BUG 10: raw-term DB fallback finds salad before chat path", async () => {
  const now = Date.now();
  await insertOfficial({
    name: `${prefix}凱撒沙律`,
    description: "沙律",
    category: "西式",
    dishType: "vegetable",
    ingredientName: "生菜",
    createdAt: new Date(now + 1000),
  });

  const salad = await processAIChefChat(
    [{ role: "user", content: "沙律呢？" }],
    familyId, undefined, "chat", [], undefined, "zh-TW", [], false,
    { ai_chef_single_card_library: true, ai_chef_any_library_miss_offer: false },
  );
  assert.equal(salad.recipes.length, 1);
  assert.match(salad.recipes[0].name, /沙律/);
  assert.equal(salad.recipes[0].source, "official");
  assert.equal(salad.llmUsed, false);

  const mixed = await processAIChefChat(
    [{ role: "user", content: "食扒同沙律" }],
    familyId, undefined, "chat", [], undefined, "zh-TW", [], false,
    { ai_chef_single_card_library: true, ai_chef_any_library_miss_offer: false },
  );
  assert.ok(mixed.recipes.some((r) => /沙律/.test(r.name)), `expected salad card, got ${mixed.recipes.map((r) => r.name).join("、")}`);
});

async function insertCustom(params: {
  name: string;
  familyId: number;
  visibility: "private" | "pending_public" | "public";
  isDraft?: boolean;
  sourceType?: "manual" | "kol" | "import";
}) {
  await sql`insert into custom_recipes
    (family_id,created_by_user_id,name,description,cook_time,servings,difficulty,recipe_category,dish_type,ingredients,steps,tags,source_type,visibility,is_draft)
    values (${params.familyId},${"bug-spec"},${params.name},${"同類"},20,4,'easy','家常','other',${ingredients("食材")},${steps},${JSON.stringify(["家常"])},${params.sourceType ?? "manual"},${params.visibility},${params.isDraft ?? false})`;
}

test("KOL visibility: public KOL and own private recipes are visible", async () => {
  await insertCustom({ name: `${prefix}KOL_PUBLIC`, familyId: 0, visibility: "public", sourceType: "kol" });
  await insertCustom({ name: `${prefix}OWN_PRIVATE`, familyId, visibility: "private" });
  const db = await getDb();
  assert.ok(db);
  const result = await execSearchRecipes(db, { query: `${prefix}KOL_PUBLIC`, limit: 10 }, familyId);
  assert.ok(result.recipes.some((r) => r.name === `${prefix}KOL_PUBLIC`));
  const own = await execSearchRecipes(db, { query: `${prefix}OWN_PRIVATE`, limit: 10 }, familyId);
  assert.ok(own.recipes.some((r) => r.name === `${prefix}OWN_PRIVATE`));
});

test("KOL privacy: other family private, pending_public and drafts are not visible", async () => {
  await insertCustom({ name: `${prefix}OTHER_PRIVATE`, familyId: familyId + 10, visibility: "private" });
  await insertCustom({ name: `${prefix}PENDING_PUBLIC`, familyId: 0, visibility: "pending_public", sourceType: "kol" });
  await insertCustom({ name: `${prefix}KOL_DRAFT`, familyId: 0, visibility: "public", sourceType: "kol", isDraft: true });
  const db = await getDb();
  assert.ok(db);
  const result = await execSearchRecipes(db, { query: `${prefix}`, limit: 100 }, familyId);
  const names = result.recipes.map((r) => r.name);
  assert.ok(!names.includes(`${prefix}OTHER_PRIVATE`), "other family private leaked");
  assert.ok(!names.includes(`${prefix}PENDING_PUBLIC`), "pending_public leaked");
  assert.ok(!names.includes(`${prefix}KOL_DRAFT`), "draft KOL leaked");
});

test("library miss returns clarify with three exits and no cards", async () => {
  const result = await processAIChefChat(
    [{ role: "user", content: "我想食魚湯粉同菜" }],
    familyId, undefined, "chat", [], undefined, "zh-TW", [], false,
    { ai_chef_single_card_library: true, ai_chef_any_library_miss_offer: false },
  );
  assert.equal(result.recipes.length, 0);
  assert.equal(result.llmUsed, false);
  assert.equal(result.clarifyReason, "library_miss");
  assert.match(result.content, /匯入|最接近|AI/);
  assert.doesNotMatch(result.content, /西班牙海鮮/);
});

test("ingredient miss gives same-family alternatives with honest copy", async () => {
  await sql`delete from official_recipes where name like ${"%和牛%"}`;
  await insertOfficial({
    name: `${prefix}黑椒牛柳`,
    category: "家常",
    dishType: "meat",
    ingredientName: "牛肉",
    createdAt: new Date(),
  });
  const result = await processAIChefChat(
    [{ role: "user", content: "我要和牛" }],
    familyId, undefined, "chat", [], undefined, "zh-TW", [], false,
    { ai_chef_single_card_library: true, ai_chef_any_library_miss_offer: false },
  );
  assert.ok(result.recipes.length > 0);
  assert.match(result.content, /庫存冇「和牛」/);
  assert.equal(result.llmUsed, false);
});
