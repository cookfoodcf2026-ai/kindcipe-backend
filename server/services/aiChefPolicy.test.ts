import assert from "node:assert/strict";
import test from "node:test";
import { shouldChargeChefRequest } from "./aiChefPolicy";

test("charges a complete recipe set", () => {
  assert.equal(shouldChargeChefRequest({ llmUsed: true, requested: 4, served: 4 }), true);
});

test("does not charge a partial 3-of-4 set", () => {
  assert.equal(shouldChargeChefRequest({ llmUsed: true, requested: 4, served: 3 }), false);
});

test("does not charge a zero-card recipe request", () => {
  assert.equal(shouldChargeChefRequest({ llmUsed: true, requested: 4, served: 0 }), false);
});

test("does not charge pure library results", () => {
  assert.equal(shouldChargeChefRequest({ llmUsed: false, requested: 4, served: 4 }), false);
});

test("still charges a text answer", () => {
  assert.equal(shouldChargeChefRequest({ llmUsed: true, requested: 0, served: 0 }), true);
});

test("does not charge a zero-card text answer that promises cards", () => {
  assert.equal(shouldChargeChefRequest({ llmUsed: true, requested: 0, served: 0, cardClaim: true }), false);
});

test("still charges a genuine text answer with no card promise", () => {
  assert.equal(shouldChargeChefRequest({ llmUsed: true, requested: 0, served: 0, cardClaim: false }), true);
});

test("does not charge a wantsCards request that served zero cards", () => {
  assert.equal(shouldChargeChefRequest({ llmUsed: true, requested: 0, served: 0, wantsCards: true }), false);
});

test("plain text chat still charges", () => {
  assert.equal(shouldChargeChefRequest({ llmUsed: true, requested: 0, served: 0, wantsCards: false }), true);
});
