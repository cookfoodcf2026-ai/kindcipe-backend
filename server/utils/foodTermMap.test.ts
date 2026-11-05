import { test } from "node:test";
import assert from "node:assert/strict";
import { pickDishesByTerm, findFoodTermPattern } from "./foodTermMap";
import { CATEGORY_TO_TERMS } from "../services/foodLexicon";

/** 模擬食譜庫（真實菜名，含陷阱：魚柳條成份有蛋漿） */
const POOL = [
  { name: "番茄炒蛋", cookTime: 12, ingredients: [{ name: "番茄" }, { name: "雞蛋" }] },
  { name: "蝦仁炒蛋", cookTime: 15, ingredients: [{ name: "蝦仁" }, { name: "雞蛋" }] },
  { name: "香脆魚柳條", cookTime: 18, ingredients: [{ name: "魚柳" }, { name: "蛋漿" }] },
  { name: "高蛋白芒果西米露", cookTime: 20, ingredients: [{ name: "芒果" }, { name: "蛋白粉" }] },
  { name: "豆腐肉碎滑蛋", cookTime: 20, ingredients: [{ name: "豆腐" }, { name: "豬肉碎" }, { name: "雞蛋" }] },
  { name: "清蒸三文魚", cookTime: 20, ingredients: [{ name: "三文魚" }] },
  { name: "香煎三文魚", cookTime: 25, ingredients: [{ name: "三文魚" }] },
  { name: "蒜蓉炒菜心", cookTime: 10, ingredients: [{ name: "菜心" }] },
  { name: "蒜蓉牛油炒雜菌", cookTime: 12, ingredients: [{ name: "蘑菇" }] },
];

test("findFoodTermPattern: 常見類別詞", () => {
  assert.ok(findFoodTermPattern("蛋類"));
  assert.ok(findFoodTermPattern("豆腐"));
  assert.ok(findFoodTermPattern("魚"));
  assert.equal(findFoodTermPattern("哈利波特"), null);
});

test("蛋類：菜名命中優先，唔會只靠成份有蛋", () => {
  const r = pickDishesByTerm(POOL, "蛋類", { max: 3 });
  assert.ok(r.length > 0);
  assert.ok(r.every((x) => String(x.name).includes("蛋")), "全部要係蛋類菜");
  assert.ok(!r.some((x) => x.name === "香脆魚柳條"), "魚柳條唔應該入選");
});

test("豆腐：命中豆腐菜", () => {
  const r = pickDishesByTerm(POOL, "豆腐", { max: 3 });
  assert.equal(r[0].name, "豆腐肉碎滑蛋");
});

test("魚 + 20 分鐘：只回 ≤20 分鐘", () => {
  const r = pickDishesByTerm(POOL, "魚", { timeLimit: 20, max: 3 });
  assert.ok(r.length > 0);
  assert.ok(r.every((x) => Number(x.cookTime) <= 20), "全部要 ≤20 分鐘");
  assert.ok(r.some((x) => x.name === "清蒸三文魚"));
});

test("菜：命中蔬菜類", () => {
  const r = pickDishesByTerm(POOL, "菜", { max: 3 });
  assert.ok(r.some((x) => x.name === "蒜蓉炒菜心"));
});

test("認唔到嘅詞回空（唔會亂出卡）", () => {
  assert.deepEqual(pickDishesByTerm(POOL, "哈利波特", { max: 3 }), []);
});

test("食物詞守衛：含食物字但唔代表該食物嘅詞回 null／空", () => {
  const guarded = ["高蛋白", "蛋白質", "蛋白粉", "魚香", "牛油果", "牛油", "牛奶", "湯圓", "豬仔包", "蟹味菇"];
  for (const term of guarded) {
    assert.equal(findFoodTermPattern(term), null, `${term} 唔應該命中食物詞`);
    assert.deepEqual(pickDishesByTerm(POOL, term, { max: 3 }), [], `${term} 唔應該出卡`);
  }
});

test("蛋類：菜名含「高蛋白」唔會被當蛋", () => {
  const pool = [
    ...POOL,
    { name: "高蛋白豐盛熱蜜汁牛肉烤地瓜", cookTime: 25, ingredients: [{ name: "蛋白粉" }] },
    { name: "蛋白質能量碗", cookTime: 10, ingredients: [{ name: "蛋白質" }] },
  ];
  const r = pickDishesByTerm(pool, "蛋類", { max: 10 });
  assert.ok(r.length > 0);
  assert.ok(!r.some((x) => String(x.name).includes("高蛋白")), "高蛋白菜名唔應該入選");
  assert.ok(!r.some((x) => String(x.name).includes("蛋白質")), "蛋白質菜名唔應該入選");
});

test("時間全部超標時保留原集（唔會回空）", () => {
  const r = pickDishesByTerm(POOL, "魚", { timeLimit: 1, max: 3 });
  assert.ok(r.length > 0, "寧願超時都唔應該 0 卡");
});

test("品類詞 mapping：海鮮 → 魚蝦蟹，唔含蛋豆腐", () => {
  const seafood = CATEGORY_TO_TERMS["海鮮"];
  assert.ok(seafood.includes("魚"));
  assert.ok(seafood.includes("蝦"));
  assert.ok(seafood.includes("蟹"));
  assert.ok(seafood.includes("青口"));
  assert.equal(seafood.includes("蛋"), false);
  assert.equal(seafood.includes("豆腐"), false);
});

test("品類詞 mapping：肉 → 豬牛羊", () => {
  const meat = CATEGORY_TO_TERMS["肉"];
  assert.ok(meat.includes("豬"));
  assert.ok(meat.includes("牛"));
  assert.ok(meat.includes("雞"));
});

test("品類詞 mapping：辣 → 辣椒花椒", () => {
  const spicy = CATEGORY_TO_TERMS["辣"];
  assert.ok(spicy.includes("辣椒"));
  assert.ok(spicy.includes("花椒"));
  assert.ok(spicy.includes("麻辣"));
});
