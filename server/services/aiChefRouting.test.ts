import assert from "node:assert/strict";
import test from "node:test";
import { getFeatureFlags } from "./aiChefFlags";
import { resolveChefIntent } from "./chefIntent";
import { applyTruthfulContract, buildChefReply } from "./aiChefLifecycle";
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
