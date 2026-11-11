import assert from "node:assert/strict";
import test from "node:test";
import {
  applyEatOutSet,
  EAT_OUT_DELETED_MEAL_TYPES,
  parsePlanSnapshot,
  type EatOutPlanRow,
  type EatOutSetDeps,
  type MealPlanSnapshotPlan,
  type StoredShoppingItem,
} from "../lib/eatOutSnapshot";

interface StoredPlanRow extends EatOutPlanRow {
  familyId: number;
  date: string;
}

interface StoredShoppingRow extends StoredShoppingItem {
  familyId: number;
}

function flagKey(familyId: number, date: string): string {
  return `${familyId}:${date}`;
}

class MemoryEatOutStore {
  plans: StoredPlanRow[] = [];
  shopping: StoredShoppingRow[] = [];
  flags = new Map<string, { planSnapshot: unknown }>();
  private nextPlanId = 1000;
  private nextShoppingId = 5000;

  deps: EatOutSetDeps = {
    insertFlag: async (familyId, date) => {
      const key = flagKey(familyId, date);
      if (!this.flags.has(key)) this.flags.set(key, { planSnapshot: null });
    },
    getFlag: async (familyId, date) => this.flags.get(flagKey(familyId, date)) ?? null,
    deleteFlag: async (familyId, date) => {
      this.flags.delete(flagKey(familyId, date));
    },
    saveSnapshot: async (familyId, date, snapshot) => {
      this.flags.set(flagKey(familyId, date), { planSnapshot: snapshot });
    },
    listMealPlans: async (familyId, date, mealTypes) =>
      this.plans.filter(
        (plan) =>
          plan.familyId === familyId &&
          plan.date === date &&
          mealTypes.includes(plan.mealType),
      ),
    deleteMealPlans: async (familyId, date, mealTypes) => {
      this.plans = this.plans.filter(
        (plan) =>
          !(
            plan.familyId === familyId &&
            plan.date === date &&
            mealTypes.includes(plan.mealType)
          ),
      );
    },
    listShoppingItemIdsForPlans: async (familyId, planIds) =>
      this.shopping
        .filter(
          (item) =>
            item.familyId === familyId &&
            item.fromMealPlanId != null &&
            planIds.includes(item.fromMealPlanId),
        )
        .map((item) => item.id),
    listDayMealTypes: async (familyId, date) =>
      this.plans
        .filter((plan) => plan.familyId === familyId && plan.date === date)
        .map((plan) => plan.mealType),
    insertMealPlans: async (familyId, date, plans) => {
      const ids: number[] = [];
      for (const plan of plans) {
        const id = this.nextPlanId++;
        ids.push(id);
        this.plans.push({
          ...plan,
          id,
          familyId,
          date,
          confirmedAt: plan.confirmedAt ?? null,
        });
      }
      return ids;
    },
    listShoppingItems: async (familyId, ids) =>
      this.shopping
        .filter((item) => item.familyId === familyId && ids.includes(item.id))
        .map((item) => ({ id: item.id, fromMealPlanId: item.fromMealPlanId })),
    relinkShoppingItems: async (familyId, itemIds, newPlanId) => {
      for (const item of this.shopping) {
        if (item.familyId === familyId && itemIds.includes(item.id)) {
          item.fromMealPlanId = newPlanId;
        }
      }
    },
  };

  addPlan(
    familyId: number,
    date: string,
    overrides: Partial<StoredPlanRow> = {},
  ): number {
    const id = this.nextPlanId++;
    this.plans.push({
      id,
      familyId,
      date,
      mealType: "dinner",
      recipeId: `official_${id}`,
      recipeName: `Recipe ${id}`,
      recipeNameEn: null,
      recipeNameFil: null,
      recipeNameId: null,
      recipeImage: null,
      status: "confirmed",
      proposedByUserId: "user_1",
      proposedByName: "Owner",
      confirmedByUserId: null,
      confirmedAt: null,
      note: null,
      ...overrides,
    });
    return id;
  }

  addShopping(familyId: number, fromMealPlanId: number | null): number {
    const id = this.nextShoppingId++;
    this.shopping.push({ id, familyId, fromMealPlanId });
    return id;
  }
}

const FAMILY = 7;
const DATE = "2026-03-14";

function snapshotPlan(overrides: {
  id: number;
  mealType: string;
  recipeId: string;
  recipeName?: string;
}): MealPlanSnapshotPlan {
  return {
    id: overrides.id,
    mealType: overrides.mealType,
    recipeId: overrides.recipeId,
    recipeName: overrides.recipeName ?? `Recipe ${overrides.id}`,
    recipeNameEn: null,
    recipeNameFil: null,
    recipeNameId: null,
    recipeImage: null,
    status: "confirmed",
    proposedByUserId: null,
    proposedByName: null,
    confirmedByUserId: null,
    confirmedAt: null,
    note: null,
  };
}

test("eatout_cancel_restores_plans_and_relinks_existing_shopping", async () => {
  const store = new MemoryEatOutStore();
  const planA = store.addPlan(FAMILY, DATE, { recipeId: "official_11", recipeName: "A" });
  const planB = store.addPlan(FAMILY, DATE, { recipeId: "official_12", recipeName: "B" });
  const itemA = store.addShopping(FAMILY, planA);
  const itemB = store.addShopping(FAMILY, planB);
  const itemA2 = store.addShopping(FAMILY, planA);
  const unlinked = store.addShopping(FAMILY, null);

  await applyEatOutSet(store.deps, { familyId: FAMILY, date: DATE, eatOut: true, userId: "u1" });

  assert.equal(store.plans.filter((plan) => plan.familyId === FAMILY && plan.date === DATE).length, 0);
  assert.equal(store.shopping.length, 4, "set must not delete shopping rows");
  const snapshot = parsePlanSnapshot(store.flags.get(flagKey(FAMILY, DATE))?.planSnapshot);
  assert.ok(snapshot, "snapshot stored");
  assert.deepEqual(snapshot.shoppingItemIds.sort(), [itemA, itemB, itemA2].sort());

  const result = await applyEatOutSet(store.deps, {
    familyId: FAMILY,
    date: DATE,
    eatOut: false,
    userId: "u1",
  });

  assert.deepEqual(result, { success: true, restored: true, reason: "ok", restoredPlans: 2 });
  const restored = store.plans.filter((plan) => plan.familyId === FAMILY && plan.date === DATE);
  assert.equal(restored.length, 2, "exactly the two dinner plans restored");
  assert.deepEqual(restored.map((plan) => plan.recipeId).sort(), ["official_11", "official_12"]);
  assert.equal(store.shopping.length, 4, "no new shopping rows during restore");
  assert.equal(store.flags.has(flagKey(FAMILY, DATE)), false, "flag cleared");

  const newIdFor = (recipeId: string) =>
    restored.find((plan) => plan.recipeId === recipeId)!.id;
  const shoppingById = new Map(store.shopping.map((item) => [item.id, item]));
  assert.equal(shoppingById.get(itemA)!.fromMealPlanId, newIdFor("official_11"));
  assert.equal(shoppingById.get(itemA2)!.fromMealPlanId, newIdFor("official_11"));
  assert.equal(shoppingById.get(itemB)!.fromMealPlanId, newIdFor("official_12"));
  assert.equal(shoppingById.get(unlinked)!.fromMealPlanId, null, "unlinked rows untouched");
});

test("eatout_cancel_restores_missing_meal_types_when_the_day_already_has_a_meal", async () => {
  const store = new MemoryEatOutStore();
  const oldPlan = store.addPlan(FAMILY, DATE, { recipeId: "official_21" });
  const oldItem = store.addShopping(FAMILY, oldPlan);

  await applyEatOutSet(store.deps, { familyId: FAMILY, date: DATE, eatOut: true, userId: "u1" });
  const newPlan = store.addPlan(FAMILY, DATE, { mealType: "lunch", recipeId: "official_99" });

  const result = await applyEatOutSet(store.deps, {
    familyId: FAMILY,
    date: DATE,
    eatOut: false,
    userId: "u1",
  });

  assert.deepEqual(result, { success: true, restored: true, reason: "ok", restoredPlans: 1 });
  const dayPlans = store.plans.filter((plan) => plan.familyId === FAMILY && plan.date === DATE);
  assert.equal(dayPlans.length, 2, "the lunch survives and dinner is restored");
  assert.ok(
    dayPlans.some((plan) => plan.id === newPlan && plan.mealType === "lunch"),
    "the user's new lunch is untouched",
  );
  const restoredDinner = dayPlans.find((plan) => plan.mealType === "dinner");
  assert.ok(restoredDinner, "the missing dinner is restored");
  assert.equal(restoredDinner.recipeId, "official_21");
  assert.equal(store.shopping.length, 1);
  assert.equal(store.shopping[0].id, oldItem);
  assert.equal(
    store.shopping[0].fromMealPlanId,
    restoredDinner.id,
    "shopping relinked to the restored dinner",
  );
  assert.equal(store.flags.has(flagKey(FAMILY, DATE)), false, "flag still cleared");
});

test("eatout_cancel_never_overwrites_an_existing_meal_type_but_restores_others", async () => {
  const store = new MemoryEatOutStore();
  const lunchPlan = store.addPlan(FAMILY, DATE, { mealType: "lunch", recipeId: "official_51" });
  const lunchItem = store.addShopping(FAMILY, lunchPlan);
  store.flags.set(flagKey(FAMILY, DATE), {
    planSnapshot: {
      version: 1,
      plans: [
        snapshotPlan({ id: 1, mealType: "lunch", recipeId: "official_51" }),
        snapshotPlan({ id: 2, mealType: "dinner", recipeId: "official_52" }),
      ],
      shoppingItemIds: [lunchItem, 7777],
    },
  });

  const result = await applyEatOutSet(store.deps, {
    familyId: FAMILY,
    date: DATE,
    eatOut: false,
    userId: "u1",
  });

  assert.deepEqual(result, { success: true, restored: true, reason: "ok", restoredPlans: 1 });
  const dayPlans = store.plans.filter((plan) => plan.familyId === FAMILY && plan.date === DATE);
  assert.equal(dayPlans.length, 2, "existing lunch kept, only dinner inserted");
  assert.equal(dayPlans.filter((plan) => plan.mealType === "lunch").length, 1);
  assert.equal(dayPlans.find((plan) => plan.mealType === "lunch")!.id, lunchPlan);
  const restoredDinner = dayPlans.find((plan) => plan.mealType === "dinner");
  assert.ok(restoredDinner);
  assert.equal(restoredDinner.recipeId, "official_52");
  const shoppingById = new Map(store.shopping.map((item) => [item.id, item]));
  assert.equal(
    shoppingById.get(lunchItem)!.fromMealPlanId,
    lunchPlan,
    "skipped meal type's shopping row is not relinked",
  );
});

test("eatout_cancel_restores_only_the_missing_type_from_a_multi_type_snapshot", async () => {
  const store = new MemoryEatOutStore();
  const breakfastPlan = store.addPlan(FAMILY, DATE, {
    mealType: "breakfast",
    recipeId: "official_61",
  });
  const breakfastItem = store.addShopping(FAMILY, breakfastPlan);
  store.flags.set(flagKey(FAMILY, DATE), {
    planSnapshot: {
      version: 1,
      plans: [
        snapshotPlan({ id: 11, mealType: "breakfast", recipeId: "official_61" }),
        snapshotPlan({ id: 12, mealType: "dinner", recipeId: "official_62" }),
      ],
      shoppingItemIds: [breakfastItem, 8888],
    },
  });

  const result = await applyEatOutSet(store.deps, {
    familyId: FAMILY,
    date: DATE,
    eatOut: false,
    userId: "u1",
  });

  assert.deepEqual(result, { success: true, restored: true, reason: "ok", restoredPlans: 1 });
  const dayPlans = store.plans.filter((plan) => plan.familyId === FAMILY && plan.date === DATE);
  assert.equal(dayPlans.length, 2, "breakfast kept + dinner inserted");
  assert.equal(dayPlans.filter((plan) => plan.mealType === "breakfast").length, 1);
  assert.equal(dayPlans.find((plan) => plan.mealType === "breakfast")!.id, breakfastPlan);
  assert.equal(dayPlans.find((plan) => plan.mealType === "dinner")!.recipeId, "official_62");
  assert.equal(
    store.shopping.find((item) => item.id === breakfastItem)!.fromMealPlanId,
    breakfastPlan,
    "existing breakfast shopping row untouched",
  );
});

test("eatout_cancel_dedupes_duplicate_snapshot_rows_into_one_insert", async () => {
  const store = new MemoryEatOutStore();
  const itemA = store.addShopping(FAMILY, 21);
  const itemB = store.addShopping(FAMILY, 22);
  store.flags.set(flagKey(FAMILY, DATE), {
    planSnapshot: {
      version: 1,
      plans: [
        snapshotPlan({ id: 21, mealType: "dinner", recipeId: "official_71" }),
        snapshotPlan({ id: 22, mealType: "dinner", recipeId: "official_71" }),
      ],
      shoppingItemIds: [itemA, itemB],
    },
  });

  const result = await applyEatOutSet(store.deps, {
    familyId: FAMILY,
    date: DATE,
    eatOut: false,
    userId: "u1",
  });

  assert.deepEqual(result, { success: true, restored: true, reason: "ok", restoredPlans: 1 });
  const dayPlans = store.plans.filter((plan) => plan.familyId === FAMILY && plan.date === DATE);
  assert.equal(dayPlans.length, 1, "duplicate alias row inserted once");
  const shoppingById = new Map(store.shopping.map((item) => [item.id, item]));
  assert.equal(shoppingById.get(itemA)!.fromMealPlanId, dayPlans[0].id);
  assert.equal(shoppingById.get(itemB)!.fromMealPlanId, dayPlans[0].id);
});

test("eatout_cancel_with_a_legacy_null_snapshot_only_clears_the_flag", async () => {
  const store = new MemoryEatOutStore();
  const keep = store.addPlan(FAMILY, DATE, { mealType: "lunch", recipeId: "official_31" });
  store.flags.set(flagKey(FAMILY, DATE), { planSnapshot: null });

  const result = await applyEatOutSet(store.deps, {
    familyId: FAMILY,
    date: DATE,
    eatOut: false,
    userId: "u1",
  });

  assert.deepEqual(result, { success: true, restored: false, reason: "no_snapshot" });
  assert.equal(store.flags.has(flagKey(FAMILY, DATE)), false);
  assert.deepEqual(store.plans.map((plan) => plan.id), [keep]);
});

test("eatout_set_again_keeps_the_first_snapshot_after_plans_are_gone", async () => {
  const store = new MemoryEatOutStore();
  const plan = store.addPlan(FAMILY, DATE, { recipeId: "official_41" });
  const item = store.addShopping(FAMILY, plan);

  await applyEatOutSet(store.deps, { familyId: FAMILY, date: DATE, eatOut: true, userId: "u1" });
  await applyEatOutSet(store.deps, { familyId: FAMILY, date: DATE, eatOut: true, userId: "u1" });

  const snapshot = parsePlanSnapshot(store.flags.get(flagKey(FAMILY, DATE))?.planSnapshot);
  assert.ok(snapshot);
  assert.equal(snapshot.plans.length, 1);
  assert.deepEqual(snapshot.shoppingItemIds, [item]);

  const result = await applyEatOutSet(store.deps, {
    familyId: FAMILY,
    date: DATE,
    eatOut: false,
    userId: "u1",
  });
  assert.equal(result.restored, true);
  assert.equal(store.plans.length, 1);
  assert.equal(store.shopping[0].fromMealPlanId, store.plans[0].id);
});

test("eatout_snapshot_only_covers_meal_types_the_set_actually_deletes", () => {
  assert.deepEqual(EAT_OUT_DELETED_MEAL_TYPES, ["dinner"]);
});
