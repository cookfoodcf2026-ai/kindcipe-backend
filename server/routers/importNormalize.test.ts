import assert from "node:assert/strict";
import test from "node:test";
import { cnQuantityToArabic, extractStepsFromDescription, guardServings, markTranslationPending, normalizeIngredientAmount } from "./recipes";
import { localizedName, needsChineseBase } from "../utils/recipeTranslations";
import { isPendingForTranslation, nextTranslationState } from "../services/translationQueue";
import { buildImportParseEvent, classifyImportParseResult } from "../services/importTelemetry";
import { checkRecipeContent } from "../services/importQuality";

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

test("import content gate rejects title-only cards", () => {
  const empty = checkRecipeContent([], []);
  assert.equal(empty.ok, false);
  assert.deepEqual(empty.ok ? [] : empty.missing, ["ingredients", "steps"]);
  assert.match(empty.ok ? "" : empty.message, /只抽到標題/);
  assert.equal(checkRecipeContent([{ name: "  " }], [{ instruction: " " }]).ok, false);
  const onlyIngredients = checkRecipeContent([{ name: "薯仔" }], []);
  const onlySteps = checkRecipeContent([], [{ instruction: "煎香" }]);
  assert.equal(onlyIngredients.ok, false);
  assert.equal(onlySteps.ok, false);
  if (!onlyIngredients.ok) assert.deepEqual(onlyIngredients.missing, ["steps"]);
  if (!onlySteps.ok) assert.deepEqual(onlySteps.missing, ["ingredients"]);
});

test("import content gate accepts one real ingredient and one real step", () => {
  assert.equal(checkRecipeContent([{ name: "薯仔" }], ["煎香"]).ok, true);
  assert.equal(checkRecipeContent([{ name: "薯仔" }], [{ instruction: "煎香" }]).ok, true);
});

test("youtube description steps are parsed deterministically", () => {
  const description = `材料：\n蝦 8隻\n薯仔 2個\n做法：\n0:00 1. 蝦去殼去腸，用鹽醃十分鐘。\n2. 薯仔切片，落鑊煎至金黃。\n3. 加入蝦一同煎香，調味上碟。 #recipe https://example.com @chef`;
  const steps = extractStepsFromDescription(description);
  assert.equal(steps.length >= 3, true);
  assert.match(steps[0], /蝦去殼/);
  assert.doesNotMatch(steps.join(" "), /0:00|#recipe|example\.com|@chef/);
  assert.deepEqual(extractStepsFromDescription("材料：\n蝦 8隻\n薯仔 2個。"), []);
});

test("import_parse event is emitted with result and counts", () => {
  const event = buildImportParseEvent({
    source: "instagram",
    result: classifyImportParseResult({ parseReason: "ok", ingredientCount: 3, stepCount: 0, source: "instagram" }),
    hasCaption: true,
    captionChars: 120,
    hasIngredients: true,
    ingredientCount: 3,
    stepCount: 0,
    stepsSource: "none",
    stageMs: { fetch: 40, parse: 200, translate: 30, classify: 10 },
    familyId: 13,
  });
  assert.equal(event.event, "import_parse");
  assert.equal(event.source, "instagram");
  assert.equal(event.result, "partial");
  assert.equal(event.hasCaption, true);
  assert.equal(event.captionChars, 120);
  assert.equal(event.hasIngredients, true);
  assert.equal(event.ingredientCount, 3);
  assert.equal(event.stepCount, 0);
  assert.equal(event.stepsSource, "none");
  assert.deepEqual(event.stageMs, { fetch: 40, parse: 200, translate: 30, classify: 10 });
  assert.equal(event.familyId, 13);
});

test("parse returns zh recipe before translations", () => {
  const result = markTranslationPending({
    name: "滷水雞翼拼豆腐",
    steps: ["處理雞翼 雞翼浸淡鹽水約 2 小時瀝乾"],
    ingredients: [{ name: "雞中翼" }],
  });
  assert.equal(result.translationStatus, "pending");
  assert.match(result.name, /滷水/);
  assert.equal(result.nameEn, undefined);
  assert.equal(result.nameFil, undefined);
  assert.equal(result.nameId, undefined);
});

test("non-zh source still canonicalises to chinese first", () => {
  assert.equal(needsChineseBase("Braised Chicken Wings"), true);
  assert.equal(needsChineseBase("滷水雞翼"), false);
  assert.equal(needsChineseBase(""), false);
});

test("missing translations fall back to chinese on read", () => {
  assert.equal(localizedName(undefined, "滷水雞翼"), "滷水雞翼");
  assert.equal(localizedName(null, "滷水雞翼"), "滷水雞翼");
  assert.equal(localizedName("Braised Chicken", "滷水雞翼"), "Braised Chicken");
});

test("translation failure marks pending and retries", () => {
  assert.deepEqual(nextTranslationState(0, false), { status: "pending", attempts: 1 });
  assert.deepEqual(nextTranslationState(3, false), { status: "pending", attempts: 4 });
  assert.deepEqual(nextTranslationState(4, false), { status: "failed", attempts: 5 });
  assert.deepEqual(nextTranslationState(2, true), { status: "ready", attempts: 0 });
});

test("sweep enqueues pending rows only", () => {
  assert.equal(isPendingForTranslation("pending", 0), true);
  assert.equal(isPendingForTranslation("pending", 4), true);
  assert.equal(isPendingForTranslation("pending", 5), false);
  assert.equal(isPendingForTranslation("ready", 0), false);
  assert.equal(isPendingForTranslation("failed", 0), false);
});

test("ready rows are not re-enqueued", () => {
  assert.equal(isPendingForTranslation("ready", 0), false);
});
