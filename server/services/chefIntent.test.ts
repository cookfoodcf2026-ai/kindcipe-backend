import assert from "node:assert/strict";
import test from "node:test";
import { resolveChefIntent } from "./chefIntent";

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
