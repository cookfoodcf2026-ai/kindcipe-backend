import assert from "node:assert/strict";
import test from "node:test";
import { deriveScenarios } from "./scenario";

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
