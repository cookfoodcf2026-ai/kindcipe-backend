import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveRecipeTags, maybeDerivedTags, parseDerivedTags, serializeDerivedTags } from "./deriveRecipeTags";

test("deriveRecipeTags: egg + stirfry", () => {
  assert.deepEqual(deriveRecipeTags({ name: "番茄炒蛋" }), ["protein:egg", "method:stirfry"]);
});

test("deriveRecipeTags: steam method and difficulty/time tags", () => {
  const tags = deriveRecipeTags({
    name: "蒸水蛋",
    ingredients: [{ name: "雞蛋" }],
    difficulty: "easy",
    cookTime: 10,
  });
  assert.ok(tags.includes("protein:egg"));
  assert.ok(tags.includes("method:steam"));
  assert.ok(tags.includes("difficulty:easy"));
  assert.ok(tags.includes("time:quick"));
});

test("deriveRecipeTags: 魚香茄子 唔會變 seafood", () => {
  const tags = deriveRecipeTags({ name: "魚香茄子", ingredients: [{ name: "茄子" }] });
  assert.ok(!tags.includes("protein:seafood"));
  assert.ok(tags.includes("protein:veg"));
});

test("deriveRecipeTags: 牛油果 唔會變 beef", () => {
  const tags = deriveRecipeTags({ name: "牛油果多士", ingredients: [{ name: "牛油果" }] });
  assert.ok(!tags.includes("protein:beef"));
});

test("deriveRecipeTags: 蟹味菇 唔會變 seafood", () => {
  const tags = deriveRecipeTags({ name: "蟹味菇炒青菜", ingredients: [{ name: "蟹味菇" }, { name: "青菜" }] });
  assert.ok(!tags.includes("protein:seafood"));
  assert.ok(tags.includes("method:stirfry"));
});

test("deriveRecipeTags: 豬仔包 唔會變 pork，湯圓 唔會變湯", () => {
  assert.deepEqual(deriveRecipeTags({ name: "豬仔包" }), []);
  assert.deepEqual(deriveRecipeTags({ name: "湯圓" }), []);
});

test("deriveRecipeTags: 清蒸三文魚 = seafood + steam", () => {
  assert.deepEqual(deriveRecipeTags({ name: "清蒸三文魚" }), ["protein:seafood", "method:steam"]);
});

test("deriveRecipeTags: 認唔到回 []", () => {
  assert.deepEqual(deriveRecipeTags({ name: "哈利波特" }), []);
});

test("deriveRecipeTags: ingredients 可以係 JSON string", () => {
  const tags = deriveRecipeTags({ name: "紅燒豆腐", ingredients: JSON.stringify([{ name: "豆腐" }]) });
  assert.ok(tags.includes("protein:soy"));
  assert.ok(tags.includes("method:braise"));
});

test("serialize/parse derived tags round-trip", () => {
  const raw = serializeDerivedTags(["protein:egg", "method:steam"]);
  assert.equal(raw, '["protein:egg","method:steam"]');
  assert.deepEqual(parseDerivedTags(raw), ["protein:egg", "method:steam"]);
  assert.deepEqual(parseDerivedTags(""), []);
});

test("maybeDerivedTags: flag OFF 回 undefined，flag ON 回 JSON", () => {
  const previous = process.env.AI_CHEF_DERIVED_TAGS;
  try {
    delete process.env.AI_CHEF_DERIVED_TAGS;
    assert.equal(maybeDerivedTags({ name: "番茄炒蛋" }), undefined);

    process.env.AI_CHEF_DERIVED_TAGS = "1";
    assert.equal(maybeDerivedTags({ name: "番茄炒蛋" }), '["protein:egg","method:stirfry"]');
  } finally {
    if (previous === undefined) delete process.env.AI_CHEF_DERIVED_TAGS;
    else process.env.AI_CHEF_DERIVED_TAGS = previous;
  }
});
