import assert from "node:assert/strict";
import test from "node:test";
import type { ChefCardSnapshot, ChefReply } from "./chefResponse";
import { validateChefReply } from "./chefResponse";

const card = (overrides: Partial<ChefCardSnapshot> = {}): ChefCardSnapshot => ({
  cardId: "official_1",
  name: "Black Pepper Beef",
  description: "Beef",
  cookTime: 20,
  servings: 4,
  difficulty: "Easy",
  ingredients: [
    { name: "Beef", quantity: "300", unit: "g" },
    { name: "Pepper", quantity: "1", unit: "tsp" },
  ],
  steps: ["Step 1", "Step 2", "Step 3", "Step 4", "Step 5"],
  tags: ["beef"],
  source: "official",
  role: "meat",
  ...overrides,
});

const reply = (overrides: Partial<ChefReply> = {}): ChefReply => ({
  requestId: "req_1",
  chatId: "chat_1",
  clientMessageId: "msg_1",
  status: "cards",
  recipes: [card()],
  replyText: "Here is your recipe:",
  requested: { total: 1, roles: ["meat"] },
  served: 1,
  missingRoles: [],
  sources: { library: 1, ai: 0 },
  quickReplies: [],
  ...overrides,
});

test("cards status requires at least one recipe", () => {
  assert.deepEqual(validateChefReply(reply()), []);
});

test("cards status with no recipes is invalid", () => {
  const errors = validateChefReply(reply({ recipes: [], served: 0 }));
  assert.ok(errors.some((e) => e.includes("cards")));
});

test("partial_cards requires missing roles", () => {
  const errors = validateChefReply(reply({
    status: "partial_cards",
    recipes: [card()],
    served: 1,
    requested: { total: 2, roles: ["meat", "dessert"] },
    missingRoles: [],
    replyText: "I found 1 of 2.",
  }));
  assert.ok(errors.some((e) => e.includes("missingRoles")));
});

test("no_cards cannot claim a recipe in text", () => {
  const errors = validateChefReply(reply({
    status: "no_cards",
    recipes: [],
    served: 0,
    replyText: "Here is a perfect dessert!",
  }));
  assert.ok(errors.some((e) => /claim|Here is|perfect/i.test(e)));
});

test("no_cards cannot include recipes", () => {
  const errors = validateChefReply(reply({
    status: "no_cards",
    recipes: [card()],
    served: 1,
    replyText: "No cards",
  }));
  assert.ok(errors.some((e) => e.includes("no_cards")));
});

test("clarify cannot include recipes", () => {
  const errors = validateChefReply(reply({
    status: "clarify",
    recipes: [card()],
    served: 1,
    replyText: "What do you mean?",
  }));
  assert.ok(errors.some((e) => e.includes("clarify")));
});

test("text status allows no cards and plain text", () => {
  assert.deepEqual(validateChefReply(reply({
    status: "text",
    recipes: [],
    served: 0,
    requested: { total: 0, roles: [] },
    replyText: "Steam the fish for 8 minutes.",
  })), []);
});

test("served must equal recipes length", () => {
  const errors = validateChefReply(reply({ served: 2 }));
  assert.ok(errors.some((e) => e.includes("served")));
});

const NEW_CLAIM_PHRASES = [
  "以下係甜品",
  "呢個就係甜品",
  "推介呢個甜品",
  "推薦呢個甜品",
  "為你推薦呢個甜品",
  "我幫你搵到甜品",
  "Here you go",
  "I recommend this dessert",
  "Try this dessert",
];

for (const phrase of NEW_CLAIM_PHRASES) {
  test(`no_cards rejects claim phrase: ${phrase}`, () => {
    const errors = validateChefReply(reply({
      status: "no_cards",
      recipes: [],
      served: 0,
      replyText: phrase,
    }));
    assert.ok(errors.some((e) => /claim/i.test(e)), `expected claim error for: ${phrase}`);
  });
}
