import assert from "node:assert/strict";
import test from "node:test";
import { hasJsonFragmentStepText, isStructurallyCorruptStepText, validateGeneratedRecipeSteps } from "./recipeStepQuality";

test("accepts ordinary Chinese steps, including ratios", () => {
  assert.deepEqual(validateGeneratedRecipeSteps({
    steps: [
      "將番茄切塊，中火炒 3 分鐘。",
      "米同水比例 1:1，放入電飯煲煮 20 分鐘。",
      "最後加鹽拌勻後上碟。",
    ],
  }), { ok: true, issues: [] });
});

test("rejects the corrupted production JSON fragment", () => {
  const corrupted = JSON.stringify([
    { instruction: "準備食材：豆芽洗淨，雞蛋打散。" },
    { instruction: 'stepsEn": "Prepare ingredients…","stepsFil": "Siapkan bahan…' },
    { instruction: "炒蛋：中火炒 1 分鐘。" },
    { instruction: 'stepsEn": "Scramble eggs…' },
  ]);
  const result = validateGeneratedRecipeSteps({ steps: corrupted });
  assert.equal(result.ok, false);
});

test("rejects instruction objects containing translation keys", () => {
  const result = validateGeneratedRecipeSteps({
    steps: [
      "準備食材：豆芽洗淨，雞蛋打散。",
      'stepsEn": "Prepare ingredients…","stepsFil": "Siapkan bahan…',
      "炒蛋：中火炒 1 分鐘。",
      'stepsEn": "Scramble eggs…',
    ],
  });
  assert.equal(result.ok, false);
  assert.match(result.issues.join("；"), /JSON 碎片/);
});

test("structural helper rejects non-string and JSON fragment steps", () => {
  assert.equal(isStructurallyCorruptStepText({ instruction: "切菜" }), true);
  assert.equal(isStructurallyCorruptStepText('stepsEn": "prepare"'), true);
  assert.equal(isStructurallyCorruptStepText("中火炒番茄 3 分鐘。"), false);
  assert.equal(hasJsonFragmentStepText("米同水比例 1:1。"), false);
});
