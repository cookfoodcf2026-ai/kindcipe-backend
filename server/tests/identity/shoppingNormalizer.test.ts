import assert from "node:assert/strict";
import test from "node:test";
import {
  LruTtlCache,
  createShoppingNormalizer,
  type NormalizerPlanLookup,
} from "../../lib/shoppingNormalizer";
import {
  FAMILY_A,
  FAMILY_B,
  expectedNormalized,
  lookupMealPlans,
  shoppingItems,
} from "./fixtures";

function fakeLookup(
  rows: Map<number, { recipeId: string | null; date: string | null }>,
  calls: number[][],
): NormalizerPlanLookup {
  return {
    async getMealPlanRows(_familyId, planIds) {
      calls.push([...planIds]);
      const found = new Map<number, { recipeId: string | null; date: string | null }>();
      for (const id of planIds) {
        const row = rows.get(id);
        if (row) found.set(id, row);
      }
      return found;
    },
  };
}

test("shopping_normalizer_maps_legacy repairs plan joins and legacy colon refs read-time", async () => {
  const rows = new Map<number, { recipeId: string | null; date: string | null }>([
    [10, { recipeId: "official_42", date: "2026-02-01" }],
    [11, { recipeId: "official:", date: "2026-02-01" }],
    [13, { recipeId: "user:88", date: "2026-02-01" }],
  ]);
  const calls: number[][] = [];
  const normalizer = createShoppingNormalizer({ lookup: fakeLookup(rows, calls) });

  const input = [
    { id: 1, fromMealPlanId: 10, fromRecipeId: null },
    { id: 2, fromMealPlanId: null, fromRecipeId: "official:77" },
    { id: 3, fromMealPlanId: null, fromRecipeId: "custom_x" },
    { id: 4, fromMealPlanId: 11, fromRecipeId: "user_5" },
    { id: 5, fromMealPlanId: 12, fromRecipeId: null },
    { id: 6, fromMealPlanId: 13, fromRecipeId: null },
  ];

  const output = await normalizer.normalizeRows(1, input);

  assert.deepEqual(
    output.map((row) => row.fromRecipeId),
    ["official_42", "official_77", null, "user_5", null, "user_88"],
  );
});

test("shopping_list_read_normalizes returns new rows and leaves the source untouched", async () => {
  const rows = new Map<number, { recipeId: string | null; date: string | null }>([
    [10, { recipeId: "official_42", date: "2026-02-01" }],
  ]);
  const normalizer = createShoppingNormalizer({ lookup: fakeLookup(rows, []) });
  const input = [{ id: 1, fromMealPlanId: 10, fromRecipeId: null }];

  const output = await normalizer.normalizeRows(1, input);

  assert.equal(input[0].fromRecipeId, null, "source row is not mutated");
  assert.notEqual(output[0], input[0], "mapper returns a new object");
});

test("shopping_normalizer_cache_ttl dedupes request ids and expires after 60s", async () => {
  let now = 1_000;
  const calls: number[][] = [];
  const rows = new Map<number, { recipeId: string | null; date: string | null }>([
    [10, { recipeId: "official_42", date: "2026-02-01" }],
  ]);
  const normalizer = createShoppingNormalizer({
    lookup: fakeLookup(rows, calls),
    cache: new LruTtlCache({ max: 10, now: () => now }),
    ttlMs: 60_000,
    now: () => now,
  });
  const input = [
    { id: 1, fromMealPlanId: 10, fromRecipeId: null },
    { id: 2, fromMealPlanId: 10, fromRecipeId: null },
  ];

  await normalizer.normalizeRows(1, input);
  assert.deepEqual(calls, [[10]], "one lookup for duplicate plan ids in a request");

  await normalizer.normalizeRows(1, input);
  assert.equal(calls.length, 1, "cross-request cache hit");

  now += 60_001;
  await normalizer.normalizeRows(1, input);
  assert.equal(calls.length, 2, "expired after TTL");

  normalizer.invalidate(1, 10);
  await normalizer.normalizeRows(1, input);
  assert.equal(calls.length, 3, "invalidate forces a fresh read");
});

test("shopping_normalizer_no_write never calls a write path", async () => {
  const rows = new Map<number, { recipeId: string | null; date: string | null }>([
    [10, { recipeId: "official_42", date: "2026-02-01" }],
  ]);
  let writes = 0;
  const lookup = {
    ...fakeLookup(rows, []),
    async insert() {
      writes += 1;
    },
    async update() {
      writes += 1;
    },
  } as unknown as NormalizerPlanLookup;
  const normalizer = createShoppingNormalizer({ lookup });

  await normalizer.normalizeRows(1, [
    { id: 1, fromMealPlanId: 10, fromRecipeId: null },
    { id: 2, fromMealPlanId: 11, fromRecipeId: "official:9" },
  ]);

  assert.equal(writes, 0);
});

test("shopping_normalizer_95_10_fixture repairs 72 rows and leaves 33 null", async () => {
  const familyA = shoppingItems.filter((item) => item.familyId === FAMILY_A);
  const familyB = shoppingItems.filter((item) => item.familyId === FAMILY_B);
  const metrics: string[] = [];
  const normalizer = createShoppingNormalizer({
    lookup: { getMealPlanRows: lookupMealPlans },
    metric(name) {
      metrics.push(name);
    },
  });

  const normalizedA = await normalizer.normalizeRows(FAMILY_A, familyA);
  const normalizedB = await normalizer.normalizeRows(FAMILY_B, familyB);
  const all = [...normalizedA, ...normalizedB];

  assert.equal(all.length, expectedNormalized.total);
  assert.equal(all.filter((row) => row.fromRecipeId !== null).length, expectedNormalized.valid);
  assert.equal(all.filter((row) => row.fromRecipeId === null).length, expectedNormalized.nullish);
  assert.equal(
    metrics.filter((name) => name === "orphan_read").length,
    expectedNormalized.orphanMetric,
  );
});
