import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL = "";
process.env.DASHSCOPE_API_KEY = "";
process.env.GEMINI_API_KEY = "";

const card = (
  name: string,
  ingredients: string[] = [],
  extra: Record<string, unknown> = {},
): any => ({
  name,
  ingredients: ingredients.map((ingredient) => ({ name: ingredient, quantity: "", unit: "" })),
  cookTime: 20,
  tags: [],
  ...extra,
});

test("constraint layer: one object with positives deducted by negatives", async () => {
  const { buildChefConstraintLayer } = await import("./chefConstraintLayer");
  const layer = buildChefConstraintLayer("唔要豬，想食雞，20分鐘，3餸1湯，雪櫃有菜心");
  assert.deepEqual(layer.positives, ["chicken"]);
  assert.deepEqual(layer.negatives, ["pork"]);
  assert.equal(layer.diet, null);
  assert.equal(layer.maxMinutes, 20);
  assert.equal(layer.dishCount, 3);
  assert.equal(layer.soups, 1);
  assert.ok(layer.pantry.includes("菜心"));
  assert.doesNotMatch(layer.positiveText, /唔要豬/);
  assert.match(layer.positiveText, /想食雞/);
});

test("constraint layer: vegan feeds the same meat red line as vegetarian", async () => {
  const { buildChefConstraintLayer, constraintMatcherInput } = await import("./chefConstraintLayer");
  const matcher = constraintMatcherInput(buildChefConstraintLayer("純素"), []);
  assert.match(matcher.text, /素食/);
});

test("constraint shadow: oldServed > 0 and newServed = 0 is new_zero", async () => {
  const { buildChefConstraintLayer, computeConstraintShadow } = await import("./chefConstraintLayer");
  const { cardPassesHardConstraint } = await import("../routers/aiRecipe");
  const seafood = card("蒜蓉蒸蝦", ["蝦"]);
  const shadow = computeConstraintShadow(
    [seafood],
    [seafood],
    buildChefConstraintLayer("唔要海鮮"),
    [],
    (item, input) => cardPassesHardConstraint(item, input),
  );
  assert.equal(shadow.oldServed, 1);
  assert.equal(shadow.newServed, 0);
  assert.equal(shadow.wouldZero, true);
  assert.equal(shadow.diffClass, "new_zero");
});

test("constraint shadow: avoid 海鮮 leaves no seafood cards (fixture)", async () => {
  const { buildChefConstraintLayer, computeConstraintShadow } = await import("./chefConstraintLayer");
  const { cardPassesHardConstraint } = await import("../routers/aiRecipe");
  const pool = [
    card("蒜香白酒煮青口", ["青口"]),
    card("清蒸鱸魚", ["鱸魚"]),
    card("蒜蓉炒菜心", ["菜心"]),
    card("魚香茄子", ["茄子"]),
  ];
  const shadow = computeConstraintShadow(
    pool,
    pool,
    buildChefConstraintLayer("有咩推介"),
    ["海鮮"],
    (item, input) => cardPassesHardConstraint(item, input),
  );
  assert.deepEqual(shadow.newNames, ["蒜蓉炒菜心", "魚香茄子"]);
  assert.equal(shadow.newNames.some((name) => /青口|鱸魚/.test(name)), false);
  assert.deepEqual(shadow.avoid, ["海鮮"]);
});

test("constraint shadow never mutates its card inputs", async () => {
  const { buildChefConstraintLayer, computeConstraintShadow } = await import("./chefConstraintLayer");
  const pre = [card("清蒸鱸魚", ["鱸魚"]), card("蒜蓉炒菜心", ["菜心"])];
  const old = [card("清蒸鱸魚", ["鱸魚"])];
  const preSnapshot = JSON.stringify(pre);
  const oldSnapshot = JSON.stringify(old);
  computeConstraintShadow(
    pre,
    old,
    buildChefConstraintLayer("唔要海鮮"),
    [],
    (item, input) => item.name === "蒜蓉炒菜心" && input.avoidIngredients?.includes("海鮮") === true,
  );
  assert.equal(JSON.stringify(pre), preSnapshot);
  assert.equal(JSON.stringify(old), oldSnapshot);
});

test("constraint layer flag defaults OFF and never changes served/recipes/credit", async () => {
  const { getFeatureFlags } = await import("../services/aiChefFlags");
  const { processAIChefChat } = await import("../routers/aiRecipe");
  const { shouldChargeChefRequest } = await import("../services/aiChefPolicy");

  const original = process.env.AI_CHEF_CONSTRAINT_LAYER;
  try {
    delete process.env.AI_CHEF_CONSTRAINT_LAYER;
    assert.equal(getFeatureFlags().ai_chef_constraint_layer, false);
    process.env.AI_CHEF_CONSTRAINT_LAYER = "1";
    assert.equal(getFeatureFlags().ai_chef_constraint_layer, true);
  } finally {
    if (original === undefined) delete process.env.AI_CHEF_CONSTRAINT_LAYER;
    else process.env.AI_CHEF_CONSTRAINT_LAYER = original;
  }

  const baseFlags = {
    ai_chef_single_card_library: false,
    ai_chef_any_library_miss_offer: false,
  };
  const run = (enabled: boolean) => processAIChefChat(
    [{ role: "user", content: "一甜品" }],
    13,
    undefined,
    "chat",
    [],
    undefined,
    "zh-TW",
    [],
    false,
    { ...baseFlags, ai_chef_constraint_layer: enabled } as any,
  );
  const summarize = (result: any) => {
    const served = result.recipes?.length ?? 0;
    const aiCards = (result.recipes ?? []).filter((recipe: any) => (recipe.source ?? "ai") === "ai").length;
    const shouldCharge = shouldChargeChefRequest({ served, aiCards });
    return {
      content: result.content,
      recipes: (result.recipes ?? []).map((recipe: any) => recipe.name),
      llmUsed: result.llmUsed,
      served,
      aiCards,
      credits: shouldCharge ? 1 : 0,
    };
  };
  const off = await run(false);
  const on = await run(true);
  assert.deepEqual(summarize(on), summarize(off));
  assert.equal(summarize(on).credits, summarize(off).credits);
});
