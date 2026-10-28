import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL = "";
process.env.DASHSCOPE_API_KEY = "";
process.env.GEMINI_API_KEY = "";

async function run(flags: { ai_chef_single_card_library?: boolean; ai_chef_any_library_miss_offer?: boolean }, text = "一甜品") {
  const { processAIChefChat } = await import("../routers/aiRecipe");
  return processAIChefChat(
    [{ role: "user", content: text }],
    13, undefined, "chat", [], undefined, "zh-TW", [], false,
    flags,
  );
}

test("rollout: TRUTHFUL OFF + SINGLE ON offers library miss without LLM", async () => {
  const result = await run({ ai_chef_single_card_library: true, ai_chef_any_library_miss_offer: false });
  assert.equal(result.llmUsed, false);
  assert.deepEqual(result.recipes, []);
});

test("rollout: TRUTHFUL ON + SINGLE OFF keeps old auto-LLM path", async () => {
  const result = await run({ ai_chef_single_card_library: false, ai_chef_any_library_miss_offer: false });
  assert.equal(result.llmUsed, true);
});

test("rollout: SINGLE ON + ANY OFF keeps any-role auto-LLM path", async () => {
  const result = await run({ ai_chef_single_card_library: true, ai_chef_any_library_miss_offer: false }, "我想食啲清淡嘅");
  assert.equal(result.llmUsed, true);
});

test("regression: OFF/OFF/OFF keeps legacy auto-LLM path", async () => {
  const result = await run({ ai_chef_single_card_library: false, ai_chef_any_library_miss_offer: false });
  assert.equal(result.llmUsed, true);
});
