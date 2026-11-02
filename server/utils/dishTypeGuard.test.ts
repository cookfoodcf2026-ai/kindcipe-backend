import { test } from "node:test";
import assert from "node:assert/strict";
import { guardDishTypeByIngredients } from "./dishType";

test("韭黃炒蛋 被標 seafood → vegetable", () => {
  assert.equal(
    guardDishTypeByIngredients("韭黃炒蛋", [{ name: "韭黃" }, { name: "雞蛋" }], "seafood"),
    "vegetable",
  );
});

test("真海鮮唔會被改（蝦仁炒蛋 保持 seafood）", () => {
  assert.equal(
    guardDishTypeByIngredients("蝦仁炒蛋", [{ name: "蝦仁" }, { name: "雞蛋" }], "seafood"),
    "seafood",
  );
});

test("肉類被誤標但食材冇肉 → 用菜名落 carb", () => {
  assert.equal(
    guardDishTypeByIngredients("番茄意粉", [{ name: "意粉" }], "meat"),
    "carb",
  );
});

test("肉類有肉字 → 保持", () => {
  assert.equal(
    guardDishTypeByIngredients("薯仔燜雞", [{ name: "雞髀" }], "meat"),
    "meat",
  );
});

test("冇明確證據唔亂改", () => {
  assert.equal(
    guardDishTypeByIngredients("雜錦小炒", [{ name: "雜菜" }], "seafood"),
    "seafood",
  );
});

test("甜品被誤標 seafood → dessert", () => {
  assert.equal(
    guardDishTypeByIngredients("芒果布甸", [{ name: "芒果" }], "seafood"),
    "dessert",
  );
});
