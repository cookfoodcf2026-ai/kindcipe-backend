import assert from "node:assert/strict";
import test from "node:test";
import { isDisplayableRecipe, minStepsFor, qualityVerdict } from "./recipeQuality";

function steps(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `第 ${i + 1} 步：中火煮 3 分鐘。`);
}

function recipe(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "番茄炒蛋",
    ingredients: [{ name: "番茄" }, { name: "雞蛋" }],
    steps: steps(5),
    ...overrides,
  };
}

test("minStepsFor: AI main dish = 5", () => {
  assert.equal(minStepsFor({ source: "ai", role: "meat" }), 5);
  assert.equal(minStepsFor({ source: "ai", dishType: "vegetable" }), 5);
  assert.equal(minStepsFor({ source: "ai" }), 5);
});

test("minStepsFor: AI soup = 4 (role or dishType)", () => {
  assert.equal(minStepsFor({ source: "ai", role: "soup" }), 4);
  assert.equal(minStepsFor({ source: "ai", dishType: "soup" }), 4);
});

test("minStepsFor: AI dessert = 4 (role or dishType)", () => {
  assert.equal(minStepsFor({ source: "ai", role: "dessert" }), 4);
  assert.equal(minStepsFor({ source: "ai", dishType: "dessert" }), 4);
});

test("minStepsFor: library = 1 for official/custom/library", () => {
  assert.equal(minStepsFor({ source: "official", role: "meat" }), 1);
  assert.equal(minStepsFor({ source: "custom", role: "soup" }), 1);
  assert.equal(minStepsFor({ source: "library", dishType: "dessert" }), 1);
});

test("minStepsFor: explicit override wins (truncated-JSON salvage)", () => {
  assert.equal(minStepsFor({ source: "ai", role: "meat", minSteps: 3 }), 3);
});

test("minStepsFor: salvage path allows 3 steps for AI cards", () => {
  assert.equal(minStepsFor({ source: "ai", role: "meat", path: "salvage" }), 3);
  assert.equal(minStepsFor({ source: "ai", dishType: "vegetable", path: "salvage" }), 3);
  assert.equal(minStepsFor({ source: "ai", role: "soup", path: "salvage" }), 3);
});

test("salvage leniency does not leak into the normal generation path", () => {
  assert.equal(minStepsFor({ source: "ai", role: "meat" }), 5);
  assert.equal(minStepsFor({ source: "ai", dishType: "vegetable" }), 5);
});

test("accepts 5-step AI main dish", () => {
  assert.equal(isDisplayableRecipe(recipe(), { source: "ai", role: "meat" }), true);
});

test("accepts 4-step AI soup", () => {
  const soup = recipe({ name: "番茄薯仔湯", steps: steps(4) });
  assert.equal(isDisplayableRecipe(soup, { source: "ai", role: "soup" }), true);
});

test("accepts 4-step AI dessert", () => {
  const dessert = recipe({ name: "紅豆沙", steps: steps(4) });
  assert.equal(isDisplayableRecipe(dessert, { source: "ai", role: "dessert" }), true);
});

test("accepts 1-step, 1-ingredient library recipe", () => {
  const library = recipe({ name: "涼拌青瓜", steps: ["拌勻即可。"], ingredients: [{ name: "青瓜" }] });
  assert.equal(isDisplayableRecipe(library, { source: "official" }), true);
});

test("rejects an AI main dish with only 4 steps", () => {
  const verdict = qualityVerdict(recipe({ steps: steps(4) }), { source: "ai", role: "meat" });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.steps, 4);
  assert.equal(verdict.minSteps, 5);
  assert.match(verdict.reasons.join("；"), /steps 4 < 5/);
});

test("accepts a 3-step AI dish only on the salvage path", () => {
  const salvaged = recipe({ steps: steps(3) });
  assert.equal(isDisplayableRecipe(salvaged, { source: "ai", path: "salvage" }), true);
  assert.equal(isDisplayableRecipe(salvaged, { source: "ai" }), false);
});

test("rejects an AI soup with only 3 steps", () => {
  const soup = recipe({ name: "番茄薯仔湯", steps: steps(3) });
  assert.equal(isDisplayableRecipe(soup, { source: "ai", role: "soup" }), false);
});

test("rejects AI recipe with fewer than 2 ingredients", () => {
  const verdict = qualityVerdict(recipe({ ingredients: [{ name: "番茄" }] }), { source: "ai" });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons.join("；"), /ingredients 1 < 2/);
});

test("library still allows a single ingredient", () => {
  const library = recipe({ steps: ["拌勻即可。"], ingredients: [{ name: "青瓜" }] });
  assert.equal(qualityVerdict(library, { source: "official" }).ok, true);
});

test("rejects JSON fragment / translation-key steps", () => {
  const corrupted = recipe({
    steps: [
      "準備食材：豆芽洗淨，雞蛋打散。",
      'stepsEn": "Prepare ingredients…","stepsFil": "Siapkan bahan…',
      "炒蛋：中火炒 1 分鐘。",
      "上碟。",
      "完成。",
    ],
  });
  const verdict = qualityVerdict(corrupted, { source: "ai" });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons.join("；"), /JSON 碎片/);
});

test("rejects names longer than 50 chars", () => {
  const verdict = qualityVerdict(recipe({ name: "長".repeat(51) }), { source: "ai" });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons.join("；"), /name 超過 50 字/);
});
