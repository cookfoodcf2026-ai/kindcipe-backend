import assert from "node:assert/strict";
import test from "node:test";
import { cardPassesHardConstraint, hasHardConstraint, filterRowsForSwap } from "../routers/aiRecipe";

const card = (name: string, ingredients: string[] = [], extra: Record<string, unknown> = {}): any => ({
  name,
  ingredients: ingredients.map((n) => ({ name: n, quantity: "", unit: "" })),
  cookTime: 20,
  tags: [],
  ...extra,
});

test("hard v2: light/kids rejects heavy or spicy names", () => {
  const input = { text: "清淡" };
  assert.equal(cardPassesHardConstraint(card("蒜蓉炒菜心"), input), true);
  assert.equal(cardPassesHardConstraint(card("麻辣雞煲"), input), false);
  assert.equal(cardPassesHardConstraint(card("炸雞"), input), false);
  assert.equal(cardPassesHardConstraint(card("黑椒牛柳"), input), false);
});

test("hard v2: a named protein ask rejects non-matching cards", () => {
  const input = { text: "我想食魚" };
  assert.equal(cardPassesHardConstraint(card("清蒸石斑", ["石斑"]), input), true);
  assert.equal(cardPassesHardConstraint(card("番茄炒蛋", ["雞蛋", "番茄"]), input), false);
  assert.equal(cardPassesHardConstraint(card("沙茶炒麵", ["麵", "沙茶"]), input), false);
});

test("hard v2: a rice-cooker ask keeps only rice-cooker / one-pot dishes", () => {
  const input = { text: "電飯煲" };
  assert.equal(cardPassesHardConstraint(card("電飯煲豉油雞", ["雞"]), input), true);
  assert.equal(cardPassesHardConstraint(card("豉汁蒸豆腐", ["豆腐"], { tags: ["onepot"] }), input), true);
  assert.equal(cardPassesHardConstraint(card("黑椒牛柳", ["牛柳"]), input), false);
});

test("hard v2: high-protein needs at least two protein groups", () => {
  const input = { text: "蛋白" };
  assert.equal(cardPassesHardConstraint(card("雞胸炒蝦仁", ["雞胸", "蝦仁"]), input), true);
  assert.equal(cardPassesHardConstraint(card("烚蛋", ["雞蛋"]), input), false);
  assert.equal(cardPassesHardConstraint(card("沙茶海鮮炒麵", ["麵", "蝦"]), input), false);
});

test("hard v2: vegetarian rejects meat/seafood but keeps safe lookalikes", () => {
  const input = { text: "素食" };
  assert.equal(cardPassesHardConstraint(card("紅燒豆腐", ["豆腐"]), input), true);
  assert.equal(cardPassesHardConstraint(card("牛油果沙律", ["牛油果"]), input), true);
  assert.equal(cardPassesHardConstraint(card("魚香茄子", ["茄子"]), input), true);
  assert.equal(cardPassesHardConstraint(card("豬扒飯", ["豬扒"]), input), false);
  assert.equal(cardPassesHardConstraint(card("清蒸魚", ["魚"]), input), false);
});

test("hard v2: avoid list is enforced", () => {
  const input = { text: "3 餸 1 湯", avoidIngredients: ["蝦"] };
  assert.equal(cardPassesHardConstraint(card("蒜蓉蒸蝦", ["蝦"]), input), false);
  assert.equal(cardPassesHardConstraint(card("蒜蓉蒸雞", ["雞"]), input), true);
});

test("hard v2: cookTimeMax rejects over-limit and unknown cookTime", () => {
  assert.equal(cardPassesHardConstraint(card("快炒菜", ["菜"], { cookTime: 15 }), { text: "快手", cookTimeMax: 30 }), true);
  assert.equal(cardPassesHardConstraint(card("慢燉牛腩", ["牛腩"], { cookTime: 90 }), { text: "快手", cookTimeMax: 30 }), false);
  assert.equal(cardPassesHardConstraint(card("無時間", ["菜"], { cookTime: null }), { text: "快手", cookTimeMax: 30 }), false);
  assert.equal(cardPassesHardConstraint(card("無時間", ["菜"], { cookTime: "" }), { text: "快手", cookTimeMax: 30 }), false);
});

test("hard v2: a plain 3餸1湯 carries no hard constraint (regression guard)", () => {
  const plain = { text: "4 人食。3 餸 1 湯" };
  assert.equal(hasHardConstraint(plain), false);
  // The unified filter must leave a normal 3餸1湯 untouched.
  const cards = [
    card("豉汁蒸排骨", ["排骨"]),
    card("蒜蓉炒菜心", ["菜心"]),
    card("番茄炒蛋", ["番茄", "雞蛋"]),
    card("冬瓜湯", ["冬瓜"]),
  ];
  assert.equal(cards.filter((c) => cardPassesHardConstraint(c, plain)).length, cards.length);
});

test("hard v2: constraints / avoid / time turn the gate on", () => {
  assert.equal(hasHardConstraint({ text: "3 餸 1 湯；清淡" }), true);
  assert.equal(hasHardConstraint({ text: "3 餸 1 湯", avoidIngredients: ["蝦"] }), true);
  assert.equal(hasHardConstraint({ text: "3 餸 1 湯", cookTimeMax: 30 }), true);
  assert.equal(hasHardConstraint({ text: "蛋白" }), true);
});

test("swap: filterRowsForSwap keeps only same dishType", () => {
  const rows: Record<string, unknown>[] = [
    { name: "番茄薯仔湯", tags: [], dishType: "" },
    { name: "清蒸石斑", tags: [], dishType: "" },
    { name: "蒜蓉炒菜心", tags: [], dishType: "" },
    { name: "豉汁蒸排骨", tags: [], dishType: "" },
  ];
  const soups = filterRowsForSwap(rows, "soup");
  assert.deepEqual(soups.map((r) => r.name), ["番茄薯仔湯"]);
  const meats = filterRowsForSwap(rows, "meat");
  assert.deepEqual(meats.map((r) => r.name), ["豉汁蒸排骨"]);
});

test("swap: filterRowsForSwap is a no-op for empty/unknown dishType", () => {
  const rows: Record<string, unknown>[] = [
    { name: "番茄薯仔湯", tags: [], dishType: "" },
    { name: "清蒸石斑", tags: [], dishType: "" },
  ];
  assert.equal(filterRowsForSwap(rows, "").length, 2);
  assert.equal(filterRowsForSwap(rows, "  ").length, 2);
  assert.equal(filterRowsForSwap(rows, "dessert").length, 0);
});

test("hard v2: 品類詞 avoid 海鮮 過濾海鮮卡", () => {
  const input = { text: "有咩推介", avoidIngredients: ["海鮮"] };
  assert.equal(cardPassesHardConstraint(card("蒜香白酒煮青口", ["青口"]), input), false);
  assert.equal(cardPassesHardConstraint(card("蒜蓉蒸蝦", ["蝦"]), input), false);
  assert.equal(cardPassesHardConstraint(card("蒜蓉炒菜心", ["菜心"]), input), true);
});

test("hard v2: 品類詞 avoid 肉 過濾肉卡", () => {
  const input = { text: "有咩推介", avoidIngredients: ["肉"] };
  assert.equal(cardPassesHardConstraint(card("豉汁蒸排骨", ["排骨"]), input), false);
  assert.equal(cardPassesHardConstraint(card("蒜蓉炒菜心", ["菜心"]), input), true);
});

test("hard v2: 品類詞 avoid 辣 過濾辣卡", () => {
  const input = { text: "有咩推介", avoidIngredients: ["辣"] };
  assert.equal(cardPassesHardConstraint(card("麻辣雞煲", ["雞"]), input), false);
  assert.equal(cardPassesHardConstraint(card("蒜蓉炒菜心", ["菜心"]), input), true);
});

test("hard v2: vegetarian rejects English meat names (Li's Waterless Chicken)", () => {
  const input = { text: "素食 3餸1湯" };
  assert.equal(cardPassesHardConstraint(card("Li's Waterless Chicken and Vegetable Pot", ["Chicken thigh fillets"]), input), false);
  assert.equal(cardPassesHardConstraint(card("蒜蓉炒菜心", ["菜心"]), input), true);
  assert.equal(cardPassesHardConstraint(card("紅燒豆腐", ["豆腐"]), input), true);
});

test("hard v2: vegetarian keeps English safe lookalikes", () => {
  const input = { text: "素食" };
  assert.equal(cardPassesHardConstraint(card("Grilled chicken of the woods mushrooms", ["chicken of the woods"]), input), true);
  assert.equal(cardPassesHardConstraint(card("Oyster mushroom soup", ["oyster mushroom"]), input), true);
});

// 「蛋奶素」字面含「蛋」，唔可以被當成「我想食蛋」而刪走冇蛋嘅素食卡。
test("素食（蛋奶素）唔會因為字面有「蛋」而刪走冇蛋嘅素菜", () => {
  const input = { text: "素食（蛋奶素，無肉無海鮮）" };
  for (const name of ["香菇", "涼拌拍青瓜", "清炒時蔬", "紅燒豆腐", "牛肝菌炒飯"]) {
    assert.equal(cardPassesHardConstraint(card(name), input), true, name);
  }
  // 真肉仍然要刪
  assert.equal(cardPassesHardConstraint(card("當紅炸子雞"), input), false);
  assert.equal(cardPassesHardConstraint(card("青紅蘿蔔豬骨湯"), input), false);
});

// 但「我想食蛋」呢種真蛋白請求仍然要生效。
test("真蛋白請求仍然生效：我要食蛋", () => {
  const input = { text: "我想食蛋" };
  assert.equal(cardPassesHardConstraint(card("番茄炒蛋"), input), true);
  assert.equal(cardPassesHardConstraint(card("清炒時蔬"), input), false);
});
