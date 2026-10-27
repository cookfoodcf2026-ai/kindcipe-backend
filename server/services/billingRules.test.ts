import assert from "node:assert/strict";
import test from "node:test";
import {
  isCanceledTrial,
  isStaleBillingEvent,
  pendingCheckoutMatches,
} from "./billingRules";

const now = new Date("2026-10-22T00:00:00.000Z");
const future = new Date("2026-10-25T00:00:00.000Z");

test("stale billing events are ignored", () => {
  assert.equal(isStaleBillingEvent(future, now), true);
  assert.equal(isStaleBillingEvent(now, future), false);
  assert.equal(isStaleBillingEvent(null, future), false);
});

test("canceled trial does not become paid access", () => {
  assert.equal(
    isCanceledTrial({ trialEnd: future, currentPeriodEnd: future, now }),
    true
  );
  assert.equal(
    isCanceledTrial({ trialEnd: future, currentPeriodEnd: null, now }),
    true
  );
  assert.equal(
    isCanceledTrial({
      trialEnd: future,
      currentPeriodEnd: new Date("2026-11-22T00:00:00.000Z"),
      now,
    }),
    false
  );
});

test("pending checkout is reused only for the same quote", () => {
  const base = {
    pendingPlan: "monthly",
    pendingTier: "founding",
    pendingTrialEnd: future,
    plan: "monthly",
    tier: "founding",
    trialEnd: future,
  };
  assert.equal(pendingCheckoutMatches(base), true);
  assert.equal(pendingCheckoutMatches({ ...base, plan: "yearly" }), false);
  assert.equal(pendingCheckoutMatches({ ...base, tier: "regular" }), false);
  assert.equal(
    pendingCheckoutMatches({ ...base, trialEnd: new Date("2026-10-24T00:00:00.000Z") }),
    false
  );
});
