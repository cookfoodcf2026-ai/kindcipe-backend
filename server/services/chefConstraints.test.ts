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
  assert.equal(c.namedDish, "豬軟骨拉麵");
});

test("golden 4b: verb 想要 is stripped from the dish name", () => {
  const c = parseChefConstraints("我想要八寶素煲");
  assert.equal(c.namedDish, "八寶素煲");
});

test("golden 4c: a sentence about being busy is not a dish", () => {
  const c = parseChefConstraints("唔得閒煮飯");
  assert.equal(c.namedDish, null);
  assert.deepEqual(c.pantry, []);
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

test("golden 15: 蛋白質 is a nutrient word, not an egg wish", () => {
  const c = parseChefConstraints("蛋白質");
  assert.equal(c.diet, null);
  assert.equal(c.scenario, "highProtein");
  assert.deepEqual(c.proteins, []);
});

test("golden 15b: vegan is stricter than vegetarian", () => {
  assert.equal(parseChefConstraints("純素").diet, "vegan");
  assert.equal(parseChefConstraints("素食").diet, "vegetarian");
});

test("golden 15c: 素食想食雞 keeps the diet line and drops the protein wish", () => {
  const c = parseChefConstraints("素食想食雞");
  assert.equal(c.diet, "vegetarian");
  assert.deepEqual(c.proteins, []);
});

test("golden 15d: servings are captured", () => {
  const c = parseChefConstraints("請為我設計今晚 3 餸 1 湯，4 人食");
  assert.equal(c.servings, 4);
});

test("golden 15e: 雪櫃得 is an only-mode pantry", () => {
  const c = parseChefConstraints("雪櫃得雞蛋同蔥");
  assert.equal(c.pantryMode, "only");
  assert.deepEqual(c.pantry, ["雞蛋", "蔥"]);
});

test("golden 15f: 「得」inside normal speech is not a pantry", () => {
  const c = parseChefConstraints("雪櫃得雞蛋同蔥同埋唔得閒");
  assert.deepEqual(c.pantry, ["雞蛋", "蔥"]);
});

test("golden 15g: 唔要牛 is a beef negative", () => {
  const c = parseChefConstraints("唔要牛");
  assert.ok(c.negatives.includes("beef"));
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

test("golden 20: 五餸一湯 is a count, not a dish", () => {
  const c = parseChefConstraints("五餸一湯");
  assert.equal(c.namedDish, null);
  assert.equal(c.dishCount, 5);
  assert.equal(c.wantsSoup, true);
});

test("golden 21: 我要一個湯 is not a dish name", () => {
  const c = parseChefConstraints("我要一個湯");
  assert.equal(c.namedDish, null);
  assert.equal(c.wantsSoup, true);
});

test("golden 22: Chinese servings are read (四人食 / 十二人食 / 兩個人食)", () => {
  assert.equal(parseChefConstraints("四人食").servings, 4);
  assert.equal(parseChefConstraints("十二人食").servings, 12);
  assert.equal(parseChefConstraints("兩個人食").servings, 2);
  assert.equal(parseChefConstraints("4人食").servings, 4);
});

test("golden 23: 唔要豬，想食雞 drops pork from the protein wish", () => {
  const c = parseChefConstraints("唔要豬，想食雞");
  assert.ok(c.negatives.includes("pork"));
  assert.deepEqual(c.proteins, ["chicken"]);
});

test("golden 20: 雪櫃有 X 冇「得」都要抽到 pantry", () => {
  const c = parseChefConstraints("雪櫃有青菜、洋蔥、豆腐，可以煮咩");
  assert.deepEqual(c.pantry, ["青菜", "洋蔥", "豆腐"]);
  assert.equal(c.pantryMode, "prefer");
});

test("golden 20b: 屋企有 X 都算 pantry", () => {
  const c = parseChefConstraints("屋企有豆腐同菜心");
  assert.deepEqual(c.pantry, ["豆腐", "菜心"]);
});

test("golden 20c: 雪櫃嘅 X 唔會留低「雪櫃嘅」", () => {
  const c = parseChefConstraints("我用雪櫃嘅雞蛋、番茄煮咩好");
  assert.deepEqual(c.pantry, ["雞蛋", "番茄"]);
});

test("golden 21: 要辣 = spice spicy，清淡 = mild，唔要辣唔可以當想要辣", () => {
  assert.equal(parseChefConstraints("有咩辣嘢食").spice, "spicy");
  assert.equal(parseChefConstraints("我想食清淡啲").spice, "mild");
  assert.equal(parseChefConstraints("煮個菜，唔要辣").spice, "mild");
});

test("golden 22: 自由打字（唔用掣）都要抽到 pantry", () => {
  assert.deepEqual(parseChefConstraints("我得椰菜同兩隻蛋").pantry, ["椰菜", "蛋"]);
  assert.deepEqual(parseChefConstraints("我有雞蛋、番茄、洋蔥，想煮啲簡單嘢").pantry, ["雞蛋", "番茄", "洋蔥"]);
  assert.deepEqual(parseChefConstraints("雪櫃有青菜、洋蔥、豆腐，可以煮咩").pantry, ["青菜", "洋蔥", "豆腐"]);
});
