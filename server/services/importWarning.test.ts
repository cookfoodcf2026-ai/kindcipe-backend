import assert from "node:assert/strict";
import test from "node:test";
import {
  buildImportWarning,
  computeParseToken,
} from "./importWarning";

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
    { name: "豆腐", quantity: "1", unit: "盒" },
    { name: "櫛瓜", quantity: "1", unit: "條" },
    { name: "醬油", quantity: "2", unit: "湯匙" },
    { name: "雞胸肉", quantity: "200", unit: "克" },
    { name: "雞塊", quantity: "6", unit: "塊" },
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

test("#328 13/13 grounded returns null", () => {
  assert.equal(buildImportWarning(f328.ingredients, f328.source, f328.name), null);
});

test("#323 8/8 grounded returns null", () => {
  assert.equal(buildImportWarning(f323.ingredients, f323.source, f323.name), null);
});

test("#329 6/12 grounded returns warning with 6 inferred", () => {
  const warning = buildImportWarning(f329.ingredients, f329.source, f329.name);
  assert.ok(warning);
  assert.equal(warning.code, "ingredients_inferred");
  assert.equal(warning.totalIngredients, 12);
  assert.equal(warning.groundedCount, 6);
  assert.equal(warning.inferredCount, 6);
  assert.deepEqual(warning.inferredIngredients.map((item) => item.name), [
    "羅望子醬",
    "魚露",
    "椰糖",
    "蒜蓉",
    "食用油",
    "辣椒",
  ]);
  assert.equal(warning.requiresAck, true);
});

test("#332 blacklist is excluded and only 2 inferred remain", () => {
  const warning = buildImportWarning(f332.ingredients, f332.source, f332.name);
  assert.ok(warning);
  assert.equal(warning.totalIngredients, 5);
  assert.equal(warning.groundedCount, 3);
  assert.equal(warning.inferredCount, 2);
  assert.equal(warning.blacklistHits, 1);
  assert.deepEqual(warning.inferredIngredients.map((item) => item.name), [
    "雞胸肉",
    "雞塊",
  ]);
  assert.equal(warning.requiresAck, true);
});

test("#331 English source uses nameEn and does not warn", () => {
  assert.equal(buildImportWarning(f331.ingredients, f331.source, f331.name), null);
});

test("#325 English source uses nameEn and does not warn", () => {
  assert.equal(buildImportWarning(f325.ingredients, f325.source, f325.name), null);
});

test("empty sourceText infers every ingredient and requires ack", () => {
  const warning = buildImportWarning(
    [{ name: "豆腐" }, { name: "鹽" }, { name: "洋蔥" }],
    "",
    "無來源",
  );
  assert.ok(warning);
  assert.equal(warning.totalIngredients, 3);
  assert.equal(warning.groundedCount, 0);
  assert.equal(warning.inferredCount, 3);
  assert.equal(warning.requiresAck, true);
});

test("parse token is stable across list order", () => {
  const grounded = [
    { name: "豆腐", quantity: "1", unit: "盒" },
    { name: "醬油", quantity: "2", unit: "湯匙" },
  ];
  const inferred = [{ name: "雞胸肉", quantity: "200", unit: "克" }];
  const first = computeParseToken(grounded, inferred);
  const second = computeParseToken([...grounded].reverse(), [...inferred].reverse());
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test("parse token changes when content changes", () => {
  const grounded = [{ name: "豆腐", quantity: "1", unit: "盒" }];
  const inferred = [{ name: "雞胸肉", quantity: "200", unit: "克" }];
  const first = computeParseToken(grounded, inferred);
  const second = computeParseToken(grounded, [
    { name: "雞胸肉", quantity: "300", unit: "克" },
  ]);
  assert.notEqual(first, second);
});

test("stepsInferred alone returns steps warning", () => {
  const warning = buildImportWarning([{ name: "豆腐" }], "豆腐", "煎豆腐", true);
  assert.ok(warning);
  assert.equal(warning.code, "steps_inferred");
  assert.equal(warning.inferredCount, 0);
  assert.equal(warning.requiresAck, true);
});
