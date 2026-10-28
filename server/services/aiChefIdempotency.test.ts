import assert from "node:assert/strict";
import test from "node:test";
import { buildClientMessageKey, getIdempotencyDecision } from "./aiChefIdempotency";

test("same client message and payload reuses cached response", () => {
  assert.equal(getIdempotencyDecision({ payloadHash: "abc", response: { ok: true } }, "abc"), "reuse");
});

test("same client message with different payload conflicts", () => {
  assert.equal(getIdempotencyDecision({ payloadHash: "abc", response: { ok: true } }, "xyz"), "conflict");
});

test("missing cached request is a miss", () => {
  assert.equal(getIdempotencyDecision(undefined, "abc"), "miss");
});

test("client message key is stable and scoped to family and chat", () => {
  assert.equal(buildClientMessageKey({ familyId: 13, chatId: "chat_1", clientMessageId: "msg_1" }), "13:chat_1:msg_1");
});

test("missing or empty client message id has no idempotency key", () => {
  assert.equal(buildClientMessageKey({ familyId: 13, chatId: "chat_1", clientMessageId: undefined }), null);
  assert.equal(buildClientMessageKey({ familyId: 13, chatId: "chat_1", clientMessageId: "   " }), null);
});
