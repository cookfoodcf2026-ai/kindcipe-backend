import assert from "node:assert/strict";
import test from "node:test";
import {
  applyParseGrounding,
  clearParseTokensForTest,
  consumeParseToken,
  issueParseToken,
  PARSE_TOKEN_TTL_MS,
  resolveImportIngredients,
} from "./importParseTokenStore";
import {
  AI_FILLED_TAG,
  isTextGroundingWarningEnabled,
} from "./importWarning";

const source329 = [
  "泰式炒河粉捲",
  "材料：河粉200克、蝦仁150克、雞蛋2隻、豆芽100克、韭菜50克、花生碎30克。",
  "做法：炒香蝦仁同雞蛋，加入河粉、豆芽、韭菜同花生碎拌勻。",
].join("\n");

const ingredients329 = [
  { name: "河粉" },
  { name: "蝦仁" },
  { name: "雞蛋" },
  { name: "豆芽" },
  { name: "韭菜" },
  { name: "花生" },
  { name: "羅望子醬" },
  { name: "魚露" },
  { name: "椰糖" },
  { name: "蒜蓉" },
  { name: "食用油" },
  { name: "辣椒" },
];

test.beforeEach(() => clearParseTokensForTest());

test("parseUrl warning returns importWarning and parseToken", () => {
  const applied = applyParseGrounding(ingredients329, source329, "泰式炒河粉捲");
  assert.equal(applied.ingredients.length, 6);
  assert.equal(applied.importWarning?.inferredCount, 6);
  assert.equal(typeof applied.parseToken, "string");
  assert.equal(applied.parseToken?.length, 36);

  const entry = consumeParseToken(applied.parseToken!);
  assert.ok(entry);
  assert.equal(entry.inferred.length, 6);
  assert.equal(entry.grounded.length, 6);
});

test("importUser ack with valid token merges inferred ingredients", () => {
  const applied = applyParseGrounding(ingredients329, source329, "泰式炒河粉捲");
  const resolved = resolveImportIngredients(applied.ingredients, {
    ackWarning: true,
    parseToken: applied.parseToken,
    inferredIngredients: applied.importWarning?.inferredIngredients,
  });

  assert.equal(resolved.tokenStatus, "ok");
  assert.equal(resolved.inferredAdded, 6);
  assert.equal(resolved.ingredients.length, 12);
  assert.equal(resolved.addAiTag, true);
  assert.equal(AI_FILLED_TAG, "ai_filled");
  const inferred = resolved.ingredients.filter((item) => item.grounded === false);
  const grounded = resolved.ingredients.filter((item) => item.grounded === true);
  assert.equal(inferred.length, 6);
  assert.equal(grounded.length, 6);
});

test("expired token safely falls back to grounded only", () => {
  const token = issueParseToken(ingredients329.slice(0, 6), ingredients329.slice(6), 0);
  const resolved = resolveImportIngredients(ingredients329.slice(0, 6), {
    ackWarning: true,
    parseToken: token,
    inferredIngredients: ingredients329.slice(6),
    now: PARSE_TOKEN_TTL_MS + 1,
  });

  assert.equal(resolved.tokenStatus, "miss");
  assert.equal(resolved.inferredAdded, 0);
  assert.equal(resolved.ingredients.length, 6);
  assert.equal(resolved.ingredients.every((item) => item.grounded === undefined), true);
});

test("ack=false ignores token and inferred ingredients", () => {
  const token = issueParseToken(ingredients329.slice(0, 6), ingredients329.slice(6));
  const resolved = resolveImportIngredients(ingredients329.slice(0, 6), {
    ackWarning: false,
    parseToken: token,
    inferredIngredients: ingredients329.slice(6),
  });

  assert.equal(resolved.tokenStatus, "ignored");
  assert.equal(resolved.ingredients.length, 6);
  assert.equal(resolved.inferredAdded, 0);
  assert.ok(consumeParseToken(token));
});

test("parseText flag OFF preserves baseline ingredients", () => {
  const applied = applyParseGrounding(ingredients329, source329, "泰式炒河粉捲", {
    enabled: false,
  });
  assert.deepEqual(applied.ingredients, ingredients329);
  assert.equal(applied.importWarning, undefined);
  assert.equal(applied.parseToken, undefined);
});

test("text grounding flag defaults OFF and reads env", () => {
  const original = process.env.IMPORT_TEXT_GROUNDING_WARNING;
  try {
    delete process.env.IMPORT_TEXT_GROUNDING_WARNING;
    assert.equal(isTextGroundingWarningEnabled(), false);
    process.env.IMPORT_TEXT_GROUNDING_WARNING = "1";
    assert.equal(isTextGroundingWarningEnabled(), true);
  } finally {
    if (original === undefined) delete process.env.IMPORT_TEXT_GROUNDING_WARNING;
    else process.env.IMPORT_TEXT_GROUNDING_WARNING = original;
  }
});

test("merge dedupes normalized names and never adds quantities", () => {
  const grounded = [{ name: "豆腐", quantity: "1", unit: "盒" }];
  const inferred = [{ name: "豆腐", quantity: "2", unit: "盒" }];
  const token = issueParseToken(grounded, inferred);
  const resolved = resolveImportIngredients(grounded, {
    ackWarning: true,
    parseToken: token,
    inferredIngredients: inferred,
  });

  assert.equal(resolved.tokenStatus, "ok");
  assert.equal(resolved.ingredients.length, 1);
  assert.equal(resolved.ingredients[0].quantity, "1");
  assert.equal(resolved.ingredients[0].grounded, true);
  assert.equal(resolved.conflicts, 1);
  assert.equal(resolved.inferredAdded, 0);
  assert.equal(resolved.addAiTag, false);
});

test("parse token is one time use", () => {
  const token = issueParseToken([{ name: "豆腐" }], [{ name: "雞胸肉" }]);
  assert.ok(consumeParseToken(token));
  assert.equal(consumeParseToken(token), null);
});

test("mismatched inferred payload falls back to grounded only", () => {
  const grounded = [{ name: "豆腐" }];
  const inferred = [{ name: "雞胸肉" }];
  const token = issueParseToken(grounded, inferred);
  const resolved = resolveImportIngredients(grounded, {
    ackWarning: true,
    parseToken: token,
    inferredIngredients: [{ name: "辣椒" }],
  });

  assert.equal(resolved.tokenStatus, "mismatch");
  assert.equal(resolved.ingredients.length, 1);
  assert.equal(resolved.addAiTag, false);
});
