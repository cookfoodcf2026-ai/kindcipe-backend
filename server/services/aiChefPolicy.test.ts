import assert from "node:assert/strict";
import test from "node:test";
import { shouldChargeChefRequest } from "./aiChefPolicy";

test("AI cards charge one credit", () => {
  assert.equal(shouldChargeChefRequest({ served: 1, aiCards: 1 }), true);
});

test("mixed library and AI cards charge when any AI card is served", () => {
  assert.equal(shouldChargeChefRequest({ served: 3, aiCards: 1 }), true);
});

test("pure library cards charge zero", () => {
  assert.equal(shouldChargeChefRequest({ served: 4, aiCards: 0 }), false);
});

test("zero-card responses charge zero", () => {
  assert.equal(shouldChargeChefRequest({ served: 0, aiCards: 0 }), false);
  assert.equal(shouldChargeChefRequest({ served: 0, aiCards: 1 }), false);
});

test("pure text chat charges zero", () => {
  assert.equal(shouldChargeChefRequest({ served: 0, aiCards: 0 }), false);
});

test("partial cards made only from library charge zero", () => {
  assert.equal(shouldChargeChefRequest({ served: 3, aiCards: 0 }), false);
});
