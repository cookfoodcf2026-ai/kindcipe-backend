import assert from "node:assert/strict";
import test from "node:test";
import { isStructuralShortFollowUp, parseMealShape, planChefTurn } from "./chefPlanner";

test("c01 structural commands have the expected shapes", () => {
  const first = planChefTurn("三送一湯");
  assert.deepEqual(first?.shape, { dishes: 3, soups: 1 });
  assert.deepEqual(first?.requested.roles, ["meat", "seafood", "vegetable", "soup"]);

  const next = planChefTurn("再一套", { previousText: "三送一湯" });
  assert.deepEqual(next?.shape, { dishes: 3, soups: 1 });
  assert.equal(next?.followUp, true);

  const noSoup = planChefTurn("唔要湯", { previousText: "三送一湯" });
  assert.deepEqual(noSoup?.shape, { dishes: 3, soups: 0 });
  assert.deepEqual(noSoup?.modifiers, [{ op: "remove", kind: "soup" }]);
  assert.equal(noSoup?.requested.total, 3);
});

test("planner uses an older meal when the immediate previous turn is a follow-up", () => {
  const command = planChefTurn("唔要湯", {
    previousText: "再一套",
    previousTexts: ["三送一湯", "再一套"],
  });
  assert.deepEqual(command?.shape, { dishes: 3, soups: 0 });
});

test("planner can add a dish but does not parse food names", () => {
  const add = planChefTurn("加多個菜", { previousText: "三送一湯" });
  assert.deepEqual(add?.shape, { dishes: 4, soups: 1 });
  assert.deepEqual(add?.modifiers, [{ op: "add", kind: "dish" }]);
  assert.equal(planChefTurn("魚面", { previousText: "三送一湯" }), null);
  assert.equal(planChefTurn("和牛", { previousText: "三送一湯" }), null);
});

test("planner does not absorb semantic modifiers", () => {
  assert.equal(planChefTurn("唔要辣", { previousText: "三送一湯" }), null);
  assert.equal(planChefTurn("少湯", { previousText: "三送一湯" }), null);
  assert.equal(isStructuralShortFollowUp("多謝"), false);
  assert.equal(isStructuralShortFollowUp("再見"), false);
  assert.equal(isStructuralShortFollowUp("再一套"), true);
});

test("parseMealShape remains structural", () => {
  assert.deepEqual(parseMealShape("3餸1湯"), { dishes: 3, soups: 1 });
  assert.deepEqual(parseMealShape("3款菜"), { dishes: 3, soups: 0 });
  assert.equal(parseMealShape("食牛扒同菜"), null);
});
