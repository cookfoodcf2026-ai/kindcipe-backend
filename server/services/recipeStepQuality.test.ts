import assert from "node:assert/strict";
import test from "node:test";
import { filterValidGeneratedRecipes, hasJsonFragmentStepText, isStructurallyCorruptStepText, validateGeneratedRecipeSteps } from "./recipeStepQuality";
import { shouldChargeChefRequest } from "./aiChefPolicy";
import { finalizeChefRequest } from "./aiChefFinalization";
import { generateMissingRecipes, mkExcludeSets, normalizeLibraryRow, pickSoupMeal } from "../routers/aiRecipe";
import { isDisplayableRecipe, qualityVerdict } from "./recipeQuality";
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
  assert.deepEqual(findUnsafeRecipeTranslations({
    tipsEn: "先落鑊炒香。",
  }), ["tipsEn contains CJK"]);
});

test("library raw JSON steps are parsed before the quality gate, so the card survives", () => {
  const rawRow = {
    id: 9001,
    name: "洋蔥炒蛋",
    ingredients: JSON.stringify([{ name: "洋蔥" }, { name: "雞蛋" }]),
    steps: JSON.stringify([
      { instruction: "洋蔥切絲，雞蛋打散。", duration: 4 },
      { instruction: "中火炒蛋至半熟，盛起。", duration: 2 },
      { instruction: "炒香洋蔥，回鑊拌勻。", duration: 3 },
      { instruction: "加鹽調味，上碟。", duration: 1 },
    ]),
    tags: JSON.stringify(["家常"]),
    dishType: "vegetable",
    recipeCategory: "蔬菜",
    cookTime: 20,
    servings: 4,
    difficulty: "easy",
  };

  const row = normalizeLibraryRow(rawRow, "official");
  assert.ok(Array.isArray(row.steps), "normalizeLibraryRow must parse the JSON steps string");

  const cards = pickSoupMeal([row], mkExcludeSets([], []), 1, 0);
  assert.equal(cards.length, 1, "library card must survive pickSoupMeal");
  assert.deepEqual(cards[0].steps, [
    "洋蔥切絲，雞蛋打散。",
    "中火炒蛋至半熟，盛起。",
    "炒香洋蔥，回鑊拌勻。",
    "加鹽調味，上碟。",
  ]);
  const verdict = qualityVerdict(cards[0], { source: "library" });
  assert.equal(verdict.ok, true, verdict.reasons.join("；"));
});

test("clean 5-step AI main dish passes the quality gate", () => {
  const card = {
    name: "番茄炒蛋",
    ingredients: [{ name: "番茄" }, { name: "雞蛋" }],
    steps: [
      "番茄切塊，雞蛋打散備用。",
      "熱鑊落油，倒入蛋液炒至半熟。",
      "盛起雞蛋，原鑊炒香番茄。",
      "番茄軟身後回鑊拌勻。",
      "加鹽調味後上碟。",
    ],
  };
  assert.equal(isDisplayableRecipe(card, { source: "ai", role: "meat" }), true);
});

test("truncated 3-step AI main dish is rejected normally but accepted on salvage", () => {
  const truncated = {
    name: "番茄炒蛋",
    ingredients: [{ name: "番茄" }, { name: "雞蛋" }],
    steps: [
      "番茄切塊，雞蛋打散備用。",
      "熱鑊落油，倒入蛋液炒至半熟。",
      "盛起雞蛋，原鑊炒香番茄。",
    ],
  };
  assert.equal(isDisplayableRecipe(truncated, { source: "ai", role: "meat" }), false);
  assert.equal(isDisplayableRecipe(truncated, { source: "ai", role: "meat", path: "salvage" }), true);
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
