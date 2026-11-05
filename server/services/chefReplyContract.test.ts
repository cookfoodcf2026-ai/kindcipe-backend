import assert from "node:assert/strict";
import test from "node:test";
import { buildChefReply } from "./aiChefLifecycle";
import { validateChefReply } from "./chefResponse";
import type { ChefIntent } from "./chefIntent";

function intent(kind: ChefIntent["kind"], total: number): ChefIntent {
  return {
    kind,
    wantsCards: true,
    requested: { total, roles: Array.from({ length: total }, () => "any" as const) },
    confidence: 0.9,
    reason: "explicit_items",
  } as ChefIntent;
}

function recipe(name: string) {
  return {
    name,
    description: "",
    cookTime: 20,
    servings: 4,
    difficulty: "easy",
    ingredients: [{ name: "材料" }],
    steps: ["步驟一"],
    tags: [],
    source: "official" as const,
  };
}

test("contract: 單菜意圖即使 intent.total=3，1 張卡都可以係 cards 而且過到 validate", () => {
  const reply = buildChefReply({
    requestId: "r1",
    intent: intent("recipe", 3),
    result: { content: "", recipes: [recipe("豉汁蒸鯇魚")] as any, llmUsed: false, llmCalls: 0 },
    templateText: true,
  });
  assert.equal(reply.status, "cards");
  assert.equal(reply.requested.total, 1);
  assert.deepEqual(validateChefReply(reply), []);
});

test("contract: meal 意圖 2/4 仍然係 partial_cards 而且過到 validate", () => {
  const reply = buildChefReply({
    requestId: "r2",
    intent: intent("meal", 4),
    result: {
      content: "",
      recipes: [recipe("豉汁蒸鯇魚"), recipe("蒜蓉炒菜心")] as any,
      llmUsed: false,
      llmCalls: 0,
    },
    templateText: true,
    explicitMealShape: true,
  });
  assert.equal(reply.status, "partial_cards");
  assert.equal(reply.requested.total, 4);
  assert.deepEqual(validateChefReply(reply), []);
});
