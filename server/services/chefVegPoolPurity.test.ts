import assert from "node:assert/strict";
import test from "node:test";
import { hardIsMeat, isVegetarianRow, mkExcludeSets, pickSoupMeal, processAIChefChat, vegetarianMealReply } from "../routers/aiRecipe";
import { resolveChefIntent } from "./chefIntent";

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

// ─── End-to-end: 「素食」單卡一定要有純素卡（scenario 池全雜質時補池） ───
async function callChef(
  text: string,
  mode: "chat" | "library",
  pool: Record<string, unknown>[],
  scenarioPool?: Record<string, unknown>[],
) {
  const queries: string[] = [];
  const searchOverride = async (query: string) => {
    queries.push(query);
    if (query === "") return pool;
    if (query.includes("素食")) return scenarioPool ?? pool;
    return pool.filter((r) => String(r.name ?? "").includes(query));
  };
  const res = await processAIChefChat(
    [{ role: "user", content: text }],
    1,
    undefined,
    mode,
    [],
    undefined,
    "zh-TW",
    [],
    false,
    {},
    "replace",
    false,
    false,
    searchOverride as any,
  );
  return { res, queries };
}

const pureVeg = [
  row(41, "清炒西蘭花", "vegetable", ["西蘭花", "蒜"]),
  row(42, "番茄炒蛋", "egg", ["番茄", "雞蛋"]),
];
const impureVeg = [
  row(43, "上湯娃娃菜", "vegetable", ["娃娃菜", "雞湯"], ["素食"]),
  row(44, "蠔油生菜", "vegetable", ["生菜", "蠔油"], ["素食"]),
];

test("素食：scenario 池全部雜質時，用全庫純素卡補池（唔准放行肉／海鮮）", async () => {
  const { res, queries } = await callChef("素食", "chat", [...impureVeg, ...pureVeg], impureVeg);
  assert.ok(res.recipes.length >= 1, "庫內有合格素食卡就一定要出 ≥1 張");
  for (const recipe of res.recipes) {
    assert.equal(isVegetarianRow(recipe as any), true, `${recipe.name} 唔係純素`);
  }
  assert.equal(queries.includes(""), true, "scenario 池空要先補全庫");
});

test("素食菜式（蛋奶素，無肉無海鮮）：library mode 都要出 ≥1 張純素", async () => {
  const { res } = await callChef("素食菜式（蛋奶素，無肉無海鮮）", "library", [...impureVeg, ...pureVeg], impureVeg);
  assert.ok(res.recipes.length >= 1);
  for (const recipe of res.recipes) assert.equal(isVegetarianRow(recipe as any), true);
});

test("庫內完全冇合格素食卡：回 0，唔准硬出肉／海鮮", async () => {
  const meat = row(45, "豉油雞翼", "meat", ["雞翼", "豉油"]);
  const { res } = await callChef("素食", "chat", [...impureVeg, meat], [...impureVeg, meat]);
  assert.deepEqual(res.recipes, []);
});

test("非素食 request（雞翼）行為不變：唔會觸發素食補池", async () => {
  const chicken = row(46, "蜜汁雞翼", "meat", ["雞翼", "蜜糖"]);
  const { res, queries } = await callChef("雞翼", "chat", [chicken, ...pureVeg]);
  assert.deepEqual(res.recipes, []);
  assert.equal(queries.includes("素食"), false, "非素食 request 唔應該入素食 scenario 分支");
});

// ─── Blocking 1：diet + swap-turn 嘅 library 請求都唔准出含雞湯／魚露／蠔油嘅卡 ───
test("素食 swap-turn（library）：換卡都要過純度，唔准出雞湯／蠔油卡", async () => {
  const { res } = await callChef(
    "庫內搜尋：素食；同類別：vegetable",
    "library",
    [...impureVeg, ...pureVeg],
    [...impureVeg, ...pureVeg],
  );
  assert.ok(res.recipes.length >= 1, "池內有純素卡就一定要換到 1 張");
  for (const recipe of res.recipes) {
    assert.equal(isVegetarianRow(recipe as any), true, `${recipe.name} 唔係純素（swap 漏咗純度過濾）`);
  }
});

// ─── Blocking 2：素食湯補池後只可出湯 ───
test("素食湯：補全庫時只准揀湯，唔可以出甜品／炒菜", async () => {
  const soup = row(47, "番茄薯仔湯", "soup", ["番茄", "薯仔"]);
  const dessert = row(48, "芒果布甸", "dessert", ["芒果", "椰漿"]);
  const { res, queries } = await callChef(
    "素食湯",
    "chat",
    [dessert, ...pureVeg, soup],
    [...impureVeg, dessert],
  );
  assert.ok(res.recipes.length >= 1, "庫內有純素湯就一定要出 ≥1 張");
  for (const recipe of res.recipes) {
    assert.match(recipe.name, /湯/, `${recipe.name} 唔係湯（補池冇跟 requested role）`);
  }
  assert.equal(queries.includes(""), true, "scenario 池剔完要補全庫");
});

// ─── 「唔要湯」已知限制：角色唔會被「湯」字誤判成 soup，但未當 negative 過濾（待修）───
test("「素食，唔要湯」角色唔會被「湯」字誤判成 soup，亦唔會出肉／海鮮卡（唔要湯未做 negative：已知限制）", async () => {
  const intent = resolveChefIntent("素食，唔要湯", { mode: "chat" });
  assert.equal(intent.diet, "vegetarian");
  assert.ok(
    !intent.requested.roles.includes("soup"),
    `role 唔應該被「湯」字誤判成 soup：${intent.requested.roles.join("|") || "(empty)"}`,
  );

  const soup = row(51, "番茄薯仔湯", "soup", ["番茄", "薯仔"]);
  const meat = row(52, "豉油雞翼", "meat", ["雞翼", "豉油"]);
  const seafood = row(53, "清蒸石斑", "seafood", ["石斑", "薑"]);
  const { res, queries } = await callChef(
    "素食，唔要湯",
    "chat",
    [soup, ...pureVeg, meat, seafood],
    [soup, meat, seafood],
  );
  assert.ok(res.recipes.length >= 1, "庫內有純素卡就一定要出 ≥1 張");
  for (const recipe of res.recipes) {
    assert.equal(isVegetarianRow(recipe as any), true, `${recipe.name} 唔係純素（fail-closed 失效）`);
  }
  assert.equal(queries.includes("素食"), true, "素食 request 應該入 vegetarian 分支");
});

// ─── 行為鎖定：「少肉」「清淡」唔係 vegetarian diet ───
test("「少肉」「清淡」唔會被當成素食 diet", () => {
  for (const text of ["少肉", "清淡", "清淡啲", "少肉少油"]) {
    const intent = resolveChefIntent(text, { mode: "chat" });
    assert.equal(intent.diet, undefined, `${text} 唔應該係 diet`);
    assert.notEqual(intent.reason, "vegetarian", `${text} 唔應該入素食分支`);
  }
});
