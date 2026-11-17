import assert from "node:assert/strict";
import test from "node:test";
import { hardIsMeat, isVegetarianRow, mkExcludeSets, pickSoupMeal, vegetarianMealReply } from "../routers/aiRecipe";

delete process.env.DATABASE_URL;

const row = (id: number, name: string, dishType: string, ingredientNames: string[], tags: string[] = []) => ({
  id,
  name,
  source: "official",
  dishType,
  cookTime: 20,
  servings: 4,
  ingredients: ingredientNames.map((ingredient) => ({ name: ingredient, quantity: "1", unit: "份" })),
  steps: ["1", "2"],
  tags,
});

test("vegetarian tag cannot hide 雞湯／魚露／蠔油 but keeps 素蠔油／雞蛋／牛奶", () => {
  assert.equal(isVegetarianRow(row(1, "上湯娃娃菜", "vegetable", ["娃娃菜", "雞湯"], ["素食"])), false);
  assert.equal(isVegetarianRow(row(2, "泰式炒通菜", "vegetable", ["通菜", "魚露"], ["vegetarian"])), false);
  assert.equal(isVegetarianRow(row(3, "蠔油生菜", "vegetable", ["生菜", "蠔油"], ["素食"])), false);

  assert.equal(isVegetarianRow(row(4, "素蠔油生菜", "vegetable", ["生菜", "素蠔油"], ["素食"])), true);
  assert.equal(isVegetarianRow(row(5, "番茄炒蛋", "egg", ["番茄", "雞蛋"], ["素食"])), true);
  assert.equal(isVegetarianRow(row(6, "牛奶燉蛋", "dessert", ["牛奶", "雞蛋"], ["素食"])), true);
});

test("impure rows are excluded from the vegetarian meal pool, the rest still serves", () => {
  const pool = [
    row(11, "清炒西蘭花", "vegetable", ["西蘭花", "蒜"]),
    row(12, "上湯娃娃菜", "vegetable", ["娃娃菜", "雞湯"], ["素食"]),
    row(13, "番茄薯仔湯", "soup", ["番茄", "薯仔"]),
    row(14, "魚肚羹", "soup", ["魚肚", "薑"], ["素食"]),
    row(15, "蒜蓉炒菠菜", "vegetable", ["菠菜", "蒜"]),
  ];
  const vegRows = pool.filter(isVegetarianRow);
  assert.equal(vegRows.length, 3);

  const picked = pickSoupMeal(vegRows, mkExcludeSets([], []), 2, 1);
  const names = picked.map((recipe) => recipe.name);
  assert.ok(!names.includes("上湯娃娃菜"), "tag-only vegetarian dish must not be served");
  assert.ok(!names.includes("魚肚羹"), "tag-only vegetarian soup must not be served");
  assert.ok(names.includes("番茄薯仔湯"), "pure vegetarian soup must still be served");
  assert.equal(picked.length, 3);
});

test("an all-impure vegetarian pool returns zero cards, never a relaxed card", () => {
  const pool = [
    row(21, "上湯娃娃菜", "vegetable", ["娃娃菜", "雞湯"], ["素食"]),
    row(22, "魚肚羹", "soup", ["魚肚", "薑"], ["素食"]),
  ];
  const picked = pickSoupMeal(pool.filter(isVegetarianRow), mkExcludeSets([], []), 2, 1);
  assert.deepEqual(picked, []);
});

test("菇菌／植物名／素齋開頭唔會再被誤殺", () => {
  const samples = [
    row(31, "羊肚菌炆豆腐", "vegetable", ["羊肚菌", "豆腐"]),
    row(32, "雞腿菇炒菜心", "vegetable", ["雞腿菇", "菜心"]),
    row(33, "魚腥草煲瘦肉湯", "soup", ["魚腥草", "瘦肉"]),
    row(34, "素鮑魚", "vegetable", ["素鮑魚"]),
    row(35, "齋鮑魚", "vegetable", ["齋鮑魚"]),
  ];
  assert.equal(isVegetarianRow(samples[0]), true);
  assert.equal(isVegetarianRow(samples[1]), true);
  assert.equal(isVegetarianRow(samples[2]), false, "瘦肉仍然要剔");
  assert.equal(isVegetarianRow(samples[3]), true);
  assert.equal(isVegetarianRow(samples[4]), true);
  assert.equal(hardIsMeat("魚腥草"), false);
  assert.equal(hardIsMeat("羊肚菌"), false);
  assert.equal(hardIsMeat("雞腿菇"), false);
});

test("放寬誤殺唔等於放生雞湯／魚露／蠔油", () => {
  assert.equal(hardIsMeat("雞湯"), true);
  assert.equal(hardIsMeat("魚露"), true);
  assert.equal(hardIsMeat("蠔油"), true);
});

test("素食套餐短卡一定要有明確提示，唔可以靜靜出少幾張", () => {
  const partial = vegetarianMealReply("zh-TW", 2, 4, "3 餸 1 湯");
  assert.match(partial, /2/);
  assert.match(partial, /4/);
  assert.match(partial, /欠/);

  const full = vegetarianMealReply("zh-TW", 4, 4, "3 餸 1 湯");
  assert.match(full, /食譜庫/);
  assert.doesNotMatch(full, /仲欠/);
});
