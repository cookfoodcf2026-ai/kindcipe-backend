import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIncompleteSetFallback,
  filterStructuredFallbackRows,
} from "./chefStructuredFallback";
import { shouldChargeChefRequest } from "./aiChefPolicy";
import { finalizeChefRequest } from "./aiChefFinalization";

const row = (name: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  name,
  source: "official",
  steps: ["step"],
  ...extra,
});

test("scenario set with 0 matching rows returns recipes: [] and incomplete_set", () => {
  const rows = [
    row("Mango Sago", { scenarioTags: JSON.stringify(["kids"]) }),
    row("Spicy Chicken", { scenarioTags: JSON.stringify(["guest"]) }),
  ];

  const filtered = filterStructuredFallbackRows(rows, { scenario: "vegetarian" });
  assert.deepEqual(filtered, []);

  const result = buildIncompleteSetFallback("zh-TW", false);
  assert.deepEqual(result.recipes, []);
  assert.equal(result.clarifyReason, "incomplete_set");
});

test("scenario tags match either user tags or derived tags", () => {
  const rows = [
    row("User Veg", { scenarioTagsUser: JSON.stringify(["vegetarian"]) }),
    row("Derived Veg", { scenarioTags: JSON.stringify(["vegetarian"]) }),
    row("Kids Only", { scenarioTags: JSON.stringify(["kids"]) }),
  ];

  const filtered = filterStructuredFallbackRows(rows, { scenario: "vegetarian" });
  assert.deepEqual(filtered.map((r) => r.name), ["User Veg", "Derived Veg"]);
});

test("incomplete_set never charges a credit, even when the LLM was called", async () => {
  const result = buildIncompleteSetFallback("zh-TW", true);
  const aiCards = result.recipes.filter((recipe: any) => (recipe.source ?? "ai") === "ai").length;
  const shouldCharge = shouldChargeChefRequest({ served: result.recipes.length, aiCards });
  assert.equal(shouldCharge, false);

  const calls: string[] = [];
  const final = await finalizeChefRequest({
    truthful: false,
    shouldCharge,
    requestedCredits: 1,
    reservationId: 42,
    validate: () => [],
    buildLegacy: async () => ({
      recipes: result.recipes,
      clarifyReason: result.clarifyReason,
    }),
    applyContract: (legacy) => legacy,
    commitUsage: async () => { calls.push("commit"); },
    refundUsage: async () => { calls.push("refund"); },
  });

  assert.equal(final.creditsCharged, 0);
  assert.deepEqual(calls, ["refund"]);
});

test("cookTimeMax excludes rows over the limit and unknown cook times", () => {
  const rows = [
    row("Fast", { cookTime: 20 }),
    row("On Limit", { cookTime: 30 }),
    row("Over Limit", { cookTime: 31 }),
    row("Null Time", { cookTime: null }),
    row("Empty Time", { cookTime: "" }),
    row("No Time", {}),
  ];

  const filtered = filterStructuredFallbackRows(rows, { cookTimeMax: 30 });
  assert.deepEqual(filtered.map((r) => r.name), ["Fast", "On Limit"]);
});
