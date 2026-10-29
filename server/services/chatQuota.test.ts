import assert from "node:assert/strict";
import test from "node:test";
import { CHAT_LIMITS, evaluateChatQuota } from "./chatQuota";

test("pro chat allows 59 daily and blocks at 60", () => {
  const ok = evaluateChatQuota({ plan: "pro", dailyUsed: 59, monthlyUsed: 59, monthlyCostMicros: 0 });
  const blocked = evaluateChatQuota({ plan: "pro", dailyUsed: 60, monthlyUsed: 60, monthlyCostMicros: 0 });
  assert.equal(ok.allowed, true);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "daily");
});

test("free chat allows 2 daily and blocks at 3", () => {
  const ok = evaluateChatQuota({ plan: "free", dailyUsed: 2, monthlyUsed: 2, monthlyCostMicros: 0 });
  const blocked = evaluateChatQuota({ plan: "free", dailyUsed: 3, monthlyUsed: 3, monthlyCostMicros: 0 });
  assert.equal(ok.allowed, true);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "daily");
});

test("pro chat blocks at 1200 monthly", () => {
  const state = evaluateChatQuota({ plan: "pro", dailyUsed: 1, monthlyUsed: 1200, monthlyCostMicros: 0 });
  assert.equal(state.allowed, false);
  assert.equal(state.reason, "monthly");
});

test("pro chat blocks at $0.60 and free at $0.05", () => {
  const pro = evaluateChatQuota({ plan: "pro", dailyUsed: 1, monthlyUsed: 1, monthlyCostMicros: 600_000 });
  const free = evaluateChatQuota({ plan: "free", dailyUsed: 1, monthlyUsed: 1, monthlyCostMicros: 50_000 });
  assert.equal(pro.allowed, false);
  assert.equal(pro.reason, "budget");
  assert.equal(free.allowed, false);
  assert.equal(free.reason, "budget");
});

test("limits match the locked product definition", () => {
  assert.deepEqual(CHAT_LIMITS.pro, { daily: 60, monthly: 1_200, costMicros: 600_000 });
  assert.deepEqual(CHAT_LIMITS.free, { daily: 3, monthly: 1_200, costMicros: 50_000 });
});
