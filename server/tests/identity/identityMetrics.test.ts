import assert from "node:assert/strict";
import test from "node:test";
import {
  IDENTITY_ALERT_THRESHOLDS,
  IDENTITY_METRICS_SQL,
  buildIdentityMetricsResponse,
  computeCanonicalRate,
  computeIdentityMetrics,
  runDailyIdentityMetrics,
  type IdentityMetricsStore,
} from "../../ops/identityMetrics";

function fakeStore(overrides: Partial<{
  dailyOrphan: number;
  previousDayOrphan: number;
  invalid: number;
  canonicalWritten: number;
  expected: number;
  refConflict: number;
  missTop5: Array<{ familyId: number; misses: number }>;
}> = {}): IdentityMetricsStore {
  const targetDay = "2026-03-01";
  return {
    async countDailyOrphans(day) {
      if (day !== targetDay) return overrides.previousDayOrphan ?? 0;
      return overrides.dailyOrphan ?? 0;
    },
    async countDailyInvalidRefs() {
      return overrides.invalid ?? 0;
    },
    async getCanonicalCounters() {
      return {
        canonicalWritten: overrides.canonicalWritten ?? 0,
        expected: overrides.expected ?? 0,
        refConflict: overrides.refConflict ?? 0,
      };
    },
    async getMissTop5() {
      return overrides.missTop5 ?? [];
    },
  };
}

test("identity_metrics_orphan_count reports daily orphans and invalid refs", async () => {
  const logs: Array<Record<string, unknown>> = [];
  const metrics = await runDailyIdentityMetrics(
    fakeStore({ dailyOrphan: 95, invalid: 10 }),
    "2026-03-01",
    (entry) => logs.push(entry),
  );

  assert.equal(metrics.day, "2026-03-01");
  assert.equal(metrics.dailyOrphan, 95);
  assert.equal(metrics.invalid, 10);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].event, "identity_metrics_daily");
  assert.equal(logs[0].dailyOrphan, 95);
});

test("identity_metrics_canonical_rate computes canonical_written / expected and per-family top", async () => {
  assert.equal(computeCanonicalRate(90, 100), 0.9);
  assert.equal(computeCanonicalRate(95, 100), 0.95);
  assert.equal(computeCanonicalRate(0, 0), 1, "no traffic is not a regression");

  const metrics = await buildIdentityMetricsResponse(
    fakeStore({
      dailyOrphan: 3,
      canonicalWritten: 90,
      expected: 100,
      missTop5: [
        { familyId: 7, misses: 12 },
        { familyId: 8, misses: 4 },
      ],
    }),
    "2026-03-01",
  );

  assert.equal(metrics.canonicalRate, 0.9);
  assert.equal(metrics.canonicalWritten, 90);
  assert.equal(metrics.expected, 100);
  assert.deepEqual(metrics.missTop5, [
    { familyId: 7, misses: 12 },
    { familyId: 8, misses: 4 },
  ]);
});

test("identity_metrics_endpoint returns dashboard fields and SQL templates exist", async () => {
  const metrics = await buildIdentityMetricsResponse(
    fakeStore({ dailyOrphan: 5, invalid: 1, canonicalWritten: 99, expected: 100 }),
    "2026-03-01",
  );

  assert.deepEqual(Object.keys(metrics).sort(), [
    "alerts",
    "canonicalRate",
    "canonicalWritten",
    "dailyOrphan",
    "day",
    "expected",
    "invalid",
    "missTop5",
    "refConflictRate",
  ]);
  assert.equal(metrics.alerts.length, 0);

  for (const key of ["orphans", "invalidRefs", "canonical", "missTop5"] as const) {
    assert.equal(typeof IDENTITY_METRICS_SQL[key], "string", key);
    assert.match(IDENTITY_METRICS_SQL[key], /shopping_items/);
  }
});

test("identity_metrics_alert_thresholds fires on two-day orphan growth, low canonical rate and conflicts", () => {
  const metrics = computeIdentityMetrics({
    day: "2026-03-02",
    dailyOrphan: 10,
    invalid: 2,
    previousDayOrphan: 4,
    canonicalWritten: 90,
    expected: 100,
    refConflict: 3,
    missTop5: [],
  });

  assert.equal(IDENTITY_ALERT_THRESHOLDS.canonicalRateMin, 0.95);
  assert.ok(metrics.alerts.includes("orphan_rising"));
  assert.ok(metrics.alerts.includes("canonical_rate_low"));
  assert.ok(metrics.alerts.includes("ref_conflict_high"));

  const healthy = computeIdentityMetrics({
    day: "2026-03-02",
    dailyOrphan: 0,
    invalid: 0,
    previousDayOrphan: 4,
    canonicalWritten: 100,
    expected: 100,
    refConflict: 0,
    missTop5: [],
  });
  assert.deepEqual(healthy.alerts, []);
});
