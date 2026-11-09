import assert from "node:assert/strict";
import test from "node:test";
import { formatRecipeRef, isRecipeRef, parseRecipeRef } from "../../lib/recipeRef";

test("recipeRef_parse_contract returns ref for canonical refs and never throws", () => {
  assert.deepEqual(parseRecipeRef("official_123"), { type: "official", id: 123 });
  assert.deepEqual(parseRecipeRef("user_7"), { type: "user", id: 7 });
  assert.equal(formatRecipeRef({ type: "official", id: 123 }), "official_123");
  assert.equal(isRecipeRef("user_7"), true);

  for (const weird of [undefined, null, 0, {}, [], Symbol("x"), () => 1]) {
    assert.doesNotThrow(() => parseRecipeRef(weird));
    assert.equal(parseRecipeRef(weird), null);
  }
});

test("recipeRef_accept_table accepts only canonical ASCII refs", () => {
  const accepted: Array<[string, { type: "official" | "user"; id: number }]> = [
    ["official_1", { type: "official", id: 1 }],
    ["official_9007199254740991", { type: "official", id: Number.MAX_SAFE_INTEGER }],
    ["user_10", { type: "user", id: 10 }],
    ["user_9007199254740991", { type: "user", id: Number.MAX_SAFE_INTEGER }],
  ];
  for (const [raw, expected] of accepted) {
    assert.deepEqual(parseRecipeRef(raw), expected, raw);
  }
  assert.equal(parseRecipeRef("official_9007199254740992"), null, "id > MAX_SAFE_INTEGER");
});

test("recipeRef_reject_table rejects empty, bare, colon, custom, leading zero and whitespace", () => {
  const rejected = [
    "",
    null,
    undefined,
    "123",
    "official:",
    "user:",
    "custom_1",
    "official_0",
    "official_01",
    "official_1x",
    "user_",
    "OFFICIAL_1",
    "User_1",
    " official_1",
    "official_1 ",
    "official_1 ",
    "official_-1",
    "official_1.0",
    "official_１２３",
  ];
  for (const raw of rejected) {
    assert.equal(parseRecipeRef(raw), null, String(raw));
  }
});

test("recipeRef_legacy_mode normalises colon refs only when not strict", () => {
  const legacyRaw: string[] = [];
  const ref = parseRecipeRef("official:123", {
    onLegacy: ({ raw }) => legacyRaw.push(String(raw)),
  });
  assert.deepEqual(ref, { type: "official", id: 123 });
  assert.deepEqual(legacyRaw, ["official:123"]);

  const userLegacy = parseRecipeRef("user:45", { onLegacy: () => {} });
  assert.deepEqual(userLegacy, { type: "user", id: 45 });

  let strictLegacy = 0;
  assert.equal(
    parseRecipeRef("official:123", { strict: true, onLegacy: () => strictLegacy++ }),
    null,
  );
  assert.equal(strictLegacy, 0);
  assert.equal(parseRecipeRef("official:0", { onLegacy: () => {} }), null);
  assert.equal(parseRecipeRef("official:01", { onLegacy: () => {} }), null);
});

test("recipeRef_no_bare_number_fallback does not treat 123 as user_123", () => {
  assert.equal(parseRecipeRef("123"), null);
  assert.equal(parseRecipeRef("0"), null);
  assert.equal(isRecipeRef("123"), false);
});
