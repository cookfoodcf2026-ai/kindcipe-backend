import test from "node:test";
import assert from "node:assert/strict";

import { filterRowsForSwap } from "../routers/aiRecipe";
import {
  FULL_CATEGORY_POOL_LIMIT,
  filterFullCategoryRows,
  isPoolFullCategoryEnabled,
  libraryPoolVersion,
  orderFullCategoryPool,
  swapPoolSeed,
} from "./chefPoolFullCategory";

type Row = Record<string, unknown>;

const byDishType = (row: Row) => String(row.dishType ?? "").trim().toLowerCase();

function withFlag<T>(on: boolean, fn: () => T): T {
  const prev = process.env.AI_CHEF_POOL_FULL_CATEGORY;
  if (on) process.env.AI_CHEF_POOL_FULL_CATEGORY = "1";
  else delete process.env.AI_CHEF_POOL_FULL_CATEGORY;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.AI_CHEF_POOL_FULL_CATEGORY;
    else process.env.AI_CHEF_POOL_FULL_CATEGORY = prev;
  }
}

function makeRows(dishType: string, count: number, prefix = dishType): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: `${prefix}-${index + 1}`,
    dishType,
    tags: [],
    steps: ["備料", "烹調", "上碟"],
    cookTime: 20,
    servings: 4,
    source: "official",
  }));
}

// 1. Flag OFF: the legacy swap filter is untouched, field by field.
test("flag OFF -> legacy keyword pool is byte-identical", () => {
  withFlag(false, () => {
    assert.equal(isPoolFullCategoryEnabled(), false);
    assert.equal(libraryPoolVersion(), "legacy-v1");
  });
  const rows: Row[] = [
    { id: 1, name: "紅燒肉", dishType: "meat", tags: ["肉"], cookTime: 60, ingredients: [], steps: ["a"] },
    { id: 2, name: "清蒸魚", dishType: "seafood", tags: ["海鮮"], cookTime: 20, ingredients: [], steps: ["b"] },
    { id: 3, name: "蜜汁叉燒", dishType: "meat", tags: ["肉"], cookTime: 50, ingredients: [], steps: ["c"] },
  ];
  assert.deepEqual(filterRowsForSwap(rows, "meat"), [rows[0], rows[2]]);
});

// 2. Flag ON: the whole dish_type is eligible (128 meat => 128 candidates).
test("flag ON -> meat pool >= 120 from 128 fixture rows", () => {
  withFlag(true, () => {
    assert.equal(isPoolFullCategoryEnabled(), true);
    assert.equal(libraryPoolVersion(), "fullcat-v2");
  });
  const pool = makeRows("meat", 128);
  const candidate = filterFullCategoryRows(pool, "meat", byDishType);
  assert.equal(candidate.length, 128);
  assert.ok(candidate.length >= 120);
  assert.ok(FULL_CATEGORY_POOL_LIMIT >= 20_000);
});

// 3. Same seed runs twice -> bit-identical ordering.
test("same seed -> bit-identical ordering", () => {
  const pool = makeRows("meat", 128);
  const first = orderFullCategoryPool(pool, { keyword: "肉", seed: 424242 });
  const second = orderFullCategoryPool(pool, { keyword: "肉", seed: 424242 });
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((row) => row.id), second.map((row) => row.id));
});

// 4. Different seeds -> top-20 overlap <= 50%.
test("different seed -> top-20 overlap <= 50%", () => {
  const pool = makeRows("meat", 128);
  const a = orderFullCategoryPool(pool, { keyword: "", seed: 11 }).slice(0, 20);
  const b = orderFullCategoryPool(pool, { keyword: "", seed: 99 }).slice(0, 20);
  const idsA = new Set(a.map((row) => row.id));
  const overlap = b.filter((row) => idsA.has(row.id)).length;
  assert.ok(overlap / 20 <= 0.5, `overlap=${overlap}/20`);
});

// 5. All nine dish types can yield at least one card (drink has only 6 rows).
test("all 9 dish types have at least one eligible card", () => {
  const counts: Record<string, number> = {
    soup: 38,
    meat: 128,
    seafood: 61,
    vegetable: 42,
    carb: 116,
    appetizer: 26,
    dessert: 20,
    drink: 6,
    other: 3,
  };
  const pool = Object.entries(counts).flatMap(([type, count]) =>
    makeRows(type, count, type),
  );
  for (const type of Object.keys(counts)) {
    const candidates = filterFullCategoryRows(pool, type, byDishType);
    assert.ok(candidates.length >= 1, `type=${type} candidates=${candidates.length}`);
    if (type === "drink") assert.equal(candidates.length, 6);
    const ordered = orderFullCategoryPool(candidates, { keyword: "", seed: 7 });
    assert.equal(ordered.length, candidates.length);
  }
});

// The production shape: 61 seafood rows, only two names contain the keyword.
function productionSeafoodPool(): Row[] {
  const pool = makeRows("seafood", 61, "菜");
  pool[0] = { ...pool[0], name: "西班牙海鮮鐵鍋飯" };
  pool[1] = { ...pool[1], name: "韓式海鮮煎餅" };
  return pool;
}

// 6. Regression (2026-11-18): a hard keyword tier made 61 seafood rows alternate
//    between the same two cards. Five consecutive swaps must yield five names.
test("5 consecutive swaps over 61 seafood rows -> 5 unique names", () => {
  const pool = productionSeafoodPool();
  const served: string[] = [];
  const seeds: number[] = [];
  for (let swap = 0; swap < 5; swap++) {
    const seed = swapPoolSeed({
      requestId: `req-${swap}`,
      keyword: "海鮮",
      dishType: "seafood",
      excludeNames: served,
    });
    seeds.push(seed);
    const ordered = orderFullCategoryPool(pool, { keyword: "海鮮", seed });
    const next = ordered.find((row) => !served.includes(String(row.name)));
    assert.ok(next, `swap=${swap} exhausted pool`);
    served.push(String(next.name));
  }
  assert.equal(new Set(seeds).size, 5, "every swap must use a different seed");
  assert.equal(new Set(served).size, 5, `served=${served.join("|")}`);
});

// 7. Even when the client only excludes the current card (no accumulated seen
//    list), the keyword boost must not lock the head to the two keyword rows.
test("current-card-only exclusion does not alternate between two cards", () => {
  const pool = productionSeafoodPool();
  let current = "";
  const picks: string[] = [];
  for (let swap = 0; swap < 5; swap++) {
    const seed = swapPoolSeed({
      requestId: `req-${swap}`,
      keyword: "海鮮",
      dishType: "seafood",
      excludeNames: current ? [current] : [],
    });
    const ordered = orderFullCategoryPool(pool, { keyword: "海鮮", seed });
    const next = ordered.find((row) => String(row.name) !== current);
    assert.ok(next, `swap=${swap} exhausted pool`);
    current = String(next.name);
    picks.push(current);
  }
  assert.ok(new Set(picks).size >= 3, `picks=${picks.join("|")}`);
});
