import assert from "node:assert/strict";
import test from "node:test";
import { FAQ_KEYS, lookupFaqAnswer } from "./chefFaq";

test("verified FAQ keys all return deterministic answers", () => {
  for (const key of FAQ_KEYS) {
    const answer = lookupFaqAnswer(key);
    assert.ok(answer && answer.length > 20, `missing answer for ${key}`);
  }
});

test("FAQ normalizes punctuation and spacing", () => {
  assert.match(lookupFaqAnswer("煎牛扒幾耐？") ?? "", /牛扒/);
  assert.match(lookupFaqAnswer("蒸 魚 幾 耐！") ?? "", /蒸魚|魚/);
});

test("FAQ miss does not invent an answer", () => {
  assert.equal(lookupFaqAnswer("幫我寫一封電郵"), null);
});
