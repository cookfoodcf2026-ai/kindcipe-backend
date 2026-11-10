import assert from "node:assert/strict";
import test from "node:test";
import {
  planShoppingBatch,
  type BatchShoppingItemInput,
  type ExistingShoppingItem,
  type MealPlanLookupRow,
  type ShoppingIdentityDeps,
} from "../../lib/shoppingIdentity";

function makeDeps(options: {
  rows?: Map<number, MealPlanLookupRow>;
  calls?: number[][];
} = {}): {
  deps: ShoppingIdentityDeps;
  logs: string[];
  metrics: string[];
  metricCalls: Array<{ name: string; tags?: Record<string, unknown> }>;
  calls: number[][];
} {
  const logs: string[] = [];
  const metrics: string[] = [];
  const metricCalls: Array<{ name: string; tags?: Record<string, unknown> }> = [];
  const calls: number[][] = options.calls ?? [];
  const rows = options.rows ?? new Map<number, MealPlanLookupRow>();
  return {
    logs,
    metrics,
    metricCalls,
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
      log(event) {
        logs.push(event);
      },
      metric(name, tags) {
        metrics.push(name);
        metricCalls.push({ name, tags });
      },
    },
  };
}

function existing(partial: Partial<ExistingShoppingItem> & { id: number; name: string }): ExistingShoppingItem {
  return {
    unit: null,
    quantity: "1",
    plannedDate: null,
    fromRecipeId: null,
    fromMealPlanId: null,
    ...partial,
  };
}

test("shopping_batch_reverse_lookup writes canonical refs in one IN lookup", async () => {
  const rows = new Map<number, MealPlanLookupRow>([
    [10, { recipeId: "official_42", date: "2026-02-01" }],
    [11, { recipeId: "user_7", date: "2026-02-02" }],
  ]);
  const { deps, calls } = makeDeps({ rows });
  const items: BatchShoppingItemInput[] = [
    { name: "番茄", fromMealPlanId: 10 },
    { name: "洋蔥", fromMealPlanId: 11 },
    { name: "無 plan", fromMealPlanId: 999, fromRecipeId: "official_9" },
  ];

  const result = await planShoppingBatch({ familyId: 1, items, existing: [] }, deps);

  assert.equal(calls.length, 1, "one IN lookup for the whole batch");
  assert.deepEqual([...calls[0]].sort((a, b) => a - b), [10, 11, 999]);
  assert.equal(result.inserts.length, 3);
  assert.equal(result.inserts[0].fromRecipeId, "official_42");
  assert.equal(result.inserts[1].fromRecipeId, "user_7");
  assert.equal(result.inserts[2].fromRecipeId, "official_9", "lookup miss uses the canonical client ref");
  assert.equal(result.inserts[2].fromMealPlanId, 999);
});

test("shopping_batch_per_item_date uses item date then plan date, never the global date", async () => {
  const rows = new Map<number, MealPlanLookupRow>([
    [10, { recipeId: "official_1", date: "2026-02-05" }],
  ]);
  const { deps } = makeDeps({ rows });
  const items: BatchShoppingItemInput[] = [
    { name: "A", plannedDate: "2026-02-01", fromMealPlanId: 10 },
    { name: "B", fromMealPlanId: 10 },
    { name: "C", plannedDate: "2026-02-07" },
  ];

  const result = await planShoppingBatch(
    { familyId: 1, items, fallbackPlannedDate: "2026-02-09", existing: [] },
    deps,
  );

  assert.equal(result.inserts[0].plannedDate, "2026-02-01", "item date wins");
  assert.equal(result.inserts[1].plannedDate, "2026-02-05", "plan date fallback");
  assert.equal(result.inserts[2].plannedDate, "2026-02-07", "item date, not global");
});

test("shopping_batch_partial_failure reports each item and never aborts the batch", async () => {
  const rows = new Map<number, MealPlanLookupRow>([
    [10, { recipeId: "official:bad", date: "2026-02-01" }],
  ]);
  const { deps } = makeDeps({ rows });
  const items: BatchShoppingItemInput[] = [
    { name: "A", fromMealPlanId: 10 },
    { name: "B", fromMealPlanId: 999, fromRecipeId: "user_3" },
    { name: "C", fromRecipeId: "user_3" },
  ];

  const result = await planShoppingBatch({ familyId: 1, items, existing: [] }, deps);

  assert.equal(result.inserts.length, 2, "invalid item is rejected, batch continues");
  assert.deepEqual(
    result.reports.map((report) => report.ok),
    [false, true, true],
  );
  assert.equal(result.reports[0].reason, "invalid_ref");
  assert.equal(result.reports[0].skipped, true);
  assert.equal(result.reports[1].reason, "lookup_miss");
  assert.equal(result.reports[1].fromRecipeId, "user_3", "canonical client ref fills a lookup miss");
  assert.equal(result.reports[2].fromRecipeId, "user_3");
});

test("shopping_batch_manual_item_with_null_ref_is_accepted", async () => {
  const { deps } = makeDeps();
  const items: BatchShoppingItemInput[] = [
    { name: "手動食材", fromRecipeId: null, fromMealPlanId: null },
  ];

  const result = await planShoppingBatch({ familyId: 1, items, existing: [] }, deps);

  assert.equal(result.inserts.length, 1);
  assert.equal(result.inserts[0].fromRecipeId, null);
  assert.equal(result.inserts[0].fromMealPlanId, null);
  assert.equal(result.reports[0].ok, true);
  assert.equal(result.reports[0].reason, "none");
});

test("shopping_batch_manual_item_with_bare_ref_is_rejected", async () => {
  const { deps, metrics } = makeDeps();
  const items: BatchShoppingItemInput[] = [
    { name: "手動食材", fromRecipeId: "123", fromMealPlanId: null },
  ];

  const result = await planShoppingBatch({ familyId: 1, items, existing: [] }, deps);

  assert.equal(result.inserts.length, 0);
  assert.equal(result.reports[0].ok, false);
  assert.equal(result.reports[0].skipped, true);
  assert.equal(result.reports[0].reason, "invalid_ref");
  assert.ok(metrics.includes("shopping_invalid_ref"));
});

test("shopping_batch_invalid_plan_without_canonical_client_ref_is_rejected", async () => {
  const rows = new Map<number, MealPlanLookupRow>([
    [10, { recipeId: "official:bad", date: "2026-02-01" }],
  ]);
  const { deps } = makeDeps({ rows });
  const items: BatchShoppingItemInput[] = [
    { name: "A", fromMealPlanId: 10 },
  ];

  const result = await planShoppingBatch({ familyId: 1, items, existing: [] }, deps);

  assert.equal(result.inserts.length, 0);
  assert.equal(result.reports[0].ok, false);
  assert.equal(result.reports[0].reason, "invalid_ref");
});

test("shopping_batch_never_updates_existing_non_canonical_ref", async () => {
  const { deps } = makeDeps();
  const existingItems = [
    existing({
      id: 1,
      name: "番茄",
      unit: "個",
      plannedDate: "2026-02-01",
      quantity: "1",
      fromRecipeId: "user:7",
    }),
  ];
  const items: BatchShoppingItemInput[] = [
    { name: "番茄", unit: "個", plannedDate: "2026-02-01", quantity: "2" },
  ];

  const result = await planShoppingBatch({ familyId: 1, items, existing: existingItems }, deps);

  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].fromRecipeId, null, "legacy existing ref is never written back");
});

test("shopping_batch_plan_join_is_authoritative_over_client_ref", async () => {
  const rows = new Map<number, MealPlanLookupRow>([
    [10, { recipeId: "official_42", date: "2026-02-01" }],
  ]);
  const { deps } = makeDeps({ rows });
  const items: BatchShoppingItemInput[] = [
    { name: "A", fromMealPlanId: 10, fromRecipeId: "user_9" },
  ];

  const result = await planShoppingBatch({ familyId: 1, items, existing: [] }, deps);

  assert.equal(result.inserts.length, 1);
  assert.equal(result.inserts[0].fromRecipeId, "official_42", "canonical plan ref wins");
  assert.equal(result.reports[0].reason, "ref_conflict");
});

test("shopping_batch_mixed_fixture keeps row count and per-row dates", async () => {
  const rows = new Map<number, MealPlanLookupRow>([
    [100, { recipeId: "official_1000", date: "2026-03-01" }],
    [101, { recipeId: "user_2001", date: "2026-03-02" }],
  ]);
  const { deps } = makeDeps({ rows });
  const items: BatchShoppingItemInput[] = [
    { name: "甲", fromMealPlanId: 100 },
    { name: "乙", fromMealPlanId: 101, plannedDate: "2026-03-02" },
    { name: "丙", fromRecipeId: null, plannedDate: "2026-03-01" },
  ];

  const result = await planShoppingBatch({ familyId: 1, items, existing: [] }, deps);

  assert.equal(result.inserts.length, 3);
  assert.deepEqual(
    result.inserts.map((row) => [row.name, row.plannedDate, row.fromRecipeId]),
    [
      ["甲", "2026-03-01", "official_1000"],
      ["乙", "2026-03-02", "user_2001"],
      ["丙", "2026-03-01", null],
    ],
  );
});

test("shopping_batch_dedupe_same_source_only does not merge same name from another recipe", async () => {
  const { deps } = makeDeps();
  const existingItems = [
    existing({
      id: 1,
      name: "番茄",
      unit: "個",
      plannedDate: "2026-02-01",
      fromRecipeId: "official_1",
    }),
  ];
  const items: BatchShoppingItemInput[] = [
    { name: "番茄", unit: "個", plannedDate: "2026-02-01", fromRecipeId: "official_2", quantity: "1" },
    { name: "番茄", unit: "個", plannedDate: "2026-02-01", fromRecipeId: "official_1", quantity: "2" },
  ];

  const result = await planShoppingBatch({ familyId: 1, items, existing: existingItems }, deps);

  assert.equal(result.inserts.length, 1, "different recipe stays separate");
  assert.equal(result.inserts[0].fromRecipeId, "official_2");
  assert.equal(result.updates.length, 1, "same recipe merges");
  assert.equal(result.updates[0].id, 1);
  assert.equal(result.updates[0].quantity, "3");
});

test("shopping_batch_dedupe_backfill_links keeps existing quantity and fills null links", async () => {
  const { deps } = makeDeps();
  const existingItems = [existing({ id: 1, name: "番茄", unit: "個", plannedDate: "2026-02-01", quantity: "2" })];
  const items: BatchShoppingItemInput[] = [
    {
      name: "番茄",
      unit: "個",
      plannedDate: "2026-02-01",
      quantity: "3",
      fromRecipeId: "official_5",
      fromMealPlanId: 50,
    },
  ];

  const result = await planShoppingBatch({ familyId: 1, items, existing: existingItems }, deps);

  assert.equal(result.inserts.length, 0);
  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].fromRecipeId, "official_5");
  assert.equal(result.updates[0].fromMealPlanId, 50);
  assert.equal(result.updates[0].quantity, "5");
});

test("shopping_batch_dedupe_preserve_existing keeps the first non-null link and logs conflict", async () => {
  const { deps, logs, metrics } = makeDeps();
  const existingItems = [
    existing({
      id: 1,
      name: "番茄",
      unit: "個",
      plannedDate: "2026-02-01",
      fromRecipeId: "official_5",
      fromMealPlanId: 50,
    }),
  ];
  const items: BatchShoppingItemInput[] = [
    {
      name: "番茄",
      unit: "個",
      plannedDate: "2026-02-01",
      fromRecipeId: "official_5",
      fromMealPlanId: 51,
    },
  ];

  const result = await planShoppingBatch({ familyId: 1, items, existing: existingItems }, deps);

  assert.equal(result.updates[0].fromMealPlanId, 50, "existing plan link wins");
  assert.equal(result.updates[0].fromRecipeId, "official_5");
  assert.ok(logs.includes("shopping_link_conflict"));
  assert.ok(metrics.includes("ref_conflict"));
});

test("shopping_batch_dedupe_matrix covers backfill, different recipe and preserve", async () => {
  const { deps } = makeDeps();
  const existingItems = [
    existing({ id: 1, name: "A", unit: "個", plannedDate: "2026-02-01", quantity: "1" }),
    existing({
      id: 2,
      name: "B",
      unit: "個",
      plannedDate: "2026-02-01",
      fromRecipeId: "official_1",
      fromMealPlanId: 10,
    }),
    existing({
      id: 3,
      name: "C",
      unit: "個",
      plannedDate: "2026-02-01",
      fromRecipeId: "official_1",
    }),
  ];
  const items: BatchShoppingItemInput[] = [
    // case 1: existing null + incoming link -> merge and backfill
    { name: "A", unit: "個", plannedDate: "2026-02-01", quantity: "2", fromRecipeId: "official_9", fromMealPlanId: 90 },
    // case 2: same name, different recipe -> 2 rows (existing stays, new insert)
    { name: "B", unit: "個", plannedDate: "2026-02-01", quantity: "1", fromRecipeId: "official_2" },
    // case 3: existing link + incoming null -> keep existing link
    { name: "C", unit: "個", plannedDate: "2026-02-01", quantity: "1" },
  ];

  const result = await planShoppingBatch({ familyId: 1, items, existing: existingItems }, deps);

  const updateA = result.updates.find((row) => row.id === 1);
  assert.ok(updateA);
  assert.equal(updateA.fromRecipeId, "official_9");
  assert.equal(result.inserts.filter((row) => row.name === "B").length, 1);
  const updateC = result.updates.find((row) => row.id === 3);
  assert.ok(updateC);
  assert.equal(updateC.fromRecipeId, "official_1");
});

test("shopping_batch_planned_date_fallback emits one metric with count", async () => {
  const rows = new Map<number, MealPlanLookupRow>([
    [10, { recipeId: "official_42", date: "2026-02-01" }],
  ]);
  const { deps, metricCalls } = makeDeps({ rows });
  const items: BatchShoppingItemInput[] = [
    { name: "A", fromMealPlanId: 10 },
    { name: "B", fromMealPlanId: 10 },
  ];

  const result = await planShoppingBatch({ familyId: 7, items, existing: [] }, deps);

  assert.equal(result.inserts.length, 2);
  const fallback = metricCalls.filter((call) => call.name === "shopping_planned_date_fallback");
  assert.equal(fallback.length, 1, "exactly one metric per batch");
  assert.deepEqual(fallback[0].tags, { familyId: 7, count: 2 });
});

test("shopping_batch_explicit_planned_date does not emit fallback metric", async () => {
  const rows = new Map<number, MealPlanLookupRow>([
    [10, { recipeId: "official_42", date: "2026-02-01" }],
  ]);
  const { deps, metricCalls } = makeDeps({ rows });
  const items: BatchShoppingItemInput[] = [
    { name: "A", fromMealPlanId: 10, plannedDate: "2026-02-02" },
    { name: "B", fromMealPlanId: 10, plannedDate: "2026-02-03" },
  ];

  await planShoppingBatch({ familyId: 7, items, existing: [] }, deps);

  assert.equal(
    metricCalls.filter((call) => call.name === "shopping_planned_date_fallback").length,
    0,
  );
});
