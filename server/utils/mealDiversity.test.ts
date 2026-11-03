import { test } from "node:test";
import assert from "node:assert/strict";
import { enforceDiversity, proteinGroup, cookingMethod, collisionScore } from "./mealDiversity";

test("proteinGroup: 主要食材分類", () => {
  assert.equal(proteinGroup("豉汁蒸排骨"), "pork");
  assert.equal(proteinGroup("香煎雞胸"), "chicken");
  assert.equal(proteinGroup("蝦仁炒蛋"), "seafood"); // 海鮮優先於蛋
  assert.equal(proteinGroup("番茄炒蛋"), "egg");
  assert.equal(proteinGroup("紅燒豆腐"), "soy");
  assert.equal(proteinGroup("蒜蓉炒菜心"), "veg");
  assert.equal(proteinGroup("香煎三文魚"), "seafood");
});

test("詞語守衛：牛油果／魚香／蠔油 唔會被當蛋白", () => {
  assert.equal(proteinGroup("牛油果多士"), "veg");
  assert.equal(proteinGroup("魚香茄子"), "veg");
  assert.equal(proteinGroup("蠔油生菜"), "veg");
  assert.equal(proteinGroup("羊肚菌燉雞"), "chicken");
  assert.equal(proteinGroup("牛奶布丁"), "veg");
});

test("cookingMethod: 煮法分類", () => {
  assert.equal(cookingMethod("豉汁蒸排骨"), "steam");
  assert.equal(cookingMethod("蒜蓉炒菜心"), "stirfry");
  assert.equal(cookingMethod("香煎雞胸"), "panfry");
  assert.equal(cookingMethod("芝士焗雜菜意粉"), "bake");
  assert.equal(cookingMethod("紅燒豆腐"), "braise");
  assert.equal(cookingMethod("粟米蛋花湯"), "boil");
});

test("菜名冇蛋白字眼時靠食材判斷（咕嚕肉 → pork）", () => {
  assert.equal(proteinGroup({ name: "咕嚕肉", ingredients: [{ name: "豬梅肉" }] }), "pork");
  assert.equal(proteinGroup({ name: "咕嚕肉" }), "veg"); // 冇食材資料時保守當菜
});

test("撞蛋白：換走第二道", () => {
  const dishes = [
    { name: "豉汁蒸排骨" }, // pork / steam
    { name: "咕嚕肉", ingredients: [{ name: "豬肉" }] }, // pork（菜名冇「豬」，靠食材）
    { name: "蒜蓉炒菜心" },  // veg / stirfry
  ];
  const candidates = [
    { name: "香煎三文魚" }, // seafood / panfry
    { name: "紅燒豆腐" },   // soy / braise
  ];
  const r = enforceDiversity(dishes, candidates);
  assert.equal(r.dishes[1].name, "香煎三文魚");
  assert.equal(r.swapped, 1);
});

test("撞煮法：換走第二道", () => {
  const dishes = [
    { name: "蒜蓉炒菜心" },   // veg / stirfry
    { name: "蝦仁炒蛋" },     // seafood / stirfry
    { name: "豉汁蒸排骨" },   // pork / steam
  ];
  const candidates = [{ name: "香煎三文魚" }]; // seafood / panfry
  const r = enforceDiversity(dishes, candidates);
  assert.equal(r.dishes[1].name, "香煎三文魚");
});

test("冇合適替代時保留原狀，唔會少一道", () => {
  const dishes = [{ name: "豉汁蒸排骨" }, { name: "蒸水蛋" }];
  const r = enforceDiversity(dishes, []);
  assert.equal(r.dishes.length, 2);
  assert.equal(r.swapped, 0);
  assert.ok(r.reasons[0].includes("no improving candidate"));
});

test("最多換 2 次", () => {
  const dishes = [{ name: "蒸排骨" }, { name: "蒸蛋" }, { name: "蒸魚" }, { name: "蒸雞" }];
  const candidates = [
    { name: "炒菜心" }, { name: "煎三文魚" }, { name: "炆牛腩" },
  ];
  const r = enforceDiversity(dishes, candidates, 2);
  assert.ok(r.swapped <= 2);
});

test("3 道同屬 veg：collision score 要下降（唔會 zero-op）", () => {
  const dishes = [{ name: "蒜蓉炒菜心" }, { name: "清炒芥蘭" }, { name: "炒通菜" }];
  const candidates = [{ name: "豉汁蒸排骨" }, { name: "香煎三文魚" }];
  const before = collisionScore(dishes);
  const r = enforceDiversity(dishes, candidates);
  assert.ok(r.collisionsAfter < before, `score ${before} → ${r.collisionsAfter}`);
  assert.ok(r.swapped >= 1);
});

test("已經多樣時唔會改動", () => {
  const dishes = [{ name: "豉汁蒸排骨" }, { name: "蝦仁炒蛋" }, { name: "蒜蓉炒菜心" }];
  const r = enforceDiversity(dishes, [{ name: "香煎三文魚" }]);
  assert.deepEqual(r.dishes.map((d) => d.name), ["豉汁蒸排骨", "蝦仁炒蛋", "蒜蓉炒菜心"]);
  assert.equal(r.swapped, 0);
});

test("詞語守衛：湯圓／豬仔包／蟹味菇 唔會被當湯／豬／蟹", () => {
  assert.equal(proteinGroup("湯圓"), "veg");
  assert.equal(proteinGroup("豬仔包"), "veg");
  assert.equal(proteinGroup("蟹味菇"), "veg");
});
