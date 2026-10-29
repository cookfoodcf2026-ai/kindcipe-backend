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
