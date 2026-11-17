import assert from "node:assert/strict";
import test from "node:test";
import { isNonVegetarianName, isVegetarianRow } from "./vegetarian";

const NON_VEG_NAMES = [
  "新鮮花甲",
  "蛤蜊",
  "蛤蠣",
  "新鮮青口",
  "青口",
  "乾響螺片",
  "新鮮花螺",
  "象拔蚌",
  "新鮮蜆或沙白",
  "沙白",
  "罐頭蜆肉（連蜆汁）",
  "新鮮生蠔肉",
  "金蠔",
  "生蠔",
  "螺螄粉",
];

const VEG_NAMES = [
  "高蛋白質螺絲粉",
  "螺絲粉",
  "蒸魚豉油",
  "海鮮醬",
  "素蠔油",
];

test("production seafood names are non-vegetarian", () => {
  for (const name of NON_VEG_NAMES) {
    assert.equal(isNonVegetarianName(name), true, `${name} should be non-vegetarian`);
  }
});

test("production safe names stay vegetarian", () => {
  for (const name of VEG_NAMES) {
    assert.equal(isNonVegetarianName(name), false, `${name} should be vegetarian`);
  }
});

test("row with 花甲 in the dish name is not vegetarian", () => {
  assert.equal(
    isVegetarianRow({
      name: "花甲蒸水蛋",
      ingredients: [{ name: "花甲" }, { name: "蒸魚豉油" }, { name: "雞蛋" }],
    }),
    false,
  );
});
