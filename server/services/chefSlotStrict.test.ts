import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMealShapePostcondition,
  isStrictVegetableRow,
  isVegetarianRow,
  mkExcludeSets,
  pickSoupMeal,
  processAIChefChat,
} from "../routers/aiRecipe";

delete process.env.DATABASE_URL;

const row = (id: number, name: string, dishType: string, ingredients: string[], tags: string[] = []) => ({
  id,
  name,
  source: "official",
  dishType,
  cookTime: 20,
  servings: 4,
  ingredients: ingredients.map((name) => ({ name, quantity: "1", unit: "份" })),
  steps: ["1", "2"],
  tags,
});

const fullPool = () => [
  row(1, "香煎雞扒", "meat", ["雞扒"]),
  row(2, "豉汁蒸排骨", "meat", ["排骨"]),
  row(3, "清蒸鱸魚", "seafood", ["鱸魚"]),
  row(4, "蒜蓉炒蝦", "seafood", ["蝦"]),
  row(5, "清炒西蘭花", "vegetable", ["西蘭花", "蒜"]),
  row(6, "蒜蓉炒菜心", "vegetable", ["菜心", "蒜"]),
  row(7, "清炒菠菜", "vegetable", ["菠菜", "蒜"]),
  row(8, "番茄薯仔湯", "soup", ["番茄", "薯仔"]),
  row(9, "老火例湯", "soup", ["豬骨"]),
  row(10, "番茄炒蛋", "vegetable", ["番茄", "雞蛋"]),
  row(11, "麻婆豆腐", "vegetable", ["豆腐", "豆瓣醬"]),
  row(12, "蒸水蛋", "vegetable", ["雞蛋"]),
  row(13, "椒鹽豆腐", "vegetable", ["豆腐"]),
  row(14, "鮮蝦蒸蛋", "seafood", ["蝦", "雞蛋"]),
];

const isSoup = (recipe: { name: string; dishType?: string }) =>
  recipe.dishType === "soup" || /湯|羹/.test(recipe.name);

test("1000 次三餸一湯（含素食 200 次）蔬菜位 0 次出蛋／豆腐／肉／海鮮", () => {
  let violations = 0;
  for (let i = 0; i < 1000; i += 1) {
    const diet = i >= 800;
    const pool = diet ? fullPool().filter(isVegetarianRow) : fullPool();
    const picked = pickSoupMeal(pool, mkExcludeSets([], []), 3, 1, undefined, [], [], undefined, undefined, {
      strictVegDishes: diet,
    });
    const dishes = picked.filter((recipe) => !isSoup(recipe));
    if (diet) {
      // 素食 meal 三個餸位全部係蔬菜位。
      for (const dish of dishes) {
        if (!isStrictVegetableRow(dish as unknown as Record<string, unknown>)) violations += 1;
      }
    } else {
      // 標準 3 餸：肉、海鮮、蔬菜；第三個餸 = 蔬菜位。
      const vegSlot = dishes[2];
      if (vegSlot && !isStrictVegetableRow(vegSlot as unknown as Record<string, unknown>)) violations += 1;
    }
  }
  assert.equal(violations, 0, `vegetable slot violations=${violations}/1000`);
});

test("library mode 三餸一湯：蔬菜位只出真蔬菜", async () => {
  const result = await processAIChefChat(
    [{ role: "user", content: "三餸一湯" }],
    990001,
    undefined,
    "library",
    [],
    undefined,
    "zh-TW",
    [],
    false,
    {},
    "replace",
    false,
    false,
    async () => fullPool(),
  );
  assert.equal(result.recipes.length, 4, `served=${result.recipes.length}`);
  const dishes = result.recipes.filter((recipe) => !isSoup(recipe));
  assert.equal(dishes.length, 3);
  assert.equal(
    isStrictVegetableRow(dishes[2] as unknown as Record<string, unknown>),
    true,
    `蔬菜位出咗 ${dishes[2]?.name}`,
  );
});

async function withDietFlag<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.AI_CHEF_DIET_MEAL_FIX;
  process.env.AI_CHEF_DIET_MEAL_FIX = "1";
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.AI_CHEF_DIET_MEAL_FIX;
    else process.env.AI_CHEF_DIET_MEAL_FIX = previous;
  }
}

for (const mode of ["chat", "ai"] as const) {
  test(`${mode} mode 素食三餸一湯：AI 回蛋／豆腐都唔可以入蔬菜位`, async () => {
    const before = [
      row(21, "香煎雞扒", "meat", ["雞扒"]),
      row(10, "番茄炒蛋", "vegetable", ["番茄", "雞蛋"]),
      row(11, "麻婆豆腐", "vegetable", ["豆腐", "豆瓣醬"]),
      row(8, "番茄薯仔湯", "soup", ["番茄", "薯仔"]),
    ];
    const result: any = {
      content: "",
      recipes: before,
      llmUsed: true,
      intentOverride: {
        kind: "meal",
        diet: "vegetarian",
        requested: { total: 4, roles: ["vegetable", "vegetable", "vegetable", "soup"] },
      },
    };
    const out = await withDietFlag(() => applyMealShapePostcondition(result, {
      text: "素食三餸一湯",
      mode,
      lang: "zh-TW",
      avoidIngredients: [],
      searchOverride: async () => fullPool(),
    } as any));
    assert.ok(out.recipes.length > 0, "唔可以靜靜變 0 卡");
    for (const recipe of out.recipes.filter((item) => !isSoup(item))) {
      assert.equal(
        isStrictVegetableRow(recipe as unknown as Record<string, unknown>),
        true,
        `${mode} mode 蔬菜位出咗 ${recipe.name}`,
      );
    }
  });
}

test("冇真蔬菜時寧願短卡，並有 veg_slot_shortfall reason log", () => {
  const logs: string[] = [];
  const original = console.warn;
  console.warn = (...args: any[]) => { logs.push(args.map(String).join(" ")); };
  try {
    const pool = [
      row(1, "香煎雞扒", "meat", ["雞扒"]),
      row(10, "番茄炒蛋", "vegetable", ["番茄", "雞蛋"]),
      row(12, "蒸水蛋", "vegetable", ["雞蛋"]),
      row(8, "番茄薯仔湯", "soup", ["番茄", "薯仔"]),
    ];
    const picked = pickSoupMeal(pool, mkExcludeSets([], []), 3, 1);
    assert.ok(picked.length < 4, `唔應該用蛋補位：served=${picked.length}`);
    assert.ok(logs.some((line) => line.includes("veg_slot_shortfall") && line.includes("no_strict_vegetable")), logs.join("\n"));
  } finally {
    console.warn = original;
  }
});
