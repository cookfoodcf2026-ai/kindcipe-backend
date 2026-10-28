import assert from "node:assert/strict";
import test from "node:test";

// Ensure the old auto-LLM path is used when the new flags are OFF. No real LLM
// key is set, so invokeLLM fails fast; llmUsed=true proves the LLM path was
// attempted and the library/offer guard was skipped.
process.env.DATABASE_URL = "";
process.env.DASHSCOPE_API_KEY = "";
process.env.GEMINI_API_KEY = "";

test("single-card flag OFF preserves the legacy auto-LLM path", async () => {
  const { processAIChefChat } = await import("../routers/aiRecipe");
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
    {
      ai_chef_single_card_library: false,
      ai_chef_any_library_miss_offer: false,
    },
  );
  assert.equal(result.llmUsed, true);
  assert.equal(result.recipes.length, 0);
});

test("any-library flag OFF preserves auto-LLM for any role", async () => {
  const { processAIChefChat } = await import("../routers/aiRecipe");
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
    {
      ai_chef_single_card_library: true,
      ai_chef_any_library_miss_offer: false,
    },
  );
  assert.equal(result.llmUsed, true);
  assert.equal(result.recipes.length, 0);
});
