import assert from "node:assert/strict";
import test from "node:test";
import {
  KILL_SWITCH_TRIGGERS,
  RECIPE_REF_STRICT_ENV,
  getRecipeRefStrict,
  parseBoolFlag,
  readRecipeRefStrict,
  resetRecipeRefFlagsForTests,
  setRecipeRefStrictOverride,
} from "../../config/flags";
import { createShoppingNormalizer } from "../../lib/shoppingNormalizer";

test("flag_recipe_ref_strict_default_on only treats explicit falsey values as off", () => {
  assert.equal(readRecipeRefStrict({}), true, "unset defaults to ON");
  assert.equal(readRecipeRefStrict({ [RECIPE_REF_STRICT_ENV]: "" }), true, "empty defaults to ON");
  assert.equal(readRecipeRefStrict({ [RECIPE_REF_STRICT_ENV]: "true" }), true);
  assert.equal(readRecipeRefStrict({ [RECIPE_REF_STRICT_ENV]: "1" }), true);
  assert.equal(readRecipeRefStrict({ [RECIPE_REF_STRICT_ENV]: "TRUE" }), false);
  assert.equal(readRecipeRefStrict({ [RECIPE_REF_STRICT_ENV]: "yes" }), false);
  assert.equal(readRecipeRefStrict({ [RECIPE_REF_STRICT_ENV]: "0" }), false);
  assert.equal(parseBoolFlag("1"), true);
  assert.equal(parseBoolFlag("true"), true);
  assert.equal(parseBoolFlag(undefined), false);
});

test("flag_kill_switch reacts to env changes and admin override immediately", () => {
  const original = process.env[RECIPE_REF_STRICT_ENV];
  resetRecipeRefFlagsForTests();
  try {
    delete process.env[RECIPE_REF_STRICT_ENV];
    assert.equal(getRecipeRefStrict(), true, "unset env is strict by default");

    process.env[RECIPE_REF_STRICT_ENV] = "false";
    assert.equal(getRecipeRefStrict(), false, "env kill switch is immediate");

    setRecipeRefStrictOverride(true);
    assert.equal(getRecipeRefStrict(), true, "admin override wins");

    setRecipeRefStrictOverride(null);
    assert.equal(getRecipeRefStrict(), false);

    assert.ok(KILL_SWITCH_TRIGGERS.length >= 3);
    assert.ok(KILL_SWITCH_TRIGGERS.some((trigger) => /canonical_rate/i.test(trigger)));
    assert.ok(KILL_SWITCH_TRIGGERS.some((trigger) => /orphan/i.test(trigger)));
  } finally {
    if (original === undefined) delete process.env[RECIPE_REF_STRICT_ENV];
    else process.env[RECIPE_REF_STRICT_ENV] = original;
    resetRecipeRefFlagsForTests();
  }
});

test("flag_read_repair_runs_independently_of_the_strict_write_flag", async () => {
  const original = process.env[RECIPE_REF_STRICT_ENV];
  resetRecipeRefFlagsForTests();
  delete process.env[RECIPE_REF_STRICT_ENV];
  try {
    assert.equal(getRecipeRefStrict(), true);
    const normalizer = createShoppingNormalizer({
      lookup: {
        async getMealPlanRows() {
          return new Map([[10, { recipeId: "official:42", date: "2026-02-01" }]]);
        },
      },
    });

    const output = await normalizer.normalizeRows(1, [
      { id: 1, fromMealPlanId: 10, fromRecipeId: null },
      { id: 2, fromMealPlanId: null, fromRecipeId: "user:7" },
    ]);

    assert.deepEqual(
      output.map((row) => row.fromRecipeId),
      ["official_42", "user_7"],
      "read repair is independent of the strict write flag",
    );
  } finally {
    if (original === undefined) delete process.env[RECIPE_REF_STRICT_ENV];
    else process.env[RECIPE_REF_STRICT_ENV] = original;
    resetRecipeRefFlagsForTests();
  }
});
