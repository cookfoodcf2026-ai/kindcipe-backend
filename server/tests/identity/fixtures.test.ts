import assert from "node:assert/strict";
import test from "node:test";
import {
  DATES,
  FAMILY_A,
  FAMILY_B,
  LEGACY_INVALID_COUNT,
  LEGACY_ROWS,
  ORPHAN_COUNT,
  ORPHANS,
  expectedNormalized,
  mealPlans,
  shoppingItems,
} from "./fixtures";

test("identity_fixture_shape matches 95 orphans, 10 legacy rows, 2 families and mixed dates", () => {
  assert.equal(ORPHAN_COUNT, 95);
  assert.equal(ORPHANS.length, 95, "exactly 95 from_meal_plan_id != null && from_recipe_id == null");
  assert.equal(LEGACY_INVALID_COUNT, 10);
  assert.equal(LEGACY_ROWS.length, 10, "exactly 10 legacy/invalid from_recipe_id rows");
  assert.equal(shoppingItems.length, 105);

  const families = new Set(shoppingItems.map((item) => item.familyId));
  assert.deepEqual([...families].sort(), [FAMILY_A, FAMILY_B]);

  const dates = new Set(ORPHANS.map((item) => item.plannedDate));
  assert.ok(dates.size >= 2, "mixed dates");
  assert.deepEqual([...DATES], ["2026-03-01", "2026-03-02"]);

  const tomato = mealPlans.filter((plan) => plan.recipeName === "番茄炒蛋");
  assert.equal(tomato.length, 2, "same-name recipes present");
  assert.notEqual(tomato[0].recipeId, tomato[1].recipeId);
  assert.notEqual(tomato[0].date, tomato[1].date);

  assert.equal(expectedNormalized.total, 105);
  assert.equal(expectedNormalized.valid, 72);
  assert.equal(expectedNormalized.nullish, 33);
});
