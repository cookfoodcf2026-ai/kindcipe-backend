import assert from "node:assert/strict";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import {
  applyMealPlanDateUpdate,
  type MealPlanDateInput,
  type UpdateDateTx,
} from "../../lib/mealPlanIdentity";

interface PlanRow {
  id: number;
  familyId: number;
  date: string;
  recipeName: string;
}

interface ItemRow {
  id: number;
  familyId: number;
  name: string;
  fromMealPlanId: number | null;
  fromRecipeName: string | null;
  plannedDate: string | null;
}

class MemoryDateStore {
  plans: PlanRow[];
  items: ItemRow[];
  failShoppingUpdate = false;
  shoppingUpdateCalls = 0;

  constructor(plans: PlanRow[], items: ItemRow[]) {
    this.plans = plans;
    this.items = items;
  }

  private tx(): UpdateDateTx {
    return {
      updatePlanDate: async (familyId, planId, newDate) => {
        const plan = this.plans.find((row) => row.id === planId && row.familyId === familyId);
        if (plan) plan.date = newDate;
      },
      updateShoppingDateByPlanId: async (familyId, planId, plannedDate) => {
        this.shoppingUpdateCalls += 1;
        if (this.failShoppingUpdate) throw new Error("shopping update failed");
        for (const item of this.items) {
          if (item.familyId === familyId && item.fromMealPlanId === planId) {
            item.plannedDate = plannedDate;
          }
        }
      },
    };
  }

  async run(input: MealPlanDateInput): Promise<void> {
    const plansBefore = this.plans.map((row) => ({ ...row }));
    const itemsBefore = this.items.map((row) => ({ ...row }));
    try {
      await applyMealPlanDateUpdate(this.tx(), input);
    } catch (error) {
      this.plans = plansBefore;
      this.items = itemsBefore;
      throw error;
    }
  }
}

function baseInput(overrides: Partial<MealPlanDateInput> = {}): MealPlanDateInput {
  return {
    familyId: 1,
    planId: 1,
    newDate: "2026-02-01",
    moveShoppingItems: true,
    shoppingDate: null,
    ...overrides,
  };
}

test("update_date_transaction_rollback rolls back the plan when shopping update fails", async () => {
  const store = new MemoryDateStore(
    [{ id: 1, familyId: 1, date: "2026-01-01", recipeName: "番茄炒蛋" }],
    [
      {
        id: 1,
        familyId: 1,
        name: "番茄",
        fromMealPlanId: 1,
        fromRecipeName: "番茄炒蛋",
        plannedDate: "2026-01-01",
      },
    ],
  );
  store.failShoppingUpdate = true;

  await assert.rejects(() => store.run(baseInput()), /shopping update failed/);

  assert.equal(store.plans[0].date, "2026-01-01", "plan date rolled back");
  assert.equal(store.items[0].plannedDate, "2026-01-01", "shopping date rolled back");
});

test("update_date_matches_by_plan_id ignores same-name rows and legacy name/date matches", async () => {
  const store = new MemoryDateStore(
    [
      { id: 1, familyId: 1, date: "2026-01-01", recipeName: "番茄炒蛋" },
      { id: 2, familyId: 1, date: "2026-01-01", recipeName: "番茄炒蛋" },
    ],
    [
      { id: 1, familyId: 1, name: "A", fromMealPlanId: 1, fromRecipeName: "番茄炒蛋", plannedDate: "2026-01-01" },
      { id: 2, familyId: 1, name: "B", fromMealPlanId: 2, fromRecipeName: "番茄炒蛋", plannedDate: "2026-01-01" },
      { id: 3, familyId: 1, name: "C", fromMealPlanId: null, fromRecipeName: "番茄炒蛋", plannedDate: "2026-01-01" },
    ],
  );

  await store.run(baseInput({ planId: 1, newDate: "2026-02-01" }));

  assert.equal(store.items[0].plannedDate, "2026-02-01");
  assert.equal(store.items[1].plannedDate, "2026-01-01", "other plan not touched");
  assert.equal(store.items[2].plannedDate, "2026-01-01", "orphan name/date row not touched");
  assert.equal(store.shoppingUpdateCalls, 1);
});

test("update_date_invalid_buy_date_rollback changes neither plan nor items", async () => {
  const store = new MemoryDateStore(
    [{ id: 1, familyId: 1, date: "2026-01-01", recipeName: "番茄炒蛋" }],
    [
      {
        id: 1,
        familyId: 1,
        name: "番茄",
        fromMealPlanId: 1,
        fromRecipeName: "番茄炒蛋",
        plannedDate: "2026-01-01",
      },
    ],
  );

  await assert.rejects(
    () => store.run(baseInput({ newDate: "2026-02-01", shoppingDate: "2026-03-01" })),
    (error: unknown) => {
      assert.ok(error instanceof TRPCError);
      assert.equal(error.code, "BAD_REQUEST");
      return true;
    },
  );

  assert.equal(store.plans[0].date, "2026-01-01");
  assert.equal(store.items[0].plannedDate, "2026-01-01");
  assert.equal(store.shoppingUpdateCalls, 0, "validation happens before any write");
});

test("update_date_family_scope never touches another family or null-plan orphans", async () => {
  const store = new MemoryDateStore(
    [{ id: 1, familyId: 1, date: "2026-01-01", recipeName: "番茄炒蛋" }],
    [
      { id: 1, familyId: 1, name: "same family", fromMealPlanId: 1, fromRecipeName: null, plannedDate: "2026-01-01" },
      { id: 2, familyId: 2, name: "other family", fromMealPlanId: 1, fromRecipeName: null, plannedDate: "2026-01-01" },
      { id: 3, familyId: 1, name: "orphan", fromMealPlanId: null, fromRecipeName: null, plannedDate: "2026-01-01" },
    ],
  );

  await store.run(baseInput({ familyId: 1, planId: 1, newDate: "2026-02-01" }));

  assert.equal(store.items[0].plannedDate, "2026-02-01");
  assert.equal(store.items[1].plannedDate, "2026-01-01", "other family untouched");
  assert.equal(store.items[2].plannedDate, "2026-01-01", "null-plan orphan untouched");
});
