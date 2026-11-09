import assert from "node:assert/strict";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import {
  persistShoppingItemWithRetry,
  planShoppingBatch,
  resolveShoppingAddLink,
  type MealPlanLookupRow,
  type ShoppingIdentityDeps,
} from "../../lib/shoppingIdentity";

interface LogEntry {
  event: string;
  data?: Record<string, unknown>;
}

function makeDeps(options: {
  rows?: Map<number, MealPlanLookupRow>;
  calls?: number[][];
} = {}): { deps: ShoppingIdentityDeps; logs: LogEntry[]; metrics: string[]; calls: number[][] } {
  const logs: LogEntry[] = [];
  const metrics: string[] = [];
  const calls: number[][] = options.calls ?? [];
  const rows = options.rows ?? new Map<number, MealPlanLookupRow>();
  return {
    logs,
    metrics,
    calls,
    deps: {
      async getMealPlanRows(_familyId, planIds) {
        calls.push([...planIds]);
        const found = new Map<number, MealPlanLookupRow>();
        for (const id of planIds) {
          const row = rows.get(id);
          if (row) found.set(id, row);
        }
        return found;
      },
      log(event, data) {
        logs.push({ event, data });
      },
      metric(name) {
        metrics.push(name);
      },
    },
  };
}

test("shopping_add_reverse_lookup_hit writes the canonical plan recipe id", async () => {
  const rows = new Map<number, MealPlanLookupRow>([
    [10, { recipeId: "official_42", date: "2026-02-01" }],
  ]);
  const { deps, calls } = makeDeps({ rows });

  const result = await resolveShoppingAddLink(
    { familyId: 1, fromMealPlanId: 10, fromRecipeId: null },
    deps,
  );

  assert.deepEqual(result, {
    fromRecipeId: "official_42",
    fromMealPlanId: 10,
    canonical: true,
    reason: "plan_hit",
  });
  assert.equal(calls.length, 1, "single family-scoped lookup");
  assert.deepEqual(calls[0], [10]);
});

test("shopping_add_invalid_plan_ref_without_canonical_client_ref_is_rejected", async () => {
  const rows = new Map<number, MealPlanLookupRow>([
    [10, { recipeId: "official:", date: "2026-02-01" }],
    [11, { recipeId: "42", date: "2026-02-01" }],
  ]);
  const { deps, logs, metrics } = makeDeps({ rows });

  for (const fromMealPlanId of [10, 11]) {
    await assert.rejects(
      () => resolveShoppingAddLink(
        { familyId: 1, fromMealPlanId, fromRecipeId: null },
        deps,
      ),
      (error: unknown) => {
        assert.ok(error instanceof TRPCError);
        assert.equal(error.code, "BAD_REQUEST");
        assert.match(error.message, /invalid_recipe_ref/);
        return true;
      },
    );
  }
  assert.ok(logs.some((entry) => entry.event === "shopping_invalid_ref"));
  assert.ok(metrics.includes("shopping_invalid_ref"));
});

test("shopping_add_invalid_plan_ref_falls_back_to_canonical_client_ref", async () => {
  const rows = new Map<number, MealPlanLookupRow>([
    [10, { recipeId: "official:42", date: "2026-02-01" }],
  ]);
  const { deps } = makeDeps({ rows });

  const result = await resolveShoppingAddLink(
    { familyId: 1, fromMealPlanId: 10, fromRecipeId: "user_7" },
    deps,
  );

  assert.deepEqual(result, {
    fromRecipeId: "user_7",
    fromMealPlanId: 10,
    canonical: true,
    reason: "invalid_plan_ref",
  });
});

test("shopping_add_manual_item_with_null_ref_is_accepted", async () => {
  const { deps } = makeDeps();

  const result = await resolveShoppingAddLink(
    { familyId: 1, fromMealPlanId: null, fromRecipeId: null },
    deps,
  );

  assert.deepEqual(result, {
    fromRecipeId: null,
    fromMealPlanId: null,
    canonical: false,
    reason: "none",
  });
});

test("shopping_add_manual_item_with_bare_ref_is_rejected", async () => {
  const { deps } = makeDeps();

  await assert.rejects(
    () => resolveShoppingAddLink(
      { familyId: 1, fromMealPlanId: null, fromRecipeId: "123" },
      deps,
    ),
    (error: unknown) => {
      assert.ok(error instanceof TRPCError);
      assert.equal(error.code, "BAD_REQUEST");
      assert.match(error.message, /invalid_recipe_ref/);
      return true;
    },
  );
});

test("shopping_add_plan_join_is_authoritative_over_client_ref", async () => {
  const rows = new Map<number, MealPlanLookupRow>([
    [10, { recipeId: "official_42", date: "2026-02-01" }],
  ]);
  const { deps } = makeDeps({ rows });

  const result = await resolveShoppingAddLink(
    { familyId: 1, fromMealPlanId: 10, fromRecipeId: "user_9" },
    deps,
  );

  assert.equal(result.fromRecipeId, "official_42", "canonical plan ref wins");
  assert.equal(result.reason, "ref_conflict");
});

test("shopping_add_lookup_miss_preserves_input and never throws", async () => {
  const { deps, logs, metrics } = makeDeps();

  const result = await resolveShoppingAddLink(
    { familyId: 1, fromMealPlanId: 999, fromRecipeId: "user_7" },
    deps,
  );

  assert.deepEqual(result, {
    fromRecipeId: "user_7",
    fromMealPlanId: 999,
    canonical: true,
    reason: "lookup_miss",
  });
  assert.ok(logs.some((entry) => entry.event === "shopping_meal_plan_miss"));
  assert.ok(metrics.includes("shopping_meal_plan_miss"));
});

test("shopping_add_ref_conflict_prefers_plan", async () => {
  const rows = new Map<number, MealPlanLookupRow>([
    [10, { recipeId: "official_42", date: "2026-02-01" }],
  ]);
  const { deps, logs, metrics } = makeDeps({ rows });

  const result = await resolveShoppingAddLink(
    { familyId: 1, fromMealPlanId: 10, fromRecipeId: "user_9" },
    deps,
  );

  assert.equal(result.fromRecipeId, "official_42");
  assert.equal(result.fromMealPlanId, 10);
  assert.ok(logs.some((entry) => entry.event === "ref_conflict"));
  assert.ok(metrics.includes("ref_conflict"));
});

test("shopping_add_batch_query_count uses one IN lookup for 18 plans", async () => {
  const rows = new Map<number, MealPlanLookupRow>();
  for (let id = 1; id <= 18; id++) rows.set(id, { recipeId: `official_${id}`, date: "2026-02-01" });
  const { deps, calls } = makeDeps({ rows });

  const result = await planShoppingBatch(
    {
      familyId: 1,
      items: [...rows.keys()].map((id) => ({
        name: `食材 ${id}`,
        fromMealPlanId: id,
      })),
      existing: [],
    },
    deps,
  );

  assert.equal(result.inserts.length, 18);
  assert.equal(calls.length, 1, "one IN lookup for the whole batch");
  assert.deepEqual([...calls[0]].sort((a, b) => a - b), [...rows.keys()].sort((a, b) => a - b));
});

test("shopping_add_retry_keeps_links retries with the full payload", async () => {
  const payload = {
    familyId: 1,
    name: "番茄",
    status: "active" as const,
    fromRecipeId: "official_42",
    fromMealPlanId: 10,
  };
  const attempts: Array<typeof payload> = [];
  await persistShoppingItemWithRetry(payload, async (row) => {
    attempts.push({ ...row });
    if (attempts.length === 1) throw new Error("constraint");
  });

  assert.equal(attempts.length, 2);
  assert.equal(attempts[1].fromRecipeId, "official_42");
  assert.equal(attempts[1].fromMealPlanId, 10);
});

test("shopping_add_retry_exhausted_errors throws SHOPPING_LINK_PERSIST_FAILED with ids", async () => {
  const payload = { familyId: 1, name: "番茄", fromRecipeId: "official_42", fromMealPlanId: 10 };
  let attempts = 0;

  await assert.rejects(
    () =>
      persistShoppingItemWithRetry(payload, async () => {
        attempts += 1;
        throw new Error("db down");
      }),
    (error: unknown) => {
      assert.ok(error instanceof TRPCError);
      assert.equal(error.code, "INTERNAL_SERVER_ERROR");
      assert.match(error.message, /SHOPPING_LINK_PERSIST_FAILED/);
      assert.match(error.message, /fromRecipeId=official_42/);
      assert.match(error.message, /fromMealPlanId=10/);
      return true;
    },
  );
  assert.equal(attempts, 2);
});

test("shopping_add_retry_params captures the retry payload with links", async () => {
  const payload = {
    familyId: 1,
    name: "洋蔥",
    status: "pending" as const,
    fromRecipeId: null,
    fromMealPlanId: 33,
  };
  const captured: Array<typeof payload> = [];
  await persistShoppingItemWithRetry(payload, async (row) => {
    captured.push({ ...row });
    if (captured.length === 1) throw new Error("transient");
  });

  assert.deepEqual(captured, [payload, payload]);
});
