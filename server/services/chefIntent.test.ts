import assert from "node:assert/strict";
import test from "node:test";
import { extractMealIngredients, isCannedMealPrompt, resolveChefIntent } from "./chefIntent";

test("one meat and dessert (zh) requests two explicit cards", () => {
  const intent = resolveChefIntent("我淨係要一個肉，同甜品", { mode: "chat" });
  assert.equal(intent.kind, "meal");
  assert.equal(intent.wantsCards, true);
  assert.deepEqual(intent.requested, { total: 2, roles: ["meat", "dessert"] });
});

test("one meat and dessert (en)", () => {
  const intent = resolveChefIntent("I just want one meat and one dessert", { mode: "chat" });
  assert.equal(intent.kind, "meal");
  assert.deepEqual(intent.requested.roles, ["meat", "dessert"]);
});

test("3 dishes 1 soup", () => {
  const intent = resolveChefIntent("請為我設計今晚3餸1湯晚餐", { mode: "chat" });
  assert.equal(intent.kind, "meal");
  assert.equal(intent.requested.total, 4);
  assert.deepEqual(intent.requested.roles, ["meat", "seafood", "vegetable", "soup"]);
});

test("two dishes with no soup", () => {
  const intent = resolveChefIntent("只要兩個餸，唔要湯", { mode: "chat" });
  assert.equal(intent.wantsCards, true);
  assert.equal(intent.requested.total, 2);
  assert.equal(intent.requested.roles.includes("soup"), false);
});

test("technique question must not create cards", () => {
  const intent = resolveChefIntent("蒸魚幾耐？", { mode: "chat" });
  assert.equal(intent.kind, "technique");
  assert.equal(intent.wantsCards, false);
  assert.equal(intent.requested.total, 0);
});

test("small talk must not create cards", () => {
  const intent = resolveChefIntent("how are u", { mode: "chat" });
  assert.equal(intent.kind, "chat");
  assert.equal(intent.wantsCards, false);
});

test("ambiguous food request clarifies instead of cards", () => {
  const intent = resolveChefIntent("我唔知煮咩好", { mode: "chat" });
  assert.equal(intent.kind, "clarify");
  assert.equal(intent.wantsCards, false);
});

test("explicit AI source with food creates cards", () => {
  const intent = resolveChefIntent("番茄炒蛋", { mode: "ai" });
  assert.equal(intent.wantsCards, true);
  assert.equal(intent.requested.total, 1);
});

test("explicit dessert request is a dessert role", () => {
  const intent = resolveChefIntent("我想食甜品", { mode: "chat" });
  assert.equal(intent.wantsCards, true);
  assert.deepEqual(intent.requested.roles, ["dessert"]);
});

test("noodle + dessert is two roles, not soup + dessert", () => {
  const intent = resolveChefIntent("我想食日式，湯面同甜品", { mode: "chat" });
  assert.equal(intent.kind, "meal");
  assert.deepEqual(intent.requested, { total: 2, roles: ["noodle", "dessert"] });
});

test("traditional noodle + dessert is two roles", () => {
  const intent = resolveChefIntent("湯麵同甜品", { mode: "chat" });
  assert.deepEqual(intent.requested.roles, ["noodle", "dessert"]);
});

test("one soup and one noodle stays two roles", () => {
  const intent = resolveChefIntent("一湯一麵", { mode: "chat" });
  assert.deepEqual(intent.requested.roles, ["soup", "noodle"]);
});

test("noodle feature flag off falls back to legacy soup interpretation", () => {
  const intent = resolveChefIntent("我想食日式，湯面同甜品", { mode: "chat", noodleRole: false });
  assert.deepEqual(intent.requested.roles, ["soup", "dessert"]);
});

const DESSERT_REGEX_REGRESSION = [
  { category: "soup", text: "一湯", total: 1, roles: ["soup"] },
  { category: "noodle", text: "一麵", total: 1, roles: ["noodle"] },
  { category: "rice", text: "我想食飯", total: 1, roles: ["any"] },
  { category: "vegetable", text: "一菜", total: 1, roles: ["vegetable"] },
  { category: "seafood", text: "一海鮮", total: 1, roles: ["seafood"] },
  { category: "meat", text: "一肉", total: 1, roles: ["meat"] },
  { category: "fruit", text: "我想食水果", total: 1, roles: ["any"] },
  { category: "breakfast", text: "我想食早餐", total: 1, roles: ["any"] },
] as const;

for (const c of DESSERT_REGEX_REGRESSION) {
  test(`dessert regex does not change ${c.category} intent`, () => {
    const intent = resolveChefIntent(c.text, { mode: "chat" });
    assert.equal(intent.kind, "recipe");
    assert.equal(intent.wantsCards, true);
    assert.deepEqual(intent.requested, { total: c.total, roles: [...c.roles] });
  });
}

test("meal follow-up inherits previous 3-dish 1-soup roles", () => {
  const intent = resolveChefIntent("比另一set我", {
    mode: "chat",
    previousUserText: "今晚三餸一湯，有雞髀同菜",
  });
  assert.equal(intent.kind, "meal");
  assert.equal(intent.wantsCards, true);
  assert.equal(intent.requested.total, 4);
  assert.deepEqual(intent.requested.roles, ["meat", "vegetable", "any", "soup"]);
  assert.equal(intent.reason, "meal_followup");
});

test("chicken + vegetable meal does not invent a seafood role", () => {
  const intent = resolveChefIntent("今晚三餸一湯，有雞髀同菜", { mode: "chat" });
  assert.equal(intent.kind, "meal");
  assert.equal(intent.requested.total, 4);
  assert.equal(intent.requested.roles.includes("seafood"), false);
  assert.ok(intent.requested.roles.includes("meat"));
  assert.ok(intent.requested.roles.includes("vegetable"));
});

const CANNED_MEAL_PROMPT = `請為我設計今晚「3 餸 1 湯」晚餐，總共 4 道菜，適合4人食用。
煮食時間要求：普通約 1 小時。
食材欄每行只寫一種食材，唔好加入功效、備註、口味描述。
請提供完整 4 個食譜，分類如下：
1. 肉類主菜（如豬/牛/雞）
2. 海鮮/其他蛋白主菜（如魚/蝦/豆腐蛋）
3. 蔬菜/小炒
4. 湯水（老火湯）`;

test("canned meal prompt has no ingredient anchors", () => {
  assert.equal(isCannedMealPrompt(CANNED_MEAL_PROMPT), true);
  assert.deepEqual(extractMealIngredients(CANNED_MEAL_PROMPT), []);
});

test("canned meal prompt is a four-card meal intent", () => {
  const intent = resolveChefIntent(CANNED_MEAL_PROMPT, { mode: "library" });
  assert.equal(intent.kind, "meal");
  assert.equal(intent.wantsCards, true);
  assert.equal(intent.requested.total, 4);
  assert.deepEqual(intent.requested.roles, ["meat", "seafood", "vegetable", "soup"]);
  assert.equal(intent.reason, "canned_meal");
});

test("real user ingredients still extract chicken and vegetable", () => {
  assert.deepEqual(extractMealIngredients("今晚三餸一湯，有雞髀同菜"), ["雞髀", "菜"]);
});

test("beef + vegetable extracts 牛扒 and 菜 (P6)", () => {
  assert.deepEqual(extractMealIngredients("食牛扒同菜"), ["牛扒", "菜"]);
  const intent = resolveChefIntent("食牛扒同菜", { mode: "chat" });
  assert.equal(intent.kind, "meal");
  assert.deepEqual(intent.requested, { total: 2, roles: ["meat", "vegetable"] });
});

test("correction with last clause is a one-card beef recipe (P8)", () => {
  assert.deepEqual(extractMealIngredients("你出雞？我要牛扒"), ["牛扒"]);
  const intent = resolveChefIntent("你出雞？我要牛扒", { mode: "chat" });
  assert.equal(intent.kind, "recipe");
  assert.equal(intent.wantsCards, true);
  assert.deepEqual(intent.requested, { total: 1, roles: ["meat"] });
});

test("technique question about beef stays text/technique", () => {
  const intent = resolveChefIntent("牛扒煎幾耐？", { mode: "chat" });
  assert.equal(intent.kind, "technique");
  assert.equal(intent.wantsCards, false);
});

test("liking beef is chat, not a card request", () => {
  const intent = resolveChefIntent("我鍾意牛扒", { mode: "chat" });
  assert.equal(intent.kind, "chat");
  assert.equal(intent.wantsCards, false);
});

test("compound noodle items are one item, not fish + soup", () => {
  for (const text of ["魚湯粉", "湯粉", "魚蛋粉", "魚片河", "牛腩河"]) {
    const intent = resolveChefIntent(text, { mode: "chat" });
    assert.equal(intent.requested.total, 1, text);
    assert.deepEqual(intent.requested.roles, ["noodle"], text);
  }
});

test("fish soup noodles + vegetable is two items", () => {
  const intent = resolveChefIntent("我想食魚湯粉同菜", { mode: "chat" });
  assert.equal(intent.kind, "meal");
  assert.equal(intent.requested.total, 2);
  assert.deepEqual(intent.requested.roles, ["noodle", "vegetable"]);
  assert.ok(!intent.requested.roles.includes("seafood"));
  assert.ok(!intent.requested.roles.includes("soup"));
});

test("Chinese quantity words 樣 / 款 count cards", () => {
  const two = resolveChefIntent("我要2樣餸", { mode: "chat" });
  const three = resolveChefIntent("我要3款菜", { mode: "chat" });
  assert.equal(two.requested.total, 2);
  assert.equal(three.requested.total, 3);
});
