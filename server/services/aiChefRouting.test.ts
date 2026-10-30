import assert from "node:assert/strict";
import test from "node:test";
import { getFeatureFlags } from "./aiChefFlags";
import { resolveChefIntent } from "./chefIntent";
import { applyTruthfulContract, buildChefReply } from "./aiChefLifecycle";
import { LIGHT_CHAT_MAX_TOKENS, LIGHT_CHAT_SYSTEM_PROMPT, dropSeenAiCards, getFamilySeenNames, getRecipeRetryReason, hasAiCardsWithoutLlmCalls, mkExcludeSets, pickSoupMeal, processAIChefChat, recordFamilySeenNames, recordServedLibraryCards, retryRecipeOutputOnce, runWithDeadline, swapAiTimeoutReply, zeroCardFoodReply } from "../routers/aiRecipe";
import { startLlmMeter } from "../_core/llm";
import { aiReply } from "../_core/aiReply";
import type { ChefRunResult } from "./aiChefLifecycle";

const card = {
  name: "Mango Sago",
  description: "Mango dessert",
  cookTime: 20,
  servings: 4,
  difficulty: "easy",
  ingredients: [{ name: "Mango", quantity: "2", unit: "pcs" }, { name: "Sago", quantity: "50", unit: "g" }],
  steps: ["1", "2", "3", "4", "5"],
  tags: ["dessert"],
  source: "official" as const,
  officialId: 42,
};

const legacy = { content: "legacy text", recipes: [card], served: 1, warnings: [] as string[] };

test("new AI Chef flags default OFF", () => {
  const flags = getFeatureFlags();
  assert.equal(flags.ai_chef_truthful_contract, false);
  assert.equal(flags.ai_chef_client_message_id, false);
  assert.equal(flags.ai_chef_single_card_library, false);
  assert.equal(flags.ai_chef_any_library_miss_offer, false);
});

test("flag OFF returns the exact legacy response object", () => {
  const legacyResponse = { ...legacy };
  const contract = buildChefReply({
    requestId: "req_off",
    intent: resolveChefIntent("我想食甜品", { mode: "chat" }),
    result: { content: "legacy text", recipes: [card], llmUsed: false, llmCalls: 0 },
  });
  const out = applyTruthfulContract(legacyResponse, contract, false);
  assert.equal(out, legacyResponse);
  assert.equal("status" in out, false);
});

test("flag ON returns cards status and template text", () => {
  const intent = resolveChefIntent("我想食甜品", { mode: "chat" });
  const result: ChefRunResult = { content: "Here is a perfect recipe", recipes: [card], llmUsed: true, llmCalls: 1 };
  const contract = buildChefReply({ requestId: "req_cards", intent, result, templateText: true });
  assert.equal(contract.status, "cards");
  assert.equal(contract.served, 1);
  assert.match(contract.replyText, /準備好以下食譜/);
  const out = applyTruthfulContract({ ...legacy }, contract, true);
  assert.equal(out.status, "cards");
  assert.equal(out.content, contract.replyText);
  assert.equal(out.replyText, contract.replyText);
});

test("flag ON returns partial_cards with missingRoles", () => {
  const intent = resolveChefIntent("一肉一甜品", { mode: "chat" });
  const contract = buildChefReply({
    requestId: "req_partial",
    intent,
    result: { content: "partial", recipes: [card], llmUsed: true, missingRoles: ["meat"], llmCalls: 1 },
  });
  assert.equal(contract.status, "partial_cards");
  assert.equal(contract.served, 1);
  assert.deepEqual(contract.missingRoles, ["meat"]);
});

test("flag ON returns no_cards with safe template", () => {
  const intent = resolveChefIntent("咁有冇甜點", { mode: "chat" });
  const contract = buildChefReply({
    requestId: "req_none",
    intent,
    result: { content: "Here is a perfect dessert", recipes: [], llmUsed: false, missingRoles: ["dessert"], llmCalls: 0 },
  });
  assert.equal(contract.status, "no_cards");
  assert.deepEqual(contract.recipes, []);
  assert.equal(contract.served, 0);
  assert.doesNotMatch(contract.replyText, /here is|perfect|以下係|呢個就係|推介|推薦|我搵到/i);
  assert.ok(contract.quickReplies.length > 0);
});

test("flag ON returns clarify with safe template", () => {
  const intent = resolveChefIntent("我唔知煮咩好", { mode: "chat" });
  const contract = buildChefReply({
    requestId: "req_clarify",
    intent,
    result: { content: "好呀 — 你想中式、西式、快煮，定清淡？", recipes: [], llmUsed: false, llmCalls: 0 },
  });
  assert.equal(contract.status, "clarify");
  assert.deepEqual(contract.recipes, []);
});

test("flag ON text/technique still allows LLM text", () => {
  const intent = resolveChefIntent("蒸魚幾耐？", { mode: "chat" });
  const contract = buildChefReply({
    requestId: "req_text",
    intent,
    result: { content: "大約蒸 8 分鐘。", recipes: [], llmUsed: true, llmCalls: 1 },
    templateText: true,
  });
  assert.equal(contract.status, "text");
  assert.equal(contract.replyText, "大約蒸 8 分鐘。");
  assert.deepEqual(contract.recipes, []);
});

test("flag ON cards never use an LLM claim as user-visible text", () => {
  const intent = resolveChefIntent("我想食甜品", { mode: "chat" });
  const contract = buildChefReply({
    requestId: "req_claim",
    intent,
    result: { content: "Here is a perfect dessert", recipes: [card], llmUsed: true, llmCalls: 1 },
    templateText: true,
  });
  assert.equal(contract.status, "cards");
  assert.doesNotMatch(contract.replyText, /here is|perfect/i);
});

test("append operation is explicit and uses added template", () => {
  const intent = resolveChefIntent("加一個甜品", { mode: "chat" });
  const contract = buildChefReply({
    requestId: "req_append",
    intent,
    operation: "append",
    templateText: true,
    result: { content: "Here is a dessert", recipes: [card], llmUsed: false, llmCalls: 0 },
  });
  assert.equal(contract.status, "cards");
  assert.equal(contract.operation, "append");
  assert.match(contract.replyText, /加入以下食譜/);
});

test("explicit role library miss never calls the LLM", async () => {
  delete process.env.DATABASE_URL;
  const meter = startLlmMeter({ familyId: 13, route: "test" });
  const result = await processAIChefChat(
    [{ role: "user", content: "咁有冇甜點" }],
    13,
    undefined,
    "chat",
    [],
    undefined,
    "zh-TW",
    [],
    false,
    { ai_chef_single_card_library: true },
  );
  assert.equal(result.llmUsed, false);
  assert.equal(meter.calls, 0);
  assert.deepEqual(result.recipes, []);
  assert.ok(result.missingRoles?.includes("dessert"));
});

test("any-library offer flag ON returns no cards without LLM", async () => {
  const meter = startLlmMeter({ familyId: 13, route: "test-any" });
  const result = await processAIChefChat(
    [{ role: "user", content: "我想食啲清淡嘅" }],
    13,
    undefined,
    "chat",
    [],
    undefined,
    "zh-TW",
    [],
    false,
    { ai_chef_single_card_library: true, ai_chef_any_library_miss_offer: true },
  );
  assert.equal(result.llmUsed, false);
  assert.equal(meter.calls, 0);
  assert.deepEqual(result.recipes, []);
  assert.deepEqual(result.missingRoles, ["any"]);
});

test("truncated card output retries once and recovers cards", async () => {
  const truncated = '{"replyText":"今晚建議","recipes":[{"name":"凱撒';
  assert.equal(getRecipeRetryReason({ content: truncated, finishReason: "length", recipes: [], wantCards: true }), "finish_reason=length");
  const full = JSON.stringify({
    replyText: "準備好",
    recipes: [{
      name: "凱撒沙律", cookTime: 10, servings: 2, difficulty: "easy",
      ingredients: [{ name: "生菜", quantity: "1", unit: "份" }, { name: "麵包粒", quantity: "1", unit: "份" }],
      steps: ["1", "2", "3", "4", "5"],
    }],
  });
  const recovered = await retryRecipeOutputOnce(
    { content: truncated, finishReason: "length", recipes: [], wantCards: true, lang: "zh-TW" },
    async () => full,
  );
  assert.equal(recovered.retried, true);
  assert.equal(recovered.retrySucceeded, true);
  assert.equal(recovered.recipes.length, 1);
  assert.equal(recovered.recipes[0].name, "凱撒沙律");
});

test("truncated recipes array salvages named first recipe", async () => {
  const raw = String.raw`{"replyText":"收到！...重新生成一份完整、格式嚴謹的「黑椒蒜子雞扒」食譜...","recipes":[{"name":"黑椒蒜子雞扒","nameEn":"Black Pepper Garlic Chic`;
  const out = await retryRecipeOutputOnce(
    { content: raw, finishReason: "length", recipes: [], wantCards: true, lang: "zh-TW" },
    async () => raw,
  );
  assert.equal(out.retried, true);
  assert.equal(out.retrySucceeded, true);
  assert.equal(out.recipes.length, 1);
  assert.equal(out.recipes[0].name, "黑椒蒜子雞扒");
});

test("failed retry leaves zero cards for refund path", async () => {
  const truncated = '{"replyText":"今晚建議","recipes":[{"name":"凱撒';
  const recovered = await retryRecipeOutputOnce(
    { content: truncated, finishReason: "length", recipes: [], wantCards: true, lang: "zh-TW" },
    async () => truncated,
  );
  assert.equal(recovered.retried, true);
  assert.equal(recovered.retrySucceeded, false);
  assert.equal(recovered.recipes.length, 0);
});

test("scenario zero-hit logs scenario query tags rows seen filtered", async () => {
  delete process.env.DATABASE_URL;
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    const rows = [{
      id: 1,
      name: "電飯煲豉油雞",
      source: "official",
      cookTime: 40,
      steps: ["1"],
      ingredients: [],
      tags: [],
    }];
    const result = await processAIChefChat(
      [{ role: "user", content: "電飯煲" }],
      987654, undefined, "library",
      [], { query: "電飯煲", scenario: "ricecooker", count: 1, cookTimeMax: 10 },
      "zh-TW", [], false, {},
      "replace", true, true,
      async () => rows,
    );
    assert.deepEqual(result.recipes, []);
  } finally {
    console.log = originalLog;
  }
  const direct = logs.find((line) => line.includes("[AI Chef][scenario]") && line.includes("stage=direct"));
  assert.ok(direct);
  assert.match(direct!, /scenario=ricecooker/);
  assert.match(direct!, /query="電飯煲"/);
  assert.match(direct!, /scenarioTags=ricecooker/);
  assert.match(direct!, /rows=0/);
  assert.match(direct!, /seen=0/);
  assert.match(direct!, /filtered=0/);
  const fallback = logs.find((line) => line.includes("[AI Chef][scenario]") && line.includes("stage=fallback"));
  assert.ok(fallback);
  assert.match(fallback!, /rows=1/);
  assert.match(fallback!, /seen=0/);
  assert.match(fallback!, /filtered=0/);
});

test("same-session AI generation does not re-serve a seen dish", async () => {
  delete process.env.DATABASE_URL;
  const familyId = 918273;
  const dish = {
    name: "蒜蓉粉絲蒸扇貝",
    description: "蒜香粉絲蒸扇貝",
    cookTime: 20,
    servings: 4,
    difficulty: "easy" as const,
    ingredients: [{ name: "扇貝", quantity: "6", unit: "隻" }, { name: "粉絲", quantity: "1", unit: "把" }],
    steps: ["1", "2", "3", "4", "5"],
    tags: ["seafood"],
    source: "ai" as const,
  };
  const first = dropSeenAiCards([dish], await getFamilySeenNames(familyId));
  assert.equal(first.length, 1);
  await recordFamilySeenNames(familyId, first.map((recipe) => recipe.name));
  const seen = await getFamilySeenNames(familyId);
  assert.equal(seen.length, 1);
  assert.equal(seen[0], dish.name);
  const second = dropSeenAiCards([dish], seen);
  assert.equal(second.length, 0);
});

test("ricecooker scenario meal draws only from ricecooker pool", async () => {
  delete process.env.DATABASE_URL;
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    const scenarioRows = [
      { id: 1, name: "電飯煲香菇雞湯", dishType: "soup" },
      { id: 2, name: "電飯煲排骨湯", dishType: "soup" },
      { id: 3, name: "電飯煲豉油雞", dishType: "meat" },
      { id: 4, name: "電飯煲滷水雞翼", dishType: "meat" },
      { id: 5, name: "電飯煲蒸菜心", dishType: "vegetable" },
      { id: 6, name: "電飯煲蒸南瓜", dishType: "vegetable" },
    ].map((row) => ({ ...row, source: "official", cookTime: 30, servings: 4, ingredients: [], steps: ["1"], tags: [], scenarioTags: ["ricecooker"] }));
    const decoyRows = [
      { id: 7, name: "梅菜扣肉", dishType: "meat" },
      { id: 8, name: "蝦仁豆腐蒸水蛋", dishType: "other" },
      { id: 9, name: "蒜蓉炒菜心", dishType: "vegetable" },
      { id: 10, name: "咖哩魚蛋", dishType: "other" },
      { id: 11, name: "清蒸鱸魚", dishType: "seafood" },
      { id: 12, name: "紅燒肉", dishType: "meat" },
      { id: 13, name: "番茄炒蛋", dishType: "other" },
      { id: 14, name: "冬瓜湯", dishType: "soup" },
      { id: 15, name: "炒西蘭花", dishType: "vegetable" },
      { id: 16, name: "鹽焗雞", dishType: "meat" },
      { id: 17, name: "豉汁蒸排骨", dishType: "meat" },
      { id: 18, name: "灼蝦", dishType: "seafood" },
    ].map((row) => ({ ...row, source: "official", cookTime: 20, servings: 4, ingredients: [], steps: ["1"], tags: [], scenarioTags: [] }));
    const result = await processAIChefChat(
      [{ role: "user", content: "幫我諗" }],
      918277, undefined, "library",
      [], { scenario: "ricecooker", count: 4 },
      "zh-TW", [], false, {},
      "replace", true, true,
      async () => [...scenarioRows, ...decoyRows],
    );
    const allowed = new Set(scenarioRows.map((row) => row.name));
    assert.equal(result.recipes.length, 4);
    assert.ok(result.recipes.every((recipe) => allowed.has(recipe.name)), result.recipes.map((recipe) => recipe.name).join("|"));
  } finally {
    console.log = originalLog;
  }
  assert.ok(logs.some((line) => line.includes("[pickSoupMeal]") && line.includes("scenario=ricecooker") && line.includes("scenarioRows=6")));
});

test("scenario pool smaller than meal logs and tops up", async () => {
  delete process.env.DATABASE_URL;
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    const scenarioRows = [
      { id: 21, name: "電飯煲香菇雞湯", dishType: "soup" },
      { id: 22, name: "電飯煲豉油雞", dishType: "meat" },
    ].map((row) => ({ ...row, source: "official", cookTime: 30, servings: 4, ingredients: [], steps: ["1"], tags: [], scenarioTags: ["ricecooker"] }));
    const decoyRows = [
      { id: 23, name: "梅菜扣肉", dishType: "meat" },
      { id: 24, name: "蝦仁豆腐蒸水蛋", dishType: "other" },
      { id: 25, name: "蒜蓉炒菜心", dishType: "vegetable" },
      { id: 26, name: "咖哩魚蛋", dishType: "other" },
      { id: 27, name: "清蒸鱸魚", dishType: "seafood" },
      { id: 28, name: "紅燒肉", dishType: "meat" },
    ].map((row) => ({ ...row, source: "official", cookTime: 20, servings: 4, ingredients: [], steps: ["1"], tags: [], scenarioTags: [] }));
    const result = await processAIChefChat(
      [{ role: "user", content: "幫我諗" }],
      918278, undefined, "library",
      [], { scenario: "ricecooker", count: 4 },
      "zh-TW", [], false, {},
      "replace", true, true,
      async () => [...scenarioRows, ...decoyRows],
    );
    assert.equal(result.recipes.length, 4);
  } finally {
    console.log = originalLog;
  }
  assert.ok(logs.some((line) => line.includes("reason=scenario_pool_small") && line.includes("scenarioRows=2")));
});

test("dish-like keyword with multiple library matches serves cards instead of clarify", async () => {
  delete process.env.DATABASE_URL;
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    const rows = [
      "電飯煲番茄牛肉燉飯",
      "電飯煲豉油雞",
      "電飯煲香菇雞飯",
      "電飯煲排骨飯",
      "電飯煲臘味飯",
    ].map((name, index) => ({
      id: index + 1,
      name,
      source: "official",
      dishType: "rice",
      cookTime: 30,
      servings: 4,
      ingredients: [],
      steps: ["1"],
      tags: [],
    }));
    const result = await processAIChefChat(
      [{ role: "user", content: "電飯煲" }],
      918276, undefined, "library",
      [], { scenario: "ricecooker", count: 4 },
      "zh-TW", [], false, {},
      "replace", true, true,
      async () => rows,
    );
    assert.ok(result.recipes.length >= 2, `served=${result.recipes.length}`);
    assert.equal(result.clarifyReason, undefined);
  } finally {
    console.log = originalLog;
  }
  assert.ok(logs.some((line) => line.includes("reason=keyword_match")));
});

test("library early-return cards are recorded and avoided next turn", async () => {
  delete process.env.DATABASE_URL;
  const familyId = 918275;
  const row = (id: number, name: string, dishType: string) => ({
    id,
    name,
    source: "official",
    dishType,
    cookTime: 20,
    servings: 4,
    ingredients: [],
    steps: ["1"],
    tags: [],
  });
  const rows = [
    row(1, "黑椒牛柳", "meat"),
    row(2, "紅燒肉", "meat"),
    row(3, "清蒸魚", "seafood"),
    row(4, "紅燒魚", "seafood"),
    row(5, "炒菜心", "vegetable"),
    row(6, "蒜蓉西蘭花", "vegetable"),
  ];
  const first = pickSoupMeal(rows, mkExcludeSets([], []), 3, 0);
  assert.equal(first.length, 3);
  await recordServedLibraryCards(familyId, first);
  const seen = await getFamilySeenNames(familyId);
  assert.equal(seen.length, 3);
  const second = pickSoupMeal(rows, mkExcludeSets(seen, seen), 3, 0);
  assert.equal(second.length, 3);
  const overlap = second.filter((next) => first.some((prev) => prev.name === next.name));
  assert.equal(overlap.length, 0);
});

test("swap AI deadline returns clarify instead of waiting for slow LLM", async () => {
  const started = Date.now();
  const result = await runWithDeadline(
    new Promise<never>(() => {}),
    50,
    () => ({
      content: swapAiTimeoutReply("zh-TW"),
      recipes: [],
      llmUsed: true,
      clarifyReason: "ai_failed" as const,
    }),
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 500, `deadline took ${elapsed}ms`);
  assert.equal(result.recipes.length, 0);
  assert.equal(result.clarifyReason, "ai_failed");
  assert.match(result.content, /冇扣你 credit/);
  assert.match(swapAiTimeoutReply("en"), /No credit/i);
});

test("AI cards with zero LLM calls trip the meter invariant", () => {
  assert.equal(hasAiCardsWithoutLlmCalls({ aiCards: 4, llmCalls: 0 }), true);
  assert.equal(hasAiCardsWithoutLlmCalls({ aiCards: 4, llmCalls: 4 }), false);
  assert.equal(hasAiCardsWithoutLlmCalls({ aiCards: 0, llmCalls: 0 }), false);
});

test("zero-card food copy is deterministic and never claims cards exist", () => {
  const zh = zeroCardFoodReply("zh-TW");
  const en = zeroCardFoodReply("en");
  assert.match(zh, /冇扣你 credit/);
  assert.doesNotMatch(zh, /已準備|已提供|準備好以下/);
  assert.match(en, /No credit was charged/);
  assert.doesNotMatch(en, /prepared|provided/i);
});

test("light chat prompt has no recipe JSON schema and uses 400 tokens", () => {
  assert.equal(LIGHT_CHAT_MAX_TOKENS, 400);
  assert.ok(LIGHT_CHAT_SYSTEM_PROMPT.length < 1200);
  assert.doesNotMatch(LIGHT_CHAT_SYSTEM_PROMPT, /"recipes"|JSON 格式|recipes array/i);
});

test("FAQ answer bypasses the LLM", async () => {
  delete process.env.DATABASE_URL;
  const result = await processAIChefChat(
    [{ role: "user", content: "煎牛扒幾耐？" }],
    13, undefined, "chat", [], undefined, "zh-TW", [], false,
    { ai_chef_single_card_library: true, ai_chef_any_library_miss_offer: false },
    "replace", true, true,
  );
  assert.equal(result.llmUsed, false);
  assert.equal(result.recipes.length, 0);
  assert.match(result.content, /牛扒/);
});

test("chat quota exhaustion returns deterministic fallback without LLM", async () => {
  delete process.env.DATABASE_URL;
  const result = await processAIChefChat(
    [{ role: "user", content: "你今日點呀？" }],
    13, undefined, "chat", [], undefined, "zh-TW", [], false,
    { ai_chef_single_card_library: true, ai_chef_any_library_miss_offer: false },
    "replace", true, false,
  );
  assert.equal(result.llmUsed, false);
  assert.equal(result.recipes.length, 0);
  assert.match(result.content, /食譜庫|FAQ/);
});

test("library miss uses clarify status without cards", () => {
  const intent = resolveChefIntent("我想食魚湯粉同菜", { mode: "chat" });
  const reply = buildChefReply({
    requestId: "req_library_miss",
    intent,
    result: {
      content: "我未有你指定嘅魚湯粉",
      recipes: [],
      llmUsed: false,
      missingRoles: intent.requested.roles,
      clarifyReason: "library_miss",
    },
  });
  assert.equal(reply.status, "clarify");
  assert.equal(reply.clarifyReason, "library_miss");
  assert.equal(reply.served, 0);
});

test("partial AI stays partial_cards with ai_partial reason", () => {
  const intent = resolveChefIntent("我要2樣餸", { mode: "chat" });
  const reply = buildChefReply({
    requestId: "req_ai_partial",
    intent,
    result: {
      content: "我搵到 1 個，但未完成 2 個",
      recipes: [{ ...card, source: "ai", officialId: undefined }],
      llmUsed: true,
      missingRoles: ["any"],
      clarifyReason: "ai_partial",
    },
  });
  assert.equal(reply.status, "partial_cards");
  assert.equal(reply.clarifyReason, "ai_partial");
  assert.equal(reply.served, 1);
});

test("search failure returns clarify without calling the LLM", async () => {
  delete process.env.DATABASE_URL;
  const result = await processAIChefChat(
    [{ role: "user", content: "魚面" }],
    13, undefined, "chat", [], undefined, "zh-TW", [], false,
    { ai_chef_single_card_library: true, ai_chef_any_library_miss_offer: false },
    "replace", true, true,
    async () => { throw new Error("lib search timeout"); },
  );
  assert.equal(result.recipes.length, 0);
  assert.equal(result.llmUsed, false);
  assert.equal(result.clarifyReason, "lib_search_fail");
  assert.match(result.content, /匯入|AI/);
});

test("canned search failure returns clarify instead of AI cards", async () => {
  delete process.env.DATABASE_URL;
  const result = await processAIChefChat(
    [{ role: "user", content: "請為我設計今晚「3 餸 1 湯」晚餐，總共 4 道菜，適合4人食用。請提供完整食譜，分類如下：" }],
    13, undefined, "library", [], undefined, "zh-TW", [], false,
    { ai_chef_single_card_library: true, ai_chef_any_library_miss_offer: false },
    "replace", true, true,
    async () => { throw new Error("lib search throw"); },
  );
  assert.equal(result.recipes.length, 0);
  assert.equal(result.llmUsed, false);
  assert.equal(result.clarifyReason, "lib_search_fail");
});

test("clarify quick replies expose import, closest library, and AI actions", () => {
  const intent = resolveChefIntent("魚面", { mode: "chat" });
  const reply = buildChefReply({
    requestId: "req_quick_replies",
    intent,
    result: {
      content: "我未有你指定嘅魚面",
      recipes: [],
      llmUsed: false,
      clarifyReason: "library_miss",
    },
  });
  assert.deepEqual(reply.quickReplies.map((q) => q.actionId), ["import_recipe", "closest_library", "ai_generate"]);
});

test("mode=ai prose result cannot become a card", () => {
  const intent = resolveChefIntent("請設計一個簡單嘅家常菜食譜", { mode: "ai" });
  const reply = buildChefReply({
    requestId: "req_ai_prose",
    intent,
    result: { content: "廣式乾炒牛河，不對，是金銀蛋浸魚片…", recipes: [], llmUsed: true },
  });
  assert.equal(reply.served, 0);
  assert.notEqual(reply.status, "cards");
});

test("mode=ai bypasses library-miss clarify guard", async () => {
  delete process.env.DATABASE_URL;
  const result = await processAIChefChat(
    [{ role: "user", content: "蝦子麵" }],
    13, undefined, "ai", [], undefined, "zh-TW", [], false,
    { ai_chef_single_card_library: true, ai_chef_any_library_miss_offer: false },
  );
  assert.notEqual(result.clarifyReason, "library_miss");
});

test("clarify quick replies are reason-specific", () => {
  const cases: Array<[any, string[]]> = [
    ["library_miss", ["import_recipe", "closest_library", "ai_generate"]],
    ["ingredient_miss", ["closest_library", "ai_generate"]],
    ["lib_search_fail", ["retry_search", "ai_generate", "retry_later"]],
    ["ai_partial", ["complete_cards", "swap_cards", "accept_partial"]],
  ];
  for (const [reason, expected] of cases) {
    const intent = resolveChefIntent("我想食魚湯粉同菜", { mode: "chat" });
    const reply = buildChefReply({
      requestId: `req_${reason}`,
      intent,
      result: {
        content: "reason test",
        recipes: reason === "ai_partial" ? [{ ...card, source: "ai", officialId: undefined }] : [],
        llmUsed: reason === "ai_partial",
        missingRoles: reason === "ai_partial" ? ["any"] : intent.requested.roles,
        clarifyReason: reason,
      },
    });
    assert.deepEqual(reply.quickReplies.map((q) => q.actionId), expected, reason);
  }
});

test("fixed library-miss copy has three exits in four languages", () => {
  for (const lang of ["zh-TW", "en", "fil", "id"]) {
    const text = aiReply(lang, "libNone");
    assert.doesNotMatch(text, /喺 chat 貼上|paste in chat/i, lang);
    assert.match(text, /1\)|1\.|1\)/);
    assert.match(text, /AI/i);
  }
});
