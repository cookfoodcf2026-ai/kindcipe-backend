import assert from "node:assert/strict";
import test from "node:test";
import { validateChefDispatch } from "./chefDispatcher";

test("valid dispatcher payload passes validation", () => {
  const value = validateChefDispatch({
    intent: "cards",
    items: [{ label: "魚湯麵", kind: "dish", qty: 1 }],
    confidence: 0.9,
    ask: { needed: false, question: "" },
    replyText: "好，幫你搵魚湯麵。",
  });
  assert.ok(value);
  assert.equal(value.items.length, 1);
});

test("invalid intent or item kind is rejected", () => {
  assert.equal(validateChefDispatch({ intent: "invent", items: [], confidence: 0.9 }), null);
  assert.equal(validateChefDispatch({ intent: "cards", items: [{ label: "魚", kind: "magic", qty: 1 }], confidence: 0.9 }), null);
});

test("invalid confidence and oversized qty are rejected", () => {
  assert.equal(validateChefDispatch({ intent: "cards", items: [], confidence: 2 }), null);
  assert.equal(validateChefDispatch({ intent: "cards", items: [{ label: "魚", kind: "dish", qty: 99 }], confidence: 0.9 }), null);
});

test("cards intent strips questions from replyText", async () => {
  const { normalizeDispatchContract } = await import("./chefDispatcher");
  const value = normalizeDispatchContract({
    intent: "cards",
    items: [{ label: "魚湯麵", kind: "dish", qty: 1 }],
    confidence: 0.9,
    ask: { needed: false, question: "" },
    replyText: "收到，三餸一湯。想食啲咩口味？",
  });
  assert.equal(/[?？]/.test(value.replyText), false);
  assert.equal(value.ask.needed, false);
});

test("ask intent never carries cards/items", async () => {
  const { normalizeDispatchContract } = await import("./chefDispatcher");
  const value = normalizeDispatchContract({
    intent: "cards",
    items: [{ label: "魚湯麵", kind: "dish", qty: 1 }],
    confidence: 0.5,
    ask: { needed: true, question: "想要邊款？" },
    replyText: "想要邊款？",
  });
  assert.equal(value.items.length, 0);
  assert.equal(value.ask.needed, true);
  assert.match(value.ask.question, /邊款/);
});

test("category roles distribute without all any", async () => {
  const { categoryRolesForDispatch } = await import("./chefDispatcher");
  assert.deepEqual(categoryRolesForDispatch("餸菜", 3), ["meat", "seafood", "vegetable"]);
  assert.equal(categoryRolesForDispatch("餸菜", 3)?.includes("any"), false);
  assert.deepEqual(categoryRolesForDispatch("湯", 2), ["soup", "soup"]);
});
