import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateQuerySlots,
  slotsToDispatchItems,
  filterRecipesBySlots,
  rankRecipesBySlots,
  type QuerySlots,
} from "./querySlots";

const base = (overrides: Partial<QuerySlots> = {}): QuerySlots => ({
  foodTerm: null,
  protein: null,
  dishType: null,
  method: null,
  maxMinutes: null,
  difficulty: null,
  tags: [],
  wantsCards: true,
  ...overrides,
});

const POOL = [
  { name: "南瓜蒸蛋", cookTime: 15, difficulty: "easy", ingredients: [{ name: "南瓜" }, { name: "蛋" }] },
  { name: "蒜蓉炒菜心", cookTime: 10, difficulty: "easy", ingredients: [{ name: "菜心" }] },
  { name: "紅燒豆腐", cookTime: 35, difficulty: "medium", ingredients: [{ name: "豆腐" }] },
  { name: "魚香茄子", cookTime: 20, difficulty: "easy", ingredients: [{ name: "茄子" }] },
  { name: "清蒸三文魚", cookTime: 18, difficulty: "easy", ingredients: [{ name: "三文魚" }] },
];

test("validateQuerySlots: 魚香茄子 唔可以被 LLM 當魚", () => {
  const slots = validateQuerySlots({ foodTerm: "魚香茄子", protein: "seafood", dishType: "seafood", wantsCards: true }, "想食魚香茄子");
  assert.ok(slots);
  assert.equal(slots.protein, null);
  assert.equal(slots.foodTerm, "魚香茄子");
  assert.equal(slots.dishType, "vegetable");
});

test("validateQuerySlots: 牛油果 唔可以被 LLM 當牛", () => {
  const slots = validateQuerySlots({ foodTerm: "牛油果", protein: "beef", dishType: "meat" }, "想食牛油果");
  assert.ok(slots);
  assert.equal(slots.protein, null);
  assert.equal(slots.dishType, null);
});

test("validateQuerySlots: 湯圓 = dessert 唔係 soup", () => {
  const slots = validateQuerySlots({ foodTerm: "湯圓", dishType: "soup" }, "想食湯圓");
  assert.ok(slots);
  assert.equal(slots.dishType, "dessert");
});

test("validateQuerySlots: 蟹味菇／豬仔包 唔可以當蟹／豬", () => {
  const crab = validateQuerySlots({ foodTerm: "蟹味菇", protein: "seafood" }, "蟹味菇炒菜");
  const pork = validateQuerySlots({ foodTerm: "豬仔包", protein: "pork" }, "豬仔包");
  assert.equal(crab?.protein, null);
  assert.equal(pork?.protein, null);
});

test("validateQuerySlots: 家常菜／小菜／菜式 唔可以當 vegetable role", () => {
  for (const term of ["家常菜", "小菜", "菜式", "開胃菜"]) {
    const slots = validateQuerySlots({ foodTerm: term, dishType: "vegetable" }, term);
    assert.equal(slots?.foodTerm, null, term);
    assert.equal(slots?.dishType, null, term);
  }
});

test("validateQuerySlots: 蛋白由 deterministic 規則補上", () => {
  const egg = validateQuerySlots({}, "想食蛋類嘅餸");
  const fish = validateQuerySlots({}, "有咩快嘅魚");
  assert.equal(egg?.protein, "egg");
  assert.equal(fish?.protein, "seafood");
});

test("validateQuerySlots: maxMinutes clamp 同 wantsCards default", () => {
  const slots = validateQuerySlots({ maxMinutes: 999 }, "慢煮牛腩");
  assert.equal(slots?.maxMinutes, 180);
  assert.equal(slots?.wantsCards, true);
});

test("slotsToDispatchItems: foodTerm 優先，protein fallback，wantsCards=false 回空", () => {
  assert.deepEqual(slotsToDispatchItems(base({ foodTerm: "蛋" })), [{ label: "蛋", kind: "ingredient", qty: 1 }]);
  assert.deepEqual(slotsToDispatchItems(base({ protein: "egg" })), [{ label: "蛋", kind: "ingredient", qty: 1 }]);
  assert.deepEqual(slotsToDispatchItems(base({ foodTerm: "蛋", wantsCards: false })), []);
  assert.deepEqual(slotsToDispatchItems(null), []);
});

test("filterRecipesBySlots: maxMinutes 係 hard constraint", () => {
  const out = filterRecipesBySlots(POOL, base({ maxMinutes: 20 }));
  assert.ok(out.length > 0);
  assert.ok(out.every((row) => Number(row.cookTime) <= 20));
  assert.ok(!out.some((row) => row.name === "紅燒豆腐"));
});

test("filterRecipesBySlots: avoid 係 hard constraint", () => {
  const out = filterRecipesBySlots(POOL, base({ tags: ["avoid:三文魚"] }));
  assert.ok(!out.some((row) => row.name === "清蒸三文魚"));
});

test("filterRecipesBySlots: 蔬菜 包括南瓜／茄子／番茄／菇／青椒", () => {
  const out = filterRecipesBySlots(POOL, base({ foodTerm: "蔬菜" }));
  const names = out.map((row) => row.name);
  assert.ok(names.includes("南瓜蒸蛋"));
  assert.ok(names.includes("魚香茄子"));
  assert.ok(!names.includes("清蒸三文魚"));
});

test("filterRecipesBySlots: protein hard constraint", () => {
  const out = filterRecipesBySlots(POOL, base({ protein: "seafood" }));
  assert.deepEqual(out.map((row) => row.name), ["清蒸三文魚"]);
});

test("rankRecipesBySlots: quick 只排序，唔會刪卡", () => {
  const out = rankRecipesBySlots(POOL, base({ tags: ["quick"] }));
  assert.equal(out.length, POOL.length);
  assert.equal(out[0].name, "蒜蓉炒菜心"); // 10 分鐘最快
});

test("rankRecipesBySlots: 冇 soft tag 保持原序", () => {
  const out = rankRecipesBySlots(POOL, base());
  assert.deepEqual(out.map((row) => row.name), POOL.map((row) => row.name));
});
