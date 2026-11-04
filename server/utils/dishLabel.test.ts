import assert from "node:assert/strict";
import test from "node:test";
import { cleanDishLabel } from "../routers/aiRecipe";

test("cleanDishLabel: 有冇蔥油餅食譜 → 蔥油餅", () => {
  assert.equal(cleanDishLabel("有冇蔥油餅食譜"), "蔥油餅");
});

test("cleanDishLabel: 我想食咖喱牛腩飯 → 咖喱牛腩飯", () => {
  assert.equal(cleanDishLabel("我想食咖喱牛腩飯"), "咖喱牛腩飯");
});

test("cleanDishLabel: 教我做提拉米蘇 → 提拉米蘇", () => {
  assert.equal(cleanDishLabel("教我做提拉米蘇"), "提拉米蘇");
});

test("cleanDishLabel: 英文 recipe 尾綴", () => {
  assert.equal(cleanDishLabel("scallion pancake recipe"), "scallion pancake");
});

test("cleanDishLabel: 已經是菜名就不動", () => {
  assert.equal(cleanDishLabel("薑蔥滑雞"), "薑蔥滑雞");
});
