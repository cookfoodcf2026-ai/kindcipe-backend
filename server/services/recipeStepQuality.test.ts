import assert from "node:assert/strict";
import test from "node:test";
import { hasJsonFragmentStepText, isStructurallyCorruptStepText, validateGeneratedRecipeSteps } from "./recipeStepQuality";

const goodRecipe = {
  ingredients: [{ name: "番茄" }, { name: "雞蛋" }, { name: "食油" }, { name: "蔥花" }],
  steps: [
    "中火燒熱鍋，加入食油，將番茄塊炒 3 分鐘至軟身。",
    "雞蛋打散後倒入鍋中，用中火炒 1 分鐘至半凝固。",
    "加入番茄塊與雞蛋一齊拌炒 30 秒，令味道均勻。",
    "灑上蔥花，轉小火焗 10 秒後上碟。",
  ],
};

test("accepts concrete steps with action, heat/time and listed ingredients", () => {
  assert.deepEqual(validateGeneratedRecipeSteps(goodRecipe), { ok: true, issues: [] });
});

test("accepts structurally valid steps even without an explicit verb or heat word", () => {
  const result = validateGeneratedRecipeSteps({
    ingredients: goodRecipe.ingredients,
    steps: [
      "將番茄切塊後放入大碗，再加入雞蛋輕輕拌勻備用。",
      "把混合好的番茄蛋液倒進鍋中，均勻鋪平後蓋上鍋蓋。",
      "打開鍋蓋，用鑊鏟將底部嘅蛋塊推開，保持完整形狀。",
      "最後將成品盛入碟中，撒上蔥花後即刻享用。",
    ],
  });
  assert.deepEqual(result, { ok: true, issues: [] });
});

test("rejects a whole step that is only filler text, but keeps meaningful steps containing it", () => {
  const wholeFiller = validateGeneratedRecipeSteps({
    ingredients: goodRecipe.ingredients,
    steps: ["適量", ...goodRecipe.steps.slice(0, 3)],
  });
  assert.equal(wholeFiller.ok, false);
  assert.match(wholeFiller.issues.join("；"), /空泛字眼/);

  const meaningful = validateGeneratedRecipeSteps({
    ingredients: goodRecipe.ingredients,
    steps: [
      "將雞肉放入滾水煮至熟透，撈起後切成小塊備用。",
      ...goodRecipe.steps.slice(0, 3),
    ],
  });
  assert.deepEqual(meaningful, { ok: true, issues: [] });
});

test("rejects the corrupted production JSON fragment", () => {
  const corrupted = JSON.stringify([
    { instruction: "準備食材：豆芽洗淨，雞蛋打散。" },
    { instruction: 'stepsEn": "Prepare ingredients…","stepsFil": "Siapkan bahan…' },
    { instruction: "炒蛋：中火炒 1 分鐘。" },
    { instruction: 'stepsEn": "Scramble eggs…' },
  ]);
  const result = validateGeneratedRecipeSteps({
    ingredients: [{ name: "豆芽" }, { name: "雞蛋" }],
    steps: corrupted,
  });
  assert.equal(result.ok, false);
});

test("rejects instruction objects containing translation keys", () => {
  const result = validateGeneratedRecipeSteps({
    ingredients: [{ name: "豆芽" }, { name: "雞蛋" }],
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

test("rejects wrong step count and step length", () => {
  const result = validateGeneratedRecipeSteps({
    ingredients: goodRecipe.ingredients,
    steps: ["中火炒 3 分鐘。", "細火煮 2 分鐘。", "大火炒 1 分鐘。"],
  });
  assert.equal(result.ok, false);
  assert.match(result.issues.join("；"), /必須 4–8 步/);
  assert.match(result.issues.join("；"), /15–80 字/);
});

test("structural helper rejects non-string and JSON fragment steps", () => {
  assert.equal(isStructurallyCorruptStepText({ instruction: "切菜" }), true);
  assert.equal(isStructurallyCorruptStepText('stepsEn": "prepare"'), true);
  assert.equal(isStructurallyCorruptStepText("中火炒番茄 3 分鐘。"), false);
  assert.equal(hasJsonFragmentStepText("米同水比例 1:1，放入電飯煲煮 20 分鐘。"), false);
  assert.equal(hasJsonFragmentStepText('stepsEn": "prepare"'), true);
});
