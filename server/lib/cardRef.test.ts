import assert from "node:assert/strict";
import test from "node:test";
import { toCardRef } from "./cardRef";

test("number id resolves using source", () => {
  assert.deepEqual(toCardRef({ source: "official", id: 42 }), { officialId: 42 });
  assert.deepEqual(toCardRef({ source: "custom", id: 7 }), { customId: 7 });
});

test("prefixed id resolves without source", () => {
  assert.deepEqual(toCardRef({ id: "official_123" }), { officialId: 123 });
  assert.deepEqual(toCardRef({ id: "user_123" }), { customId: 123 });
});

test("colon id resolves", () => {
  assert.deepEqual(toCardRef({ id: "official:9" }), { officialId: 9 });
  assert.deepEqual(toCardRef({ id: "user:9" }), { customId: 9 });
});

test("explicit officialId/customId win", () => {
  assert.deepEqual(toCardRef({ officialId: 5, source: "custom", id: 1 }), { officialId: 5 });
  assert.deepEqual(toCardRef({ customId: "6", source: "official", id: 1 }), { customId: 6 });
});

test("bare string id resolves using source", () => {
  assert.deepEqual(toCardRef({ source: "official", id: "12" }), { officialId: 12 });
  assert.deepEqual(toCardRef({ source: "user", id: "12" }), { customId: 12 });
});

test("NaN returns null", () => {
  assert.equal(toCardRef({ source: "official", id: Number.NaN }), null);
  assert.equal(toCardRef({ id: "official_NaN" }), null);
});

test("zero returns null", () => {
  assert.equal(toCardRef({ source: "official", id: 0 }), null);
  assert.equal(toCardRef({ id: "official_0" }), null);
  assert.equal(toCardRef({ officialId: 0, customId: 0 }), null);
});

test("negative returns null", () => {
  assert.equal(toCardRef({ source: "official", id: -5 }), null);
  assert.equal(toCardRef({ id: "user_-5" }), null);
});

test("empty returns null", () => {
  assert.equal(toCardRef({ source: "official", id: "" }), null);
  assert.equal(toCardRef({}), null);
  assert.equal(toCardRef(null), null);
});

test("missing source cannot resolve a bare id", () => {
  assert.equal(toCardRef({ id: 5 }), null);
  assert.equal(toCardRef({ id: "5" }), null);
});
