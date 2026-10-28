import assert from "node:assert/strict";
import test from "node:test";
import { cnQuantityToArabic, guardServings, normalizeIngredientAmount } from "./recipes";

// 真實案例（FB reel 1138268891981753，2026-10-28 匯入）：model 把中文單位同中文數字
// 一齊塞入 quantity，英文介面就漏中文 → 一定要喺後端正規化。

test("normalizeIngredientAmount splits Chinese unit out of quantity", () => {
  assert.deepEqual(normalizeIngredientAmount("3塊", "塊"), { quantity: "3", unit: "塊" });
  assert.deepEqual(normalizeIngredientAmount("半茶匙", "茶匙"), { quantity: "0.5", unit: "茶匙" });
  assert.deepEqual(normalizeIngredientAmount("2.5湯匙", "湯匙"), { quantity: "2.5", unit: "湯匙" });
  assert.deepEqual(normalizeIngredientAmount("半至一隻", "隻"), { quantity: "0.5-1", unit: "隻" });
});

test("normalizeIngredientAmount fills empty unit from trailing unit", () => {
  assert.deepEqual(normalizeIngredientAmount("6瓣", ""), { quantity: "6", unit: "瓣" });
  assert.deepEqual(normalizeIngredientAmount("700g", ""), { quantity: "700g", unit: "" });
});

test("normalizeIngredientAmount drops 約 prefix and keeps decimals", () => {
  assert.deepEqual(normalizeIngredientAmount("約10", ""), { quantity: "10", unit: "" });
  assert.deepEqual(normalizeIngredientAmount("1/3", "個"), { quantity: "1/3", unit: "個" });
});

test("normalizeIngredientAmount moves descriptor quantities into unit", () => {
  assert.deepEqual(normalizeIngredientAmount("依個人喜好", ""), { quantity: "", unit: "適量" });
  assert.deepEqual(normalizeIngredientAmount("適量", ""), { quantity: "", unit: "適量" });
  assert.deepEqual(normalizeIngredientAmount("", "適量"), { quantity: "", unit: "適量" });
});

test("normalizeIngredientAmount never overwrites an existing different unit", () => {
  assert.deepEqual(normalizeIngredientAmount("3塊", "隻"), { quantity: "3", unit: "隻" });
});

test("normalizeIngredientAmount leaves clean numeric input untouched", () => {
  assert.deepEqual(normalizeIngredientAmount("700", "g"), { quantity: "700", unit: "g" });
  assert.deepEqual(normalizeIngredientAmount("1", "個"), { quantity: "1", unit: "個" });
});

test("cnQuantityToArabic handles half, ranges and teens", () => {
  assert.equal(cnQuantityToArabic("半"), "0.5");
  assert.equal(cnQuantityToArabic("一半"), "0.5");
  assert.equal(cnQuantityToArabic("兩"), "2");
  assert.equal(cnQuantityToArabic("十"), "10");
  assert.equal(cnQuantityToArabic("十二"), "12");
  assert.equal(cnQuantityToArabic("二十"), "20");
  assert.equal(cnQuantityToArabic("二至三"), "2-3");
  assert.equal(cnQuantityToArabic("abc"), "abc");
});

// 份量護欄：caption 冇寫份量時 model 自創 "1 人" 係真實 bug（recipe 327）。

test("guardServings defaults to 2 when source has no serving hint", () => {
  const caption = "椒鹽豬扒飯炒底\n🔸材料｜豬扒 3塊 蒜頭 6瓣\n1｜將豬扒切條";
  assert.deepEqual(guardServings(1, caption), { servings: 2, defaulted: true });
  assert.deepEqual(guardServings(undefined, caption), { servings: 2, defaulted: true });
});

test("guardServings keeps LLM value when source states servings", () => {
  assert.deepEqual(guardServings(4, "Serves 4 | Prep 5 min"), { servings: 4, defaulted: false });
  assert.deepEqual(guardServings(3, "份量：3人"), { servings: 3, defaulted: false });
  assert.deepEqual(guardServings(2, "for 2 people"), { servings: 2, defaulted: false });
  assert.deepEqual(guardServings(6, "約6人份"), { servings: 6, defaulted: false });
});

test("guardServings rejects impossible values", () => {
  assert.deepEqual(guardServings(0, "Serves 4"), { servings: 2, defaulted: true });
  assert.deepEqual(guardServings(99, "Serves 4"), { servings: 2, defaulted: true });
  assert.deepEqual(guardServings("abc", "Serves 4"), { servings: 2, defaulted: true });
});
