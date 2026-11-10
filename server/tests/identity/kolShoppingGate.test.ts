/**
 * KOL recipes are free on every path since 2026-11-10 (owner decision):
 * view, save, meal plan AND shopping list. These tests lock that in — they
 * exist because three separate KOL gates each shipped with its own bug.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { RecipeRef } from "../../lib/recipeRef";
import {
  assertPlanItemGate,
  evaluatePlanItemGate,
  evaluateShoppingRecipeGate,
} from "../../lib/mealPlanProGate";

function userRef(id: number): RecipeRef {
  return { type: "user", id };
}

/** Mirrors the single `shopping.add` path: gate first, then insert. */
function addShoppingItem(input: {
  fromRecipeId: string | null;
  sourceType: string | null;
  isPro: boolean;
}): "inserted" {
  assertPlanItemGate(evaluateShoppingRecipeGate(input));
  return "inserted";
}

function addShoppingBatch(
  items: Array<{ fromRecipeId: string | null; sourceType: string | null }>,
  isPro: boolean,
) {
  const inserted: number[] = [];
  const skipped: Array<{ index: number }> = [];
  items.forEach((item, index) => {
    const decision = evaluateShoppingRecipeGate({ ...item, isPro });
    if (decision.ok) inserted.push(index);
    else skipped.push({ index });
  });
  return { inserted, skipped };
}

test("free: shopping.add with a KOL recipe ref → succeeds", () => {
  assert.equal(
    addShoppingItem({ fromRecipeId: "user_701", sourceType: "kol", isPro: false }),
    "inserted",
  );
});

test("free: shopping.add with an official recipe ref → succeeds", () => {
  assert.equal(
    addShoppingItem({ fromRecipeId: "official_42", sourceType: null, isPro: false }),
    "inserted",
  );
});

test("free: plain text / own / imported / AI recipe items → succeed", () => {
  assert.equal(
    addShoppingItem({ fromRecipeId: null, sourceType: null, isPro: false }),
    "inserted",
  );
  for (const sourceType of ["manual", "import", "imported", "ai", "user"]) {
    assert.equal(
      addShoppingItem({ fromRecipeId: "user_702", sourceType, isPro: false }),
      "inserted",
      String(sourceType),
    );
  }
});

test("free: shopping.addBatch 1 KOL + 2 normal → all 3 inserted", () => {
  const result = addShoppingBatch(
    [
      { fromRecipeId: "user_801", sourceType: "kol" },
      { fromRecipeId: "official_42", sourceType: null },
      { fromRecipeId: null, sourceType: null },
    ],
    false,
  );
  assert.deepEqual(result.inserted, [0, 1, 2]);
  assert.deepEqual(result.skipped, []);
});

test("free: mealPlan.add with a KOL recipe → succeeds", () => {
  assert.doesNotThrow(() => {
    assertPlanItemGate(
      evaluatePlanItemGate({ ref: userRef(701), sourceType: "kol", isPro: false }),
    );
  });
});

test("the gate helpers always allow, so no KOL path can silently skip", () => {
  const freeKol = evaluatePlanItemGate({
    ref: userRef(900),
    sourceType: "kol",
    isPro: false,
  });
  assert.deepEqual(freeKol, { ok: true, skipped: false, reason: null });

  const shopping = evaluateShoppingRecipeGate({
    fromRecipeId: "user_900",
    sourceType: "kol",
    isPro: false,
  });
  assert.deepEqual(shopping, { ok: true, skipped: false, reason: null });
});

test("shopping router still routes through the gate helper (no ad-hoc blocking)", () => {
  const source = readFileSync(new URL("../../routers.ts", import.meta.url), "utf8");
  const shoppingStart = source.indexOf("const shoppingRouter = router({");
  assert.notEqual(shoppingStart, -1, "shoppingRouter must exist");

  const addStart = source.indexOf("  add: familyWriteProcedure", shoppingStart);
  const batchStart = source.indexOf("  addBatch: familyWriteProcedure", addStart);
  assert.notEqual(addStart, -1, "shopping.add must exist");
  assert.notEqual(batchStart, -1, "shopping.addBatch must exist");

  const addBlock = source.slice(addStart, batchStart);
  assert.match(addBlock, /kolGatedIndexes\(/, "shopping.add must consult the shared gate");

  const batchEnd = source.indexOf("  toggleBought: protectedProcedure", batchStart);
  const batchBlock = source.slice(batchStart, batchEnd);
  assert.match(batchBlock, /kolGatedIndexes\(/, "shopping.addBatch must consult the shared gate");
});
