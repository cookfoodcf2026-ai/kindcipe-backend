import assert from "node:assert/strict";
import test from "node:test";
import { filterValidGeneratedRecipes, hasJsonFragmentStepText, isStructurallyCorruptStepText, validateGeneratedRecipeSteps } from "./recipeStepQuality";
import { shouldChargeChefRequest } from "./aiChefPolicy";
import { finalizeChefRequest } from "./aiChefFinalization";
import { generateMissingRecipes } from "../routers/aiRecipe";
import { findUnsafeRecipeTranslations } from "../utils/recipeTranslationGuard";

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

test("all generated candidates rejected -> zero valid cards", () => {
  const candidates = [
    { steps: ['stepsEn": "prepare"'] },
    { steps: ['stepsFil": "siapkan"'] },
  ];
  assert.deepEqual(filterValidGeneratedRecipes(candidates), []);
});

test("zero served AI cards refunds the reserved credit", async () => {
  let committed = false;
  let refunded = false;
  const shouldCharge = shouldChargeChefRequest({ served: 0, aiCards: 0 });
  const result = await finalizeChefRequest({
    truthful: false,
    shouldCharge,
    requestedCredits: 1,
    reservationId: 4242,
    validate: () => [],
    buildLegacy: async () => ({ recipes: [] }),
    applyContract: (legacy) => legacy,
    commitUsage: async () => { committed = true; },
    refundUsage: async () => { refunded = true; },
  });
  assert.equal(shouldCharge, false);
  assert.equal(result.creditsCharged, 0);
  assert.equal(committed, false);
  assert.equal(refunded, true);
});

test("generateMissingRecipes returns [] and no charge when every card is invalid", async () => {
  const bad = JSON.stringify({
    recipes: [{
      name: "壞卡",
      ingredients: [{ name: "雞蛋" }, { name: "豆芽" }],
      steps: [
        'stepsEn": "prepare"',
        "第二步先炒蛋。",
        "第三步加入豆芽。",
        "第四步炒勻。",
        "第五步上碟。",
      ],
    }],
  });
  let llmCalls = 0;
  const recipes = await generateMissingRecipes(
    1,
    false,
    [],
    undefined,
    undefined,
    undefined,
    [],
    undefined,
    { invokeLLM: async () => { llmCalls += 1; return { choices: [{ message: { content: bad } }] } as any; } },
  );
  assert.equal(llmCalls, 1);
  assert.deepEqual(recipes, []);
  assert.equal(shouldChargeChefRequest({ served: 0, aiCards: 0 }), false);
});

test("translation guard rejects CJK in any _en field", () => {
  assert.deepEqual(findUnsafeRecipeTranslations({
    nameEn: "番茄炒蛋",
    nameFil: "Tomato Egg",
    nameId: "Telur Tomat",
  }), ["nameEn contains CJK"]);
  assert.deepEqual(findUnsafeRecipeTranslations({
    stepsEn: ["中火炒 3 分鐘"],
  }), ["stepsEn contains CJK"]);
});

test("translation guard rejects long copied fil/id names but exempts short proper nouns", () => {
  assert.deepEqual(findUnsafeRecipeTranslations({
    nameEn: "Pan-Seared Chicken Breast",
    nameFil: "Pan-Seared Chicken Breast",
    nameId: "Pan-Seared Chicken Breast",
  }), ["nameFil equals nameEn (length > 8)", "nameId equals nameEn (length > 8)"]);
  assert.deepEqual(findUnsafeRecipeTranslations({
    nameEn: "Tiramisu",
    nameFil: "Tiramisu",
    nameId: "Tiramisu",
  }), []);
});
