import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { recipeContainsAvoid } from "../routers/aiRecipe";
import { extractTypedAvoid } from "../utils/typedAvoid";
import { shouldChargeChefRequest } from "./aiChefPolicy";
import { ALLERGEN_GROUPS, applyAllergenGuard, detectDeclaredAllergens, filterAllergenCards } from "./chefAllergens";
import { summarizeAvoidShadow } from "./chefAvoidMatcher";

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

test("unified matcher: 假朋友唔會被 avoid 誤殺（A1.2）", () => {
  const terms: Array<[string, string, string[]]> = [
    ["牛", "牛油果雞蛋多士", ["牛油果", "雞蛋", "多士"]],
    ["牛", "牛肉炒河", ["牛肉", "河粉"]],
    ["魚", "魚香茄子", ["茄子", "魚香"]],
    ["魚", "木魚花拌豆腐", ["木魚花", "豆腐"]],
    ["魚", "清蒸魚", ["魚"]],
    ["蛋", "高蛋白多士", ["蛋白粉", "多士"]],
    ["蛋", "蛋白質沙律", ["蛋白質", "沙律"]],
    ["蛋", "番茄炒蛋", ["雞蛋", "番茄"]],
    ["奶", "豆奶咖啡", ["豆奶"]],
    ["奶", "椰奶西米露", ["椰奶"]],
    ["奶", "燕麥奶昔", ["燕麥奶"]],
    ["奶", "牛奶咖哩", ["牛奶"]],
    ["雞", "雞蛋多士", ["雞蛋", "多士"]],
    ["雞", "豉油雞", ["雞肉"]],
  ];
  for (const [term, name, ingredients] of terms) {
    const kept = filterAllergenCards([recipe(name, ingredients)], [term]);
    const shouldKeep = ["牛油果雞蛋多士", "魚香茄子", "木魚花拌豆腐", "高蛋白多士", "蛋白質沙律", "豆奶咖啡", "椰奶西米露", "燕麥奶昔", "雞蛋多士"].includes(name);
    assert.equal(kept.length === 1, shouldKeep, `${term} vs ${name}`);
  }
});

test("matcher consistency: 新舊入口對同一張卡結果一致", () => {
  const cards = [
    recipe("蒜蓉蒸蝦", ["蝦"]),
    recipe("清蒸魚", ["魚"]),
    recipe("番茄炒蛋", ["雞蛋", "番茄"]),
    recipe("牛奶咖哩", ["牛奶"]),
    recipe("花生醬多士", ["花生醬"]),
    recipe("蒜蓉炒菜心", ["菜心"]),
    recipe("牛油果沙律", ["牛油果"]),
    recipe("魚香茄子", ["茄子"]),
    recipe("豉油雞", ["雞肉"]),
    recipe("海鮮炒飯", ["蝦仁", "魷魚"]),
  ];
  for (const term of ["蝦", "魚", "蛋", "奶", "花生", "海鮮", "牛", "雞", "豬"]) {
    for (const card of cards) {
      const oldEntry = recipeContainsAvoid(card, [term]);
      const newEntry = filterAllergenCards([card], [term]).length === 0;
      assert.equal(oldEntry, newEntry, `${term} vs ${card.name}`);
    }
  }
});

test("unified matcher: 唔要海鮮 20 次模擬候選卡含海鮮 = 0（library fixture, 無 DB）", () => {
  const catalog = JSON.parse(readFileSync(resolve(process.cwd(), "server/fixtures/aiChef/catalog.json"), "utf8")) as Array<{
    name: string;
    ingredients: string[];
  }>;
  const avoid = extractTypedAvoid("唔要海鮮");
  assert.deepEqual(avoid, ["海鮮"]);
  const SEAFOOD_RE = /海鮮|魚|蝦|蟹|蜆|蠔|魷魚|章魚|帶子|海參|鮑魚|龍蝦|青口|扇貝|三文魚|吞拿魚|鯖魚|鱈魚|石斑|seafood|fish|shrimp|prawn|crab|squid|oyster|scallop/i;
  const FALSE_FRIENDS = /魚香|木魚|魚腥草/g;
  const containsSeafood = (card: { name: string; ingredients: string[] }) =>
    SEAFOOD_RE.test(`${card.name} ${card.ingredients.join(" ")}`.replace(FALSE_FRIENDS, " "));
  let dropped = 0;
  for (let batch = 0; batch < 20; batch++) {
    const start = (batch * 7) % catalog.length;
    const picked = Array.from({ length: 20 }, (_, i) => catalog[(start + i) % catalog.length]);
    const kept = filterAllergenCards(picked, avoid);
    dropped += picked.length - kept.length;
    assert.equal(kept.filter(containsSeafood).length, 0, `batch ${batch}`);
    assert.equal(kept.filter((card) => recipeContainsAvoid(card, avoid)).length, 0, `batch ${batch} matcher`);
  }
  assert.ok(dropped > 0, "fixture must contain seafood cards for this test to mean anything");
});

test("shadow summary: wouldDrop / names<=5 / removedByTerm（A3）", () => {
  const cards = [
    recipe("蒜蓉蝦", ["蝦"]),
    recipe("蝦仁炒蛋", ["蝦仁", "雞蛋"]),
    recipe("清蒸魚", ["魚"]),
    recipe("炒菜心", ["菜心"]),
    recipe("豉汁蒸排骨", ["排骨"]),
    recipe("海鮮炒飯", ["魷魚"]),
    recipe("龍蝦湯", ["龍蝦"]),
  ];
  const shadow = summarizeAvoidShadow(cards, ["蝦", "海鮮"], ALLERGEN_GROUPS);
  assert.equal(shadow.wouldDrop, 5);
  assert.equal(shadow.wouldDropNames.length, 5);
  assert.ok((shadow.removedByTerm["蝦"] ?? 0) >= 1);
  assert.ok((shadow.removedByTerm["海鮮"] ?? 0) >= 1);
});
