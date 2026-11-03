import { test } from "node:test";
import assert from "node:assert/strict";
import { pickDishesByTerm, findFoodTermPattern } from "./foodTermMap";

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

test("時間全部超標時保留原集（唔會回空）", () => {
  const r = pickDishesByTerm(POOL, "魚", { timeLimit: 1, max: 3 });
  assert.ok(r.length > 0, "寧願超時都唔應該 0 卡");
});

test("守衛：魚香／牛油果／湯圓／豬仔包／蟹味菇 唔會被當該食材", () => {
  assert.equal(findFoodTermPattern("魚香茄子"), null);
  assert.equal(findFoodTermPattern("牛油果沙律"), null);
  assert.equal(findFoodTermPattern("湯圓"), null);
  assert.equal(findFoodTermPattern("豬仔包"), null);
  assert.equal(findFoodTermPattern("蟹味菇"), null);
});

test("守衛：家常菜／宴客菜／開胃菜／小菜／菜式 唔係 vegetable 詞", () => {
  for (const term of ["家常菜", "宴客菜", "開胃菜", "小菜", "菜式"]) {
    assert.equal(findFoodTermPattern(term), null, term);
  }
  assert.ok(findFoodTermPattern("蔬菜"));
});

test("守衛：魚 term 唔會撈到魚香茄子", () => {
  const pool = [
    { name: "魚香茄子", ingredients: [{ name: "茄子" }] },
    { name: "清蒸三文魚", ingredients: [{ name: "三文魚" }] },
  ];
  const r = pickDishesByTerm(pool, "魚", { max: 5 });
  assert.deepEqual(r.map((x) => x.name), ["清蒸三文魚"]);
});

test("蔬菜 term 包南瓜／茄子／番茄／菇／青椒", () => {
  const pool = [
    { name: "南瓜蒸蛋", ingredients: [{ name: "南瓜" }] },
    { name: "魚香茄子", ingredients: [{ name: "茄子" }] },
    { name: "番茄炒蛋", ingredients: [{ name: "番茄" }] },
    { name: "蒜蓉炒雜菌", ingredients: [{ name: "蘑菇" }] },
    { name: "青椒炒肉", ingredients: [{ name: "青椒" }] },
    { name: "清蒸三文魚", ingredients: [{ name: "三文魚" }] },
  ];
  const r = pickDishesByTerm(pool, "蔬菜", { max: 10 });
  const names = r.map((x) => x.name);
  assert.ok(names.includes("南瓜蒸蛋"));
  assert.ok(names.includes("魚香茄子"));
  assert.ok(names.includes("番茄炒蛋"));
  assert.ok(names.includes("蒜蓉炒雜菌"));
  assert.ok(names.includes("青椒炒肉"));
  assert.ok(!names.includes("清蒸三文魚"));
});
