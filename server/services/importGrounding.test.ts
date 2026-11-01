import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeGrounding,
  BLACKLIST_PHRASES,
  groundIngredient,
  stripTitleLines,
} from "./importGrounding";

const f328 = {
  name: "街頭豬扒飯",
  source: [
    "街頭豬扒飯",
    "材料：豬扒2塊、白飯2碗、雞蛋2隻、洋蔥半個、蒜蓉1湯匙、生抽2湯匙、老抽1茶匙、蠔油1湯匙、糖1茶匙、胡椒粉少許、生粉2湯匙、麵包糠適量、油適量。",
    "做法：將豬扒醃好，煎至金黃，配白飯食用。",
  ].join("\n"),
  ingredients: [
    { name: "豬扒" },
    { name: "白飯" },
    { name: "雞蛋" },
    { name: "洋蔥" },
    { name: "蒜蓉" },
    { name: "生抽" },
    { name: "老抽" },
    { name: "蠔油" },
    { name: "糖" },
    { name: "胡椒粉" },
    { name: "生粉" },
    { name: "麵包糠" },
    { name: "油" },
  ],
};

const f323 = {
  name: "南瓜忌廉煙肉意粉",
  source: [
    "南瓜忌廉煙肉意粉",
    "材料：南瓜300克、意粉200克、煙肉100克、忌廉200毫升、洋蔥半個、蒜蓉2瓣、巴馬臣芝士50克、黑胡椒少許。",
    "做法：煮好意粉，拌入忌廉同煙肉。",
  ].join("\n"),
  ingredients: [
    { name: "南瓜" },
    { name: "意粉" },
    { name: "煙肉" },
    { name: "忌廉" },
    { name: "洋蔥" },
    { name: "蒜蓉" },
    { name: "巴馬臣芝士" },
    { name: "黑胡椒" },
  ],
};

const f329 = {
  name: "泰式炒河粉捲",
  source: [
    "泰式炒河粉捲",
    "材料：河粉200克、蝦仁150克、雞蛋2隻、豆芽100克、韭菜50克、花生碎30克。",
    "做法：炒香蝦仁同雞蛋，加入河粉、豆芽、韭菜同花生碎拌勻。",
  ].join("\n"),
  ingredients: [
    { name: "河粉" },
    { name: "蝦仁" },
    { name: "雞蛋" },
    { name: "豆芽" },
    { name: "韭菜" },
    { name: "花生" },
    { name: "羅望子醬" },
    { name: "魚露" },
    { name: "椰糖" },
    { name: "蒜蓉" },
    { name: "食用油" },
    { name: "辣椒" },
  ],
};

const f332 = {
  name: "櫛瓜雞肉豆腐煎餅",
  source: [
    "櫛瓜雞肉豆腐煎餅",
    "維達廚房紙巾陪你煮出健康好味！材料：豆腐1盒、櫛瓜1條、醬油2湯匙。",
    "做法：將豆腐壓碎，加入櫛瓜絲同醬油拌勻，再用維達廚房紙巾吸乾水分。",
  ].join("\n"),
  ingredients: [
    { name: "豆腐" },
    { name: "櫛瓜" },
    { name: "醬油" },
    { name: "雞胸肉" },
    { name: "雞塊" },
    { name: "維達廚房紙巾" },
  ],
};

const f331 = {
  name: "街頭玉米番薯碗",
  source: [
    "Street Corn & Sweet Potato Bowl",
    "Ingredients: 2 cups corn, 1 large sweet potato, 1 tbsp olive oil, 1 tsp smoked paprika, 1/2 tsp garlic powder, 1/4 cup Greek yogurt, 1 tbsp lime juice, 1/4 cup cotija cheese, 1 tbsp chopped cilantro, 1/2 avocado, 1/4 cup black beans, 1/2 red onion, 1 tsp salt, 1/4 tsp black pepper.",
    "Instructions: Roast the sweet potato, grill the corn, and mix with the dressing.",
  ].join("\n"),
  ingredients: [
    { name: "玉米", nameEn: "corn" },
    { name: "番薯", nameEn: "sweet potato" },
    { name: "橄欖油", nameEn: "olive oil" },
    { name: "紅椒粉", nameEn: "smoked paprika" },
    { name: "蒜粉", nameEn: "garlic powder" },
    { name: "希臘乳酪", nameEn: "Greek yogurt" },
    { name: "青檸汁", nameEn: "lime juice" },
    { name: "墨西哥芝士", nameEn: "cotija cheese" },
    { name: "香菜", nameEn: "cilantro" },
    { name: "牛油果", nameEn: "avocado" },
    { name: "黑豆", nameEn: "black beans" },
    { name: "紅洋蔥", nameEn: "red onion" },
    { name: "鹽", nameEn: "salt" },
    { name: "黑胡椒", nameEn: "black pepper" },
  ],
};

const f325 = {
  name: "蜜汁牛肉烤地瓜",
  source: [
    "Honey Beef & Sweet Potato",
    "Ingredients: 500g beef, 2 sweet potatoes, 3 tbsp honey, 2 tbsp soy sauce, 3 cloves garlic, 1 tbsp ginger, 1 tsp black pepper, 1 tbsp olive oil, 1 tsp salt, 1 tbsp sesame seeds.",
    "Instructions: Roast the sweet potatoes and glaze the beef.",
  ].join("\n"),
  ingredients: [
    { name: "牛肉", nameEn: "beef" },
    { name: "地瓜", nameEn: "sweet potato" },
    { name: "蜂蜜", nameEn: "honey" },
    { name: "醬油", nameEn: "soy sauce" },
    { name: "蒜", nameEn: "garlic" },
    { name: "薑", nameEn: "ginger" },
    { name: "黑胡椒", nameEn: "black pepper" },
    { name: "橄欖油", nameEn: "olive oil" },
    { name: "鹽", nameEn: "salt" },
    { name: "芝麻", nameEn: "sesame seeds" },
  ],
};

const f326 = {
  name: "YouTube 無 caption",
  source: "",
  ingredients: [{ name: "雞肉" }, { name: "鹽" }, { name: "洋蔥" }],
};

const f324 = {
  name: "IG 抓唔到",
  source: "",
  ingredients: [{ name: "豆腐" }, { name: "醬油" }],
};

test("#328 13/13 grounded does not warn", () => {
  const result = analyzeGrounding(f328.ingredients, f328.source, f328.name);
  assert.equal(result.total, 13);
  assert.equal(result.groundedCount, 13);
  assert.equal(result.inferredIndexes.length, 0);
  assert.equal(result.shouldWarnIngredients, false);
});

test("#323 8/8 grounded does not warn", () => {
  const result = analyzeGrounding(f323.ingredients, f323.source, f323.name);
  assert.equal(result.total, 8);
  assert.equal(result.groundedCount, 8);
  assert.equal(result.shouldWarnIngredients, false);
});

test("#329 6/12 grounded warns at threshold 3", () => {
  const result = analyzeGrounding(f329.ingredients, f329.source, f329.name);
  assert.equal(result.total, 12);
  assert.equal(result.groundedCount, 6);
  assert.equal(result.inferredIndexes.length, 6);
  assert.equal(result.shouldWarnIngredients, true);
});

test("#332 blacklist hit leaves 3/5 grounded and 2 inferred", () => {
  const result = analyzeGrounding(f332.ingredients, f332.source, f332.name);
  assert.equal(result.total, 5);
  assert.equal(result.groundedCount, 3);
  assert.equal(result.blacklistHits, 1);
  assert.deepEqual(result.inferredIndexes, [3, 4]);
  assert.equal(result.shouldWarnIngredients, true);
});

test("#331 English source uses nameEn instead of missing all Chinese names", () => {
  const result = analyzeGrounding(f331.ingredients, f331.source, f331.name);
  assert.equal(result.total, 14);
  assert.equal(result.groundedCount, 14);
  assert.equal(result.shouldWarnIngredients, false);
});

test("#325 English source uses nameEn instead of missing all Chinese names", () => {
  const result = analyzeGrounding(f325.ingredients, f325.source, f325.name);
  assert.equal(result.total, 10);
  assert.equal(result.groundedCount, 10);
  assert.equal(result.shouldWarnIngredients, false);
});

test("#326 empty source marks all ingredients ungrounded and warns", () => {
  const result = analyzeGrounding(f326.ingredients, f326.source, f326.name);
  assert.equal(result.total, 3);
  assert.equal(result.groundedCount, 0);
  assert.deepEqual(result.inferredIndexes, [0, 1, 2]);
  assert.equal(result.shouldWarnIngredients, true);
});

test("#324 empty source marks all ingredients ungrounded and warns", () => {
  const result = analyzeGrounding(f324.ingredients, f324.source, f324.name);
  assert.equal(result.total, 2);
  assert.equal(result.groundedCount, 0);
  assert.deepEqual(result.inferredIndexes, [0, 1]);
  assert.equal(result.shouldWarnIngredients, true);
});

test("single char oil is not grounded by 油膩, 油炸 or 油菜", () => {
  assert.deepEqual(groundIngredient({ name: "油" }, "這道菜很油膩"), {
    grounded: false,
    reason: "miss",
  });
  assert.deepEqual(groundIngredient({ name: "油" }, "油炸食物"), {
    grounded: false,
    reason: "miss",
  });
  assert.deepEqual(groundIngredient({ name: "油" }, "油菜"), {
    grounded: false,
    reason: "miss",
  });
});

test("板豆腐 grounds 豆腐 only and does not ground 鹽", () => {
  assert.deepEqual(groundIngredient({ name: "豆腐" }, "板豆腐"), {
    grounded: true,
    reason: "exact",
  });
  assert.deepEqual(groundIngredient({ name: "鹽" }, "板豆腐"), {
    grounded: false,
    reason: "miss",
  });
  assert.deepEqual(groundIngredient({ name: "板豆腐" }, "豆腐"), {
    grounded: true,
    reason: "substring",
  });
});

test("title line is removed when it is a pure title", () => {
  const name = "番茄炒蛋";
  const source = [
    "番茄炒蛋",
    "材料：番茄2個、雞蛋2隻、洋蔥半個、青蔥1條、鹽少許、糖少許。",
    "做法：先炒蛋，再加入番茄同洋蔥，最後調味。",
  ].join("\n");
  const cleaned = stripTitleLines(source, name);
  assert.equal(cleaned.includes("番茄炒蛋"), false);
  assert.match(cleaned, /材料/);
});

test("title line is restored when removing it leaves too little source", () => {
  const name = "番茄炒蛋";
  const source = "番茄炒蛋";
  assert.equal(stripTitleLines(source, name), source);
});

test("title line with ingredient marker is kept", () => {
  const name = "番茄炒蛋";
  const source = "番茄炒蛋：番茄2個、雞蛋2隻";
  assert.equal(stripTitleLines(source, name), source);
});

test("blacklist uses phrases and does not reject 米紙 for containing 紙", () => {
  assert.deepEqual(BLACKLIST_PHRASES, ["廚房紙巾", "紙巾", "優惠", "抽獎", "折扣", "贊助"]);
  assert.deepEqual(groundIngredient({ name: "紙巾" }, "紙巾"), {
    grounded: false,
    reason: "blacklist",
  });
  assert.deepEqual(groundIngredient({ name: "米紙" }, "米紙2張"), {
    grounded: true,
    reason: "exact",
  });
});

test("single char ingredients use exact token, quantity context and direction", () => {
  for (const name of ["鹽", "糖", "油"]) {
    assert.equal(groundIngredient({ name }, "鹽、糖、油").grounded, true);
  }
  assert.equal(groundIngredient({ name: "鹽" }, "鹽1茶匙").grounded, true);
  assert.equal(groundIngredient({ name: "鹽" }, "鹽適量").grounded, true);
  assert.equal(groundIngredient({ name: "油" }, "橄欖油").grounded, true);
  assert.equal(groundIngredient({ name: "蛋" }, "雞蛋").grounded, true);
  assert.equal(groundIngredient({ name: "蒜" }, "蒜蓉").grounded, true);
  assert.equal(groundIngredient({ name: "蔥" }, "蔥花").grounded, true);
  assert.equal(groundIngredient({ name: "薑" }, "薑絲").grounded, true);
});

test("English tokens allow 3 letters, plural stems and only ox for 2 letters", () => {
  assert.equal(groundIngredient({ name: "大豆", nameEn: "soy" }, "soy sauce").grounded, true);
  assert.equal(groundIngredient({ name: "蛋", nameEn: "egg" }, "2 eggs").grounded, true);
  assert.equal(groundIngredient({ name: "油", nameEn: "oil" }, "boiled water").grounded, false);
  assert.equal(groundIngredient({ name: "牛", nameEn: "ox" }, "ox tail").grounded, true);
  assert.equal(groundIngredient({ name: "牛", nameEn: "ox" }, "oxygen").grounded, false);
});

test("one miss out of thirteen stays below warning threshold", () => {
  const ingredients = [...f328.ingredients, { name: "辣椒" }];
  const result = analyzeGrounding(ingredients, f328.source, f328.name);
  assert.equal(result.total, 14);
  assert.equal(result.groundedCount, 13);
  assert.equal(result.inferredIndexes.length, 1);
  assert.equal(result.shouldWarnIngredients, false);
});

test("stepsInferred is passed through without C1 judging steps", () => {
  const withFlag = analyzeGrounding([{ name: "豆腐" }], "豆腐", "煎豆腐", true);
  assert.equal(withFlag.stepsInferred, true);
  const withoutFlag = analyzeGrounding([{ name: "豆腐" }], "豆腐", "煎豆腐");
  assert.equal("stepsInferred" in withoutFlag, false);
});
