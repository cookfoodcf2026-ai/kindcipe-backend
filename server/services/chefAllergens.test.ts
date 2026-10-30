import assert from "node:assert/strict";
import test from "node:test";
import { shouldChargeChefRequest } from "./aiChefPolicy";
import { applyAllergenGuard, detectDeclaredAllergens, filterAllergenCards } from "./chefAllergens";

const recipe = (name: string, ingredients: string[]) => ({
  name,
  description: "",
  cookTime: 20,
  servings: 4,
  difficulty: "easy" as const,
  ingredients: ingredients.map((ingredient) => ({ name: ingredient, quantity: "1", unit: "份" })),
  steps: ["1"],
  tags: [],
  source: "official" as const,
});

test("declared allergen removes matching cards", () => {
  const cards = [
    recipe("蒜蓉蝦", ["蝦", "蒜"]),
    recipe("蝦仁炒蛋", ["蝦仁", "雞蛋"]),
    recipe("炒菜心", ["菜心"]),
    recipe("冬瓜湯", ["冬瓜"]),
  ];
  const guarded = applyAllergenGuard(cards, ["蝦"], "zh-TW");
  assert.equal(guarded.removed, 2);
  assert.deepEqual(guarded.recipes.map((card) => card.name), ["炒菜心", "冬瓜湯"]);
  assert.equal(guarded.blocked, false);

  const allBlocked = applyAllergenGuard(cards.slice(0, 2), ["蝦"], "zh-TW");
  assert.equal(allBlocked.recipes.length, 0);
  assert.equal(allBlocked.blocked, true);
  assert.equal(allBlocked.clarifyReason, "safety");
  assert.match(allBlocked.content ?? "", /蝦|敏感|allergy/i);
  assert.equal(shouldChargeChefRequest({ served: 0, aiCards: 0 }), false);
});

test("allergen synonym matching", () => {
  const cards = [
    recipe("滑蛋蝦仁", ["蝦仁"]),
    recipe("大蝦伊麵", ["大蝦"]),
    recipe("清蒸魚", ["魚"]),
    recipe("炒菜", ["菜心"]),
  ];
  const kept = filterAllergenCards(cards, ["蝦"]);
  assert.deepEqual(kept.map((card) => card.name), ["清蒸魚", "炒菜"]);
  assert.deepEqual(detectDeclaredAllergens("我對蝦敏感"), ["蝦"]);
  assert.deepEqual(detectDeclaredAllergens("我唔食花生"), ["花生"]);
  assert.deepEqual(detectDeclaredAllergens("我對奶敏感"), ["奶"]);
});

test("no allergen declared → no behaviour change", () => {
  const cards = [recipe("蒜蓉蝦", ["蝦"]), recipe("炒菜", ["菜心"])];
  const guarded = applyAllergenGuard(cards, [], "zh-TW");
  assert.equal(guarded.removed, 0);
  assert.equal(guarded.blocked, false);
  assert.equal(guarded.recipes, cards);
  assert.deepEqual(detectDeclaredAllergens("我想食蝦"), []);
});
