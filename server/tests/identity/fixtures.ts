/**
 * Fixed P1 identity fixture.
 *
 * Shape (must stay stable so every P1 test can share it):
 * - 2 families
 * - 95 orphan shopping rows: 70 joinable plans, 15 plans with invalid recipe
 *   refs, 10 missing plans
 * - 10 legacy/invalid rows that carry a from_recipe_id but no plan join
 * - same-name recipes on different dates
 * - mixed dates
 *
 * NO database. Everything is plain in-memory data.
 */

export const FAMILY_A = 1;
export const FAMILY_B = 2;

export const ORPHAN_COUNT = 95;
export const LEGACY_INVALID_COUNT = 10;

/** 70 joinable + 15 invalid-plan + 10 missing-plan = 95 orphan rows. */
export const JOINABLE_PLAN_COUNT = 70;
export const INVALID_PLAN_REF_COUNT = 15;
export const MISSING_PLAN_COUNT = 10;

export const DATES = ["2026-03-01", "2026-03-02"] as const;

export interface FixtureMealPlan {
  id: number;
  familyId: number;
  date: string;
  recipeId: string;
  recipeName: string;
}

export interface FixtureShoppingItem {
  id: number;
  familyId: number;
  name: string;
  unit: string | null;
  quantity: string | null;
  plannedDate: string | null;
  fromMealPlanId: number | null;
  fromRecipeId: string | null;
  fromRecipeName: string | null;
  status: "active";
}

export const mealPlans: FixtureMealPlan[] = [];
export const shoppingItems: FixtureShoppingItem[] = [];

const validPlanIds: number[] = [];
const invalidPlanIds: number[] = [];
const missingPlanIds: number[] = [];

// 70 joinable plans (family A). Alternate official/user refs and dates.
for (let i = 0; i < JOINABLE_PLAN_COUNT; i++) {
  const id = 100 + i;
  const date = DATES[i % DATES.length];
  const recipeId = i % 2 === 0 ? `official_${1000 + i}` : `user_${2000 + i}`;
  const recipeName = i < 2 ? "番茄炒蛋" : `食譜 ${i}`; // same name, different refs/dates
  mealPlans.push({ id, familyId: FAMILY_A, date, recipeId, recipeName });
  validPlanIds.push(id);
}

// 15 plans with invalid recipe refs (family A).
const INVALID_PLAN_REFS = ["official_0", "42", "custom_abc"] as const;
for (let i = 0; i < INVALID_PLAN_REF_COUNT; i++) {
  const id = 200 + i;
  mealPlans.push({
    id,
    familyId: FAMILY_A,
    date: DATES[i % DATES.length],
    recipeId: INVALID_PLAN_REFS[i % INVALID_PLAN_REFS.length],
    recipeName: `壞 ref 食譜 ${i}`,
  });
  invalidPlanIds.push(id);
}

// 10 missing plan ids (never inserted). Owned by family B so the items below
// exercise the family-scoped lookup miss path too.
for (let i = 0; i < MISSING_PLAN_COUNT; i++) {
  missingPlanIds.push(900 + i);
}

let nextItemId = 1;
function pushItem(partial: Omit<FixtureShoppingItem, "id" | "status">): FixtureShoppingItem {
  const item: FixtureShoppingItem = { id: nextItemId++, status: "active", ...partial };
  shoppingItems.push(item);
  return item;
}

// 70 joinable orphan rows (from_recipe_id null, plan join present).
for (let i = 0; i < JOINABLE_PLAN_COUNT; i++) {
  pushItem({
    familyId: FAMILY_A,
    name: `食材 ${i}`,
    unit: i % 2 === 0 ? "克" : null,
    quantity: "1",
    plannedDate: DATES[i % DATES.length],
    fromMealPlanId: validPlanIds[i],
    fromRecipeId: null,
    fromRecipeName: null,
  });
}

// 15 orphan rows whose plan exists but its recipe ref is invalid.
for (let i = 0; i < INVALID_PLAN_REF_COUNT; i++) {
  pushItem({
    familyId: FAMILY_A,
    name: `壞 ref 食材 ${i}`,
    unit: "克",
    quantity: "1",
    plannedDate: DATES[i % DATES.length],
    fromMealPlanId: invalidPlanIds[i],
    fromRecipeId: null,
    fromRecipeName: null,
  });
}

// 10 orphan rows in family B that point at missing (or other-family) plans.
for (let i = 0; i < MISSING_PLAN_COUNT; i++) {
  pushItem({
    familyId: FAMILY_B,
    name: `無 plan 食材 ${i}`,
    unit: "個",
    quantity: "1",
    plannedDate: DATES[i % DATES.length],
    fromMealPlanId: missingPlanIds[i],
    fromRecipeId: null,
    fromRecipeName: null,
  });
}

// 10 legacy/invalid rows carrying from_recipe_id only.
const LEGACY_INVALID_REFS = [
  "official:123",
  "user:45",
  "official_0",
  "official_01",
  "OFFICIAL_5",
  "custom_9",
  "123",
  "official_1x",
  "",
  "  official_7  ",
] as const;

for (let i = 0; i < LEGACY_INVALID_REFS.length; i++) {
  pushItem({
    familyId: i % 2 === 0 ? FAMILY_A : FAMILY_B,
    name: `Legacy 食材 ${i}`,
    unit: null,
    quantity: "1",
    plannedDate: DATES[i % DATES.length],
    fromMealPlanId: null,
    fromRecipeId: LEGACY_INVALID_REFS[i],
    fromRecipeName: null,
  });
}

// 10 "legacy plan join" rows in family B: plan is valid but the ref is legacy.
// Kept out of the fixture body above so the orphan total stays exactly 95; the
// normalizer legacy-plan path is covered by its own unit test.

export const mealPlansById = new Map<number, FixtureMealPlan>(
  mealPlans.map((plan) => [plan.id, plan]),
);

/**
 * Fake `getMealPlanRows` used by every P1 test. Family-scoped exactly like the
 * real query: a plan id from another family is a miss.
 */
export async function lookupMealPlans(
  familyId: number,
  planIds: number[],
): Promise<Map<number, { recipeId: string | null; date: string | null }>> {
  const rows = new Map<number, { recipeId: string | null; date: string | null }>();
  for (const id of planIds) {
    const plan = mealPlansById.get(id);
    if (plan && plan.familyId === familyId) {
      rows.set(id, { recipeId: plan.recipeId, date: plan.date });
    }
  }
  return rows;
}

/**
 * Expected read-time repair result for the fixture:
 * - 70 joinable plans -> canonical
 * - 2 legacy from_recipe_id rows -> canonical
 * - 15 invalid plan refs + 10 missing plans + 8 invalid legacy refs -> null
 */
export const expectedNormalized = {
  valid: JOINABLE_PLAN_COUNT + 2,
  nullish: INVALID_PLAN_REF_COUNT + MISSING_PLAN_COUNT + 8,
  total: ORPHAN_COUNT + LEGACY_INVALID_COUNT,
  orphanMetric: INVALID_PLAN_REF_COUNT + MISSING_PLAN_COUNT + 8,
} as const;

export const ORPHANS = shoppingItems.filter((item) => item.fromMealPlanId !== null && item.fromRecipeId === null);
export const LEGACY_ROWS = shoppingItems.filter(
  (item) => item.fromMealPlanId === null && item.fromRecipeId !== null,
);
