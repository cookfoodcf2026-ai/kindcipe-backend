import assert from "node:assert/strict";
import test from "node:test";
import { buildQueryPlan } from "./chefQueryPlan";

test("soup query maps to real dishType soup", () => {
  const plan = buildQueryPlan("有咩湯？");
  assert.deepEqual(plan.dishTypes, ["soup"]);
  assert.equal(plan.scenarios.length, 0);
});

test("noodle soup maps to soup + carb", () => {
  const plan = buildQueryPlan("有咩湯麵？");
  assert.deepEqual(plan.dishTypes, ["soup", "carb"]);
});

test("quick and family scenarios map to scenarioTags", () => {
  assert.deepEqual(buildQueryPlan("有咩快煮？").scenarios, ["quick"]);
  assert.deepEqual(buildQueryPlan("有小朋友食咩？").scenarios, ["kids"]);
  assert.deepEqual(buildQueryPlan("想清淡啲").scenarios, ["healthy"]);
});

test("avoid and time constraints are structural", () => {
  const plan = buildQueryPlan("唔好整雞，30分鐘內食得");
  assert.deepEqual(plan.avoid, ["雞"]);
  assert.equal(plan.cookTimeMax, 30);
});
