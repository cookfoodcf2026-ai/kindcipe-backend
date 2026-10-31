import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MEMBER_GRACE_MS,
  PLAN_LIMITS,
  aiPlanCreditCost,
  effectivePlanLimits,
  limitsForStatus,
  memberGraceEndsAt,
} from "./entitlementPolicy";

test("plan limits match the locked product rules", () => {
  assert.deepEqual(PLAN_LIMITS.free, { aiCredits: 15, imports: 5, customRecipes: 5, members: 2 });
  assert.deepEqual(PLAN_LIMITS.trial, { aiCredits: 50, imports: 20, customRecipes: null, members: 4 });
  assert.deepEqual(PLAN_LIMITS.pro, { aiCredits: 150, imports: 100, customRecipes: null, members: 4 });
  assert.deepEqual(limitsForStatus("expired"), PLAN_LIMITS.free);
  assert.deepEqual(limitsForStatus("active"), PLAN_LIMITS.pro);
});

test("active pro with legacy credits keeps 250", () => {
  assert.equal(effectivePlanLimits("pro", undefined).aiCredits, 150);
  assert.equal(effectivePlanLimits("pro", null).aiCredits, 150);
  assert.equal(effectivePlanLimits("pro", 250).aiCredits, 250);
  assert.equal(effectivePlanLimits("pro", 250).imports, 100);
});

test("trial is never grandfathered to legacy credits", () => {
  assert.equal(effectivePlanLimits("trial", 250).aiCredits, 50);
  assert.equal(effectivePlanLimits("trial", 250).imports, 20);
  assert.equal(effectivePlanLimits("free", 250).aiCredits, 15);
});

test("member grace is only for free/expired over-limit kitchens", () => {
  const end = new Date("2026-10-01T00:00:00.000Z");
  assert.equal(memberGraceEndsAt({ status: "active", trialEndsAt: end, subscriptionExpiresAt: end, memberCount: 4 }), null);
  assert.equal(memberGraceEndsAt({ status: "free", trialEndsAt: end, subscriptionExpiresAt: null, memberCount: 2 }), null);
  const grace = memberGraceEndsAt({ status: "free", trialEndsAt: end, subscriptionExpiresAt: null, memberCount: 4 });
  assert.equal(grace?.getTime(), end.getTime() + MEMBER_GRACE_MS);
});

test("AI plan is free for paid/trial and one credit for free", () => {
  assert.equal(aiPlanCreditCost("active"), 0);
  assert.equal(aiPlanCreditCost("trial"), 0);
  assert.equal(aiPlanCreditCost("free"), 1);
  assert.equal(aiPlanCreditCost("expired"), 1);
});

test("legacy override is not granted by default", () => {
  assert.equal(PLAN_LIMITS.pro.aiCredits, 150);
  assert.equal(effectivePlanLimits("pro", null).aiCredits, 150);
  assert.equal(effectivePlanLimits("pro", undefined).aiCredits, 150);
  const migration = readFileSync(
    new URL("../../drizzle/migrations/0053_clear_legacy_ai_credits.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /SET "legacy_ai_credits" = NULL/);
  assert.match(migration, /WHERE "legacy_ai_credits" IS NOT NULL/);
});
