import assert from "node:assert/strict";
import test from "node:test";
import { deriveScenarios } from "./scenario";
import { diffScenarioTags } from "../scripts/recomputeScenarioTags";

test("easy non-kids dish is not tagged kids", () => {
  const scenarios = deriveScenarios({
    name: "蒜泥白肉",
    description: "蒜泥白肉",
    difficulty: "簡單",
    dishType: "meat",
    cookTime: 40,
    tags: ["家常"],
    ingredients: [{ name: "五花肉" }, { name: "蒜泥" }],
    steps: ["煮熟切片", "淋上蒜泥醬"],
  });
  assert.equal(scenarios.includes("kids"), false, scenarios.join(","));
});

test("braised dish with short cookTime is not quick", () => {
  const scenarios = deriveScenarios({
    name: "發財好市炆豬手",
    description: "意頭菜",
    difficulty: "簡單",
    dishType: "meat",
    cookTime: 30,
    tags: [],
    ingredients: [{ name: "豬手" }, { name: "髮菜" }],
    steps: ["豬手汆水", "加入配料炆 120 分鐘"],
  });
  assert.equal(scenarios.includes("quick"), false, scenarios.join(","));
});

test("kid friendly dessert still tagged", () => {
  const scenarios = deriveScenarios({
    name: "兒童香蕉布丁",
    description: "香蕉布丁",
    difficulty: "簡單",
    dishType: "dessert",
    cookTime: 20,
    tags: [],
    ingredients: [{ name: "香蕉" }, { name: "牛奶" }],
    steps: ["拌勻", "冷藏"],
  });
  assert.equal(scenarios.includes("kids"), true, scenarios.join(","));
});

test("ricecooker: braised noodle with pot-only steps is NOT one-pot", () => {
  const scenarios = deriveScenarios({
    name: "慢燉牛肉蘿蔔寬粉",
    description: "慢火燉煮嘅寬粉",
    dishType: "noodle",
    cookTime: 60,
    ingredients: [{ name: "牛肉" }, { name: "白蘿蔔" }, { name: "寬粉" }],
    steps: ["牛肉汆水", "加入白蘿蔔炆 30 分鐘", "加入寬粉煲至軟"],
  });
  assert.equal(scenarios.includes("ricecooker"), false, scenarios.join(","));
});

test("ricecooker: electric-cooker dish in the name IS one-pot", () => {
  const scenarios = deriveScenarios({
    name: "電飯煲臘味飯",
    dishType: "rice",
    cookTime: 30,
    ingredients: [{ name: "米" }, { name: "臘腸" }],
    steps: ["全部放入電飯煲", "按煮飯"],
  });
  assert.equal(scenarios.includes("ricecooker"), true, scenarios.join(","));
});

test("recompute detects drift for braised dish losing quick tag", () => {
  const diff = diffScenarioTags({
    source: "custom",
    id: 900001,
    name: "發財好市炆豬手",
    description: "意頭菜",
    cook_time: 30,
    difficulty: "簡單",
    dish_type: "meat",
    recipe_category: "中菜",
    tags: JSON.stringify(["家常"]),
    ingredients: JSON.stringify([{ name: "豬手" }, { name: "髮菜" }]),
    steps: JSON.stringify(["豬手汆水", "加入配料炆 120 分鐘"]),
    scenario_tags: JSON.stringify(["quick"]),
  });
  assert.equal(diff.changed, true);
  assert.equal(diff.after.includes("quick"), false);
});

test("highProtein: one protein group with many fish is not enough", () => {
  const scenarios = deriveScenarios({
    name: "香煎三文魚",
    ingredients: [{ name: "三文魚" }, { name: "吞拿魚" }, { name: "鯖魚" }],
    steps: ["煎香"],
  });
  assert.equal(scenarios.includes("highProtein"), false, scenarios.join(","));
});

test("highProtein: two distinct groups are enough", () => {
  const scenarios = deriveScenarios({
    name: "雞胸炒蛋",
    ingredients: [{ name: "雞胸" }, { name: "雞蛋" }],
    steps: ["炒熟"],
  });
  assert.equal(scenarios.includes("highProtein"), true, scenarios.join(","));
});

test("highProtein: fish plus fish is still one group", () => {
  const scenarios = deriveScenarios({
    name: "雙魚碗",
    ingredients: [{ name: "三文魚" }, { name: "吞拿魚" }],
    steps: ["拌勻"],
  });
  assert.equal(scenarios.includes("highProtein"), false, scenarios.join(","));
});

test("highProtein: smoothie can be drink and highProtein", () => {
  const scenarios = deriveScenarios({
    name: "高蛋白希臘優格奶昔",
    dishType: "drink",
    ingredients: [
      { name: "希臘優格" },
      { name: "蛋白粉" },
      { name: "香蕉" },
    ],
    steps: ["打勻"],
  });
  assert.equal(scenarios.includes("highProtein"), true, scenarios.join(","));
  assert.equal(scenarios.includes("quick"), false, scenarios.join(","));
});

test("highProtein: pure vegetables do not qualify", () => {
  const scenarios = deriveScenarios({
    name: "蒜蓉菜心",
    dishType: "vegetable",
    ingredients: [{ name: "菜心" }, { name: "蒜蓉" }],
    steps: ["炒熟"],
  });
  assert.equal(scenarios.includes("highProtein"), false, scenarios.join(","));
});

test("highProtein: red meat plus dairy qualifies", () => {
  const scenarios = deriveScenarios({
    name: "牛肉芝士捲",
    ingredients: [{ name: "牛肉" }, { name: "芝士" }],
    steps: ["捲起"],
  });
  assert.equal(scenarios.includes("highProtein"), true, scenarios.join(","));
});

test("highProtein: soy plus egg qualifies", () => {
  const scenarios = deriveScenarios({
    name: "豆腐炒蛋",
    ingredients: [{ name: "豆腐" }, { name: "雞蛋" }],
    steps: ["炒熟"],
  });
  assert.equal(scenarios.includes("highProtein"), true, scenarios.join(","));
});

test("highProtein: dairy alone is only one group", () => {
  const scenarios = deriveScenarios({
    name: "牛奶芝士杯",
    dishType: "dessert",
    ingredients: [{ name: "牛奶" }, { name: "芝士" }],
    steps: ["拌勻"],
  });
  assert.equal(scenarios.includes("highProtein"), false, scenarios.join(","));
});

test("highProtein: free tags are ignored", () => {
  const scenarios = deriveScenarios({
    name: "蒜蓉菜心",
    tags: ["高蛋白", "protein"],
    ingredients: [{ name: "菜心" }, { name: "蒜蓉" }],
    steps: ["炒熟"],
  });
  assert.equal(scenarios.includes("highProtein"), false, scenarios.join(","));
});

test("highProtein: existing five scenarios are not removed", () => {
  const scenarios = deriveScenarios({
    name: "雞胸炒蛋",
    cookTime: 20,
    dishType: "meat",
    tags: ["清淡"],
    ingredients: [{ name: "雞胸" }, { name: "雞蛋" }],
    steps: ["炒熟"],
  });
  assert.equal(scenarios.includes("quick"), true, scenarios.join(","));
  assert.equal(scenarios.includes("healthy"), true, scenarios.join(","));
  assert.equal(scenarios.includes("highProtein"), true, scenarios.join(","));
  assert.equal(scenarios.includes("kids"), false, scenarios.join(","));
  assert.equal(scenarios.includes("guest"), false, scenarios.join(","));
  assert.equal(scenarios.includes("ricecooker"), false, scenarios.join(","));
});

test("highProtein: poultry plus fish qualifies", () => {
  const scenarios = deriveScenarios({
    name: "雞肉三文魚沙律",
    ingredients: [{ name: "雞胸" }, { name: "三文魚" }],
    steps: ["拌勻"],
  });
  assert.equal(scenarios.includes("highProtein"), true, scenarios.join(","));
});

test("highProtein: 牛油果 is not red meat", () => {
  const scenarios = deriveScenarios({
    name: "牛油果",
    ingredients: [{ name: "牛油果" }, { name: "雞蛋" }],
    steps: ["拌勻"],
  });
  assert.equal(scenarios.includes("highProtein"), false, scenarios.join(","));
});

function vegetarianFor(ingredients: Array<{ name: string }>, tags: string[] = []): boolean {
  return deriveScenarios({
    name: "測試菜式",
    tags,
    ingredients,
    steps: ["煮"],
  }).includes("vegetarian");
}

test("vegetarian: pure vegetables qualify", () => {
  assert.equal(vegetarianFor([{ name: "菜心" }, { name: "蒜蓉" }]), true);
});

test("vegetarian: tofu qualifies", () => {
  assert.equal(vegetarianFor([{ name: "豆腐" }, { name: "醬油" }]), true);
});

test("vegetarian: egg qualifies (lacto-ovo)", () => {
  assert.equal(vegetarianFor([{ name: "雞蛋" }, { name: "番茄" }]), true);
});

test("vegetarian: fish sauce disqualifies", () => {
  assert.equal(vegetarianFor([{ name: "菜心" }, { name: "魚露" }]), false);
});

test("vegetarian: dried shrimp disqualifies", () => {
  assert.equal(vegetarianFor([{ name: "節瓜" }, { name: "蝦米" }]), false);
});

test("vegetarian: oyster sauce disqualifies", () => {
  assert.equal(vegetarianFor([{ name: "芥蘭" }, { name: "蠔油" }]), false);
});

test("vegetarian: gelatin disqualifies", () => {
  assert.equal(vegetarianFor([{ name: "水果" }, { name: "明膠" }]), false);
});

test("vegetarian: cheese qualifies", () => {
  assert.equal(vegetarianFor([{ name: "芝士" }, { name: "麵包" }]), true);
});

test("vegetarian: butter qualifies", () => {
  assert.equal(vegetarianFor([{ name: "牛油" }, { name: "麵包" }]), true);
});

test("vegetarian: chicken disqualifies", () => {
  assert.equal(vegetarianFor([{ name: "雞肉" }, { name: "菜心" }]), false);
});

test("vegetarian: oyster mushroom is not oyster", () => {
  assert.equal(vegetarianFor([{ name: "蠔菇" }, { name: "蒜蓉" }]), true);
});

test("vegetarian: avocado is not beef", () => {
  assert.equal(vegetarianFor([{ name: "牛油果" }, { name: "番茄" }]), true);
});

test("vegetarian: free tags are ignored", () => {
  assert.equal(vegetarianFor([{ name: "雞肉" }, { name: "菜心" }], ["素食", "vegetarian"]), false);
});

test("vegetarian: empty ingredients do not qualify", () => {
  assert.equal(vegetarianFor([]), false);
});

test("vegetarian: mussels with a valid ingredient name do not qualify", () => {
  assert.equal(vegetarianFor([{ name: "青口" }, { name: "白酒" }]), false);
});

test("fail-safe: quantity-only ingredient names disable vegetarian and highProtein", () => {
  const scenarios = deriveScenarios({
    name: "蒜香白酒煮青口",
    ingredients: [{ name: "500 克" }, { name: "4 瓣" }, { name: "1 個（切碎" }],
    steps: ["煮熟"],
  });
  assert.equal(scenarios.includes("vegetarian"), false, scenarios.join(","));
  assert.equal(scenarios.includes("highProtein"), false, scenarios.join(","));
});

test("fail-safe: one invalid ingredient name disables vegetarian and highProtein", () => {
  const vegetarian = deriveScenarios({
    name: "菜心豆腐",
    ingredients: [{ name: "菜心" }, { name: "豆腐" }, { name: "2 瓣" }],
    steps: ["煮熟"],
  });
  assert.equal(vegetarian.includes("vegetarian"), false, vegetarian.join(","));

  const highProtein = deriveScenarios({
    name: "雞胸炒蛋",
    ingredients: [{ name: "雞胸" }, { name: "雞蛋" }, { name: "2 瓣" }],
    steps: ["炒熟"],
  });
  assert.equal(highProtein.includes("highProtein"), false, highProtein.join(","));
});

test("fail-safe: valid ingredient names still derive vegetarian and highProtein", () => {
  const vegetarian = deriveScenarios({
    name: "菜心豆腐",
    ingredients: [{ name: "菜心" }, { name: "豆腐" }],
    steps: ["煮熟"],
  });
  assert.equal(vegetarian.includes("vegetarian"), true, vegetarian.join(","));

  const highProtein = deriveScenarios({
    name: "雞胸炒蛋",
    ingredients: [{ name: "雞胸" }, { name: "雞蛋" }],
    steps: ["炒熟"],
  });
  assert.equal(highProtein.includes("highProtein"), true, highProtein.join(","));
});

test("vegetarian excludes fish species without the word 魚 (龍脷 / 斑塊)", () => {
  const sole = deriveScenarios({
    name: "香脆魚柳條",
    ingredients: [{ name: "龍脷柳" }, { name: "雞蛋" }, { name: "麵粉" }],
    steps: ["炸至金黃"],
  });
  assert.equal(sole.includes("vegetarian"), false, sole.join(","));

  const grouper = deriveScenarios({
    name: "酸甜咕嚕魚塊",
    ingredients: [{ name: "斑塊" }, { name: "青椒" }, { name: "菠蘿" }],
    steps: ["炒勻"],
  });
  assert.equal(grouper.includes("vegetarian"), false, grouper.join(","));
});

test("vegetarian: name with meat disqualifies even if ingredients omit meat", () => {
  const scenarios = deriveScenarios({
    name: "上癮鹽味味噌豬肉炒飯",
    ingredients: [{ name: "白飯" }, { name: "味醂" }, { name: "黑胡椒" }],
    steps: ["炒勻"],
  });
  assert.equal(scenarios.includes("vegetarian"), false, scenarios.join(","));
});

test("vegetarian: meat-free name and ingredients still qualify", () => {
  const scenarios = deriveScenarios({
    name: "蒜蓉炒菜心",
    ingredients: [{ name: "菜心" }, { name: "蒜蓉" }],
    steps: ["炒熟"],
  });
  assert.equal(scenarios.includes("vegetarian"), true, scenarios.join(","));
});
