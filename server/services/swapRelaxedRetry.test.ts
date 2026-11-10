import assert from "node:assert/strict";
import test from "node:test";
import {
  SWAP_NO_CARDS_QUICK_REPLIES,
  filterRowsForSwap,
  processAIChefChat,
  retrySwapOnceRelaxed,
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

const seafood = row(1, "清蒸海魚", "seafood");
const seafood2 = row(2, "豉汁蒸鱸魚", "seafood");
const meat = row(3, "香煎雞扒", "meat");
const noodle = row(4, "豉油皇炒麵", "noodle");

test("swap: first pass 0 candidates retries exactly once with the same-role keyword", async () => {
  const calls: string[] = [];
  const result = await retrySwapOnceRelaxed({
    role: "seafood",
    fallbackQuery: "魚柳",
    search: async (query) => {
      calls.push(query);
      return { ok: true, rows: [seafood] };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0], "海鮮");
  assert.equal(result.attempted, true);
  assert.equal(result.relaxedQuery, "海鮮");
  assert.deepEqual(result.rows.map((r) => r.name), ["清蒸海魚"]);
});

test("swap: no retry when the first pass already has same-role candidates", async () => {
  const calls: string[] = [];
  const result = await retrySwapOnceRelaxed({
    role: "seafood",
    fallbackQuery: "魚柳",
    firstRows: [seafood],
    search: async (query) => {
      calls.push(query);
      return { ok: true, rows: [seafood] };
    },
  });

  assert.equal(calls.length, 0);
  assert.equal(result.attempted, false);
  assert.deepEqual(result.rows, []);
});

test("swap: relaxed retry never returns a different role", async () => {
  const result = await retrySwapOnceRelaxed({
    role: "seafood",
    fallbackQuery: "魚柳",
    search: async () => ({ ok: true, rows: [meat, seafood] }),
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].name, "清蒸海魚");
  assert.ok(result.rows.every((r) => r.dishType === "seafood"));
});

test("swap: relaxed retry never returns the dish being replaced", async () => {
  const result = await retrySwapOnceRelaxed({
    role: "seafood",
    fallbackQuery: "魚柳",
    excludeNames: ["清蒸海魚"],
    search: async () => ({ ok: true, rows: [seafood, seafood2] }),
  });

  assert.equal(result.attempted, true);
  assert.deepEqual(result.rows.map((r) => r.name), ["豉汁蒸鱸魚"]);
});

test("swap: relaxed retry uses the same default count as the strict path", async () => {
  const search = async () => ({ ok: true, rows: [seafood, seafood2, meat] });

  const defaultCount = await retrySwapOnceRelaxed({ role: "seafood", search });
  assert.equal(defaultCount.rows.length, 1);

  const explicitCount = await retrySwapOnceRelaxed({ role: "seafood", count: 2, search });
  assert.equal(explicitCount.rows.length, 2);
});

test("swap: noodle marker maps to the carb DishType instead of yielding 0", () => {
  assert.deepEqual(
    filterRowsForSwap([seafood, noodle, meat], "noodle").map((r) => r.name),
    ["豉油皇炒麵"],
  );
  assert.deepEqual(
    filterRowsForSwap([seafood, noodle, meat], "any").map((r) => r.name),
    ["豉油皇炒麵"],
  );
});

test("swap: relaxed retry runs once and serves a same-role card when the strict pass is empty", async () => {
  const queries: string[] = [];
  const result = await processAIChefChat(
    [{ role: "user", content: "換一張 庫內搜尋：魚柳；同類別：seafood" }],
    770001,
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
    async (query) => {
      queries.push(query);
      return query === "海鮮" ? [seafood2] : [seafood];
    },
  );

  assert.deepEqual(queries.slice(-2), ["魚柳", "海鮮"]);
  assert.equal(result.recipes.length, 1);
  assert.equal(result.recipes[0].name, "豉汁蒸鱸魚");
  assert.equal(result.llmUsed, false);
  assert.equal(result.recipes.every((recipe) => (recipe.source ?? "ai") !== "ai"), true);
});

test("swap: the replaced dish is excluded on both strict and relaxed passes", async () => {
  const result = await processAIChefChat(
    [{ role: "user", content: "換一張 庫內搜尋：海鮮；同類別：seafood" }],
    770003,
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
    async () => [seafood],
  );

  assert.equal(result.recipes.length, 0);
  assert.ok(result.recipes.every((recipe) => recipe.name !== "清蒸海魚"));
  assert.ok((result.alternatives ?? []).every((card) => card.name !== "清蒸海魚"));
});

test("swap: still 0 after relaxed retry uses the truthful clarify contract", async () => {
  const result = await processAIChefChat(
    [{ role: "user", content: "換一張 庫內搜尋：海鮮；同類別：seafood" }],
    770002,
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
    async () => [meat],
  );

  assert.equal(result.recipes.length, 0);
  assert.equal(result.llmUsed, false);
  assert.equal(result.status, "clarify");
  assert.deepEqual(result.quickReplies, SWAP_NO_CARDS_QUICK_REPLIES);
  assert.ok(result.quickReplies?.every((reply) => reply.actionId && reply.label));
  assert.equal(typeof result.quickReplies?.[0], "object");
  assert.ok(Array.isArray(result.alternatives));
  assert.ok((result.alternatives ?? []).every((card) => card.dishType === "seafood"));
});
