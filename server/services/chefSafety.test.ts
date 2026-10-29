import assert from "node:assert/strict";
import test from "node:test";
import { detectSafetyIntent } from "./chefSafety";

test("seafood allergy and pregnancy fail closed", () => {
  assert.equal(detectSafetyIntent("我海鮮敏感，想食魚")?.kind, "allergy");
  assert.equal(detectSafetyIntent("我懷孕可唔可以食呢個？")?.kind, "pregnancy");
  assert.equal(detectSafetyIntent("咁有咩安全選擇？")?.kind, "allergy");
});

test("technique and non-food text do not trigger safety", () => {
  assert.equal(detectSafetyIntent("牛扒煎幾耐？"), null);
  assert.equal(detectSafetyIntent("你係機械人？"), null);
  assert.equal(detectSafetyIntent("多謝"), null);
});
