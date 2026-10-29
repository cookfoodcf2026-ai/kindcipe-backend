import assert from "node:assert/strict";
import test from "node:test";
import { getFeatureFlags } from "./aiChefFlags";
import { resolveChefIntent } from "./chefIntent";
import { applyTruthfulContract, buildChefReply } from "./aiChefLifecycle";
import { LIGHT_CHAT_MAX_TOKENS, LIGHT_CHAT_SYSTEM_PROMPT, getRecipeRetryReason, processAIChefChat, retryRecipeOutputOnce, zeroCardFoodReply } from "../routers/aiRecipe";
import { startLlmMeter } from "../_core/llm";
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
