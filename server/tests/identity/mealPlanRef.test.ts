import assert from "node:assert/strict";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import {
  mealPlanRefWriteValue,
  resolveMealPlanRefOrThrow,
  validateMealPlanRef,
  validateMealPlanRefBatch,
} from "../../lib/mealPlanIdentity";

function assertBadRequest(fn: () => unknown): TRPCError {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof TRPCError, "expected a TRPCError");
  assert.equal(caught.code, "BAD_REQUEST");
  assert.match(caught.message, /invalid_recipe_ref/);
  return caught;
}

test("meal_plan_add_accepts_canonical_and_returns_canonical_value", () => {
  const validation = resolveMealPlanRefOrThrow("official_42");
  assert.deepEqual(validation, {
    kind: "canonical",
    value: "official_42",
    ref: { type: "official", id: 42 },
  });
  assert.equal(mealPlanRefWriteValue(validation), "official_42");
});

test("meal_plan_add_rejects_colon_ref", () => {
  const error = assertBadRequest(() => resolveMealPlanRefOrThrow("official:7"));
  assert.match(error.message, /colon_ref/);
});

test("meal_plan_add_rejects_bare_ref", () => {
  const error = assertBadRequest(() => resolveMealPlanRefOrThrow("123"));
  assert.match(error.message, /bare_number/);
});

test("meal_plan_add_rejects_invalid_refs_with_a_BAD_REQUEST_reason", () => {
  for (const raw of ["custom_9", "123", "OFFICIAL_1", "official:7", "official_01", "official_1x"]) {
    assertBadRequest(() => resolveMealPlanRefOrThrow(raw));
  }
});

test("meal_plan_add_batch_atomic rejects the whole batch before writing", () => {
  const items = ["official_1", "custom_2", "user_3"];
  const batch = validateMealPlanRefBatch(items);
  assert.equal(batch.ok, false);
  assert.deepEqual(batch.writes, [], "no writes when any item is invalid");
  assert.deepEqual(batch.errors, [{ index: 1, reason: "invalid_format" }]);

  const allValid = validateMealPlanRefBatch(["official_1", "user_2", "official:3"]);
  assert.equal(allValid.ok, false, "legacy colon is invalid in strict mode");
  assert.deepEqual(allValid.writes, [], "no writes when any item is invalid");
  assert.deepEqual(allValid.errors, [{ index: 2, reason: "colon_ref" }]);
});

test("meal_plan_ref_validation_matrix covers null, empty, too long, bare, colon and uppercase", () => {
  const matrix: Array<[unknown, string]> = [
    [null, "not_string"],
    [undefined, "not_string"],
    ["", "empty"],
    ["official_" + "1".repeat(60), "too_long"],
    ["123", "bare_number"],
    ["official:7", "colon_ref"],
    ["user:7", "colon_ref"],
    ["OFFICIAL_7", "uppercase"],
    ["official_0", "leading_zero"],
    ["official_01", "leading_zero"],
    ["  official_7  ", "whitespace"],
  ];

  for (const [raw, reason] of matrix) {
    const result = validateMealPlanRef(raw);
    assert.equal(result.kind, "invalid", String(raw));
    assert.equal(result.reason, reason, String(raw));
  }
});

test("meal_plan_ref_write_value_never_returns_non_canonical", () => {
  for (const raw of ["custom_9", "123", "official:7"]) {
    assertBadRequest(() => mealPlanRefWriteValue(validateMealPlanRef(raw)));
  }
});
