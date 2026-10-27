import assert from "node:assert/strict";
import test from "node:test";
import { costUsdToMicros, getNextResetAt, getYearMonthKey } from "./llmCost";
import { AI_CHEF_CAP_MICROS } from "./aiChefFlags";

test("converts USD to integer micros", () => {
  assert.equal(costUsdToMicros(0.0095), 9500);
  assert.equal(costUsdToMicros(0), 0);
});

test("month key and reset are UTC based", () => {
  const d = new Date("2026-10-27T12:00:00Z");
  assert.equal(getYearMonthKey(d), "2026-10");
  assert.equal(getNextResetAt(d), "2026-11-01T00:00:00.000Z");
});

test("cap constants match the approved web launch values", () => {
  assert.deepEqual(AI_CHEF_CAP_MICROS, {
    standard_monthly: 2_200_000,
    standard_yearly: 1_700_000,
    founding_monthly: 1_450_000,
    founding_yearly: 1_250_000,
    free: 150_000,
    trial: 600_000,
  });
});
