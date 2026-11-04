import test from "node:test";
import assert from "node:assert/strict";
import { parseChefConstraints } from "./chefConstraints";

/**
 * Step 1 golden contract: the 19 bugs reported today, frozen as expectations.
 * These assert what the sentence MEANS, not how cards are picked — so Step 2
 * can change retrieval freely as long as the meaning stays put.
 */

test("golden 1: 素食 sets the diet line and no protein wish", () => {
  const c = parseChefConstraints("素食");
  assert.equal(c.diet, "vegetarian");
  assert.deepEqual(c.proteins, []);
  assert.equal(c.scenario, "vegetarian");
});

test("golden 2: 蛋白·健身 is a highProtein scenario", () => {
  const c = parseChefConstraints("蛋白/健身");
  assert.equal(c.scenario, "highProtein");
});

test("golden 3: named dish 八寶素煲 is captured", () => {
  const c = parseChefConstraints("八寶素煲");
  assert.equal(c.namedDish, "八寶素煲");
});

test("golden 4: 豬軟骨拉麵 is a named dish", () => {
  const c = parseChefConstraints("我要豬軟骨拉麵");
  assert.ok(c.namedDish && c.namedDish.includes("豬軟骨拉麵"));
});

test("golden 5: pantry list with colon", () => {
  const c = parseChefConstraints("我想用以下食材煮餸：青菜、洋蔥、豆腐。");
  assert.deepEqual(c.pantry.slice(0, 3), ["青菜", "洋蔥", "豆腐"]);
});

test("golden 6: pantry list without colon", () => {
  const c = parseChefConstraints("雪櫃得雞蛋同蔥");
  assert.ok(c.pantry.includes("雞蛋"));
  assert.ok(c.pantry.includes("蔥"));
});

test("golden 7: 20 分鐘 is a hard time limit", () => {
  const c = parseChefConstraints("20分鐘煮好");
  assert.equal(c.maxMinutes, 20);
});

test("golden 8: 唔要辣 is a negative constraint", () => {
  const c = parseChefConstraints("唔要辣");
  assert.ok(c.negatives.includes("spicy"));
});

test("golden 9: 想食魚 wants fish protein", () => {
  const c = parseChefConstraints("想食魚");
  assert.deepEqual(c.proteins, ["fish"]);
});

test("golden 10: 有咩蒸嘅餸 has no protein wish", () => {
  const c = parseChefConstraints("有咩蒸嘅餸");
  assert.deepEqual(c.proteins, []);
});

test("golden 11: 隨機抽 is not a named dish", () => {
  const c = parseChefConstraints("食譜庫隨機抽");
  assert.equal(c.namedDish, null);
});

test("golden 12: 3 餸 1 湯 → 3 dishes + soup", () => {
  const c = parseChefConstraints("請為我設計今晚 3 餸 1 湯，4 人食");
  assert.equal(c.dishCount, 3);
  assert.equal(c.wantsSoup, true);
});

test("golden 13: 一鍋到底 maps to the ricecooker scenario", () => {
  const c = parseChefConstraints("用電飯煲一鍋煮嘅懶人食譜");
  assert.equal(c.scenario, "ricecooker");
});

test("golden 14: 清淡健康嘅家常菜 is the healthy scenario", () => {
  const c = parseChefConstraints("清淡健康嘅家常菜，少油少鹽");
  assert.equal(c.scenario, "healthy");
});

test("golden 15: 蛋白質 wants egg/soy style protein words, no diet line", () => {
  const c = parseChefConstraints("蛋白質");
  assert.equal(c.diet, null);
  assert.equal(c.scenario, "highProtein");
});

test("golden 16: 即場煮 wording is not a named dish", () => {
  const c = parseChefConstraints("用 AI 生成食譜");
  assert.equal(c.namedDish, null);
});

test("golden 17: 想食雞 wants chicken", () => {
  const c = parseChefConstraints("想食雞");
  assert.ok(c.proteins.includes("chicken"));
});

test("golden 18: 素食 + 快手 keeps both diet and scenario", () => {
  const c = parseChefConstraints("素食快手");
  assert.equal(c.diet, "vegetarian");
  assert.equal(c.scenario, "vegetarian");
});

test("golden 19: 小朋友啱食 is the kids scenario", () => {
  const c = parseChefConstraints("小朋友啱食");
  assert.equal(c.scenario, "kids");
});
