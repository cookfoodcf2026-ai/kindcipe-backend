import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";
import { processAIChefChat } from "../routers/aiRecipe";
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
