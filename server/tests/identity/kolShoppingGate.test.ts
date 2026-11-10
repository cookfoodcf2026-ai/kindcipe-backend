/**
 * KOL shopping gate.
 *
 * Product rule (owner decision 2026-11-10): viewing and saving KOL recipes is
 * free; adding a KOL recipe to a meal plan or adding its ingredients to the
 * shopping list requires Pro. Official, plain text and own/imported/AI recipes
 * stay free. Pure unit coverage for the same helper the routers use; no DB.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import type { RecipeRef } from "../../lib/recipeRef";
import {
  PRO_REQUIRED_REASON,
  assertPlanItemGate,
  evaluatePlanItemGate,
  evaluateShoppingRecipeGate,
  isProRequiredError,
} from "../../lib/mealPlanProGate";

function userRef(id: number): RecipeRef {
  return { type: "user", id };
}

function assertProRequired(error: unknown): void {
  assert.ok(error instanceof TRPCError, "expected a TRPCError");
  assert.equal(error.code, "FORBIDDEN");
  assert.equal(error.message.startsWith("PRO_REQUIRED:"), true);
  assert.equal(
    (error.cause as { code?: string } | undefined)?.code,
    "PRO_REQUIRED",
  );
  assert.equal(isProRequiredError(error), true);
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

interface BatchItem {
  fromRecipeId: string | null;
  sourceType: string | null;
}

/** Mirrors `shopping.addBatch`: gated items are reported, others still insert. */
function addShoppingBatch(items: BatchItem[], isPro: boolean) {
  const inserted: number[] = [];
  const skipped: Array<{
    index: number;
    ok: false;
    skipped: true;
    reason: string;
  }> = [];

  items.forEach((item, index) => {
    const decision = evaluateShoppingRecipeGate({ ...item, isPro });
    if (decision.ok) {
      inserted.push(index);
    } else {
      skipped.push({ index, ...decision });
    }
  });

  return { inserted, skipped };
}

test("free: shopping.add with a KOL recipe ref → PRO_REQUIRED", () => {
  let caught: unknown;
  try {
    addShoppingItem({ fromRecipeId: "user_701", sourceType: "kol", isPro: false });
  } catch (error) {
    caught = error;
  }
  assertProRequired(caught);
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

test("free: shopping.addBatch 1 KOL + 2 normal → 2 inserted, KOL skipped pro_required", () => {
  const result = addShoppingBatch(
    [
      { fromRecipeId: "user_801", sourceType: "kol" },
      { fromRecipeId: "official_42", sourceType: null },
      { fromRecipeId: null, sourceType: null },
    ],
    false,
  );

  assert.deepEqual(result.inserted, [1, 2]);
  assert.deepEqual(result.skipped, [
    { index: 0, ok: false, skipped: true, reason: PRO_REQUIRED_REASON },
  ]);
});

test("pro: both shopping paths accept KOL recipe refs", () => {
  assert.equal(
    addShoppingItem({ fromRecipeId: "user_701", sourceType: "kol", isPro: true }),
    "inserted",
  );
  assert.deepEqual(
    addShoppingBatch(
      [
        { fromRecipeId: "user_801", sourceType: "kol" },
        { fromRecipeId: "official_42", sourceType: null },
      ],
      true,
    ),
    { inserted: [0, 1], skipped: [] },
  );
});

test("free: mealPlan.add with a KOL recipe is still rejected (regression)", () => {
  let caught: unknown;
  try {
    assertPlanItemGate(
      evaluatePlanItemGate({ ref: userRef(701), sourceType: "kol", isPro: false }),
    );
  } catch (error) {
    caught = error;
  }
  assertProRequired(caught);
});

test("shopping router wires the KOL gate into add / addBatch / auto-add", () => {
  const source = readFileSync(
    new URL("../../routers.ts", import.meta.url),
    "utf8",
  );
  const shoppingStart = source.indexOf("const shoppingRouter = router({");
  assert.notEqual(shoppingStart, -1, "shoppingRouter must exist");

  const addStart = source.indexOf("  add: familyWriteProcedure", shoppingStart);
  const batchStart = source.indexOf("  addBatch: familyWriteProcedure", addStart);
  const autoStart = source.indexOf(
    "  addIngredientsForMealPlans: familyWriteProcedure",
    shoppingStart,
  );
  const autoEnd = source.indexOf("\n});", autoStart);
  assert.notEqual(addStart, -1, "shopping.add must exist");
  assert.notEqual(batchStart, -1, "shopping.addBatch must exist");
  assert.notEqual(autoStart, -1, "shopping.addIngredientsForMealPlans must exist");
  assert.notEqual(autoEnd, -1, "shopping router end must be found");

  const addBlock = source.slice(addStart, batchStart);
  assert.match(addBlock, /kolGatedIndexes\(/);
  assert.match(addBlock, /proRequiredError\(\)/);

  const batchEnd = source.indexOf("  toggleBought: protectedProcedure", batchStart);
  assert.notEqual(batchEnd, -1, "shopping.toggleBought must exist");
  const batchBlock = source.slice(batchStart, batchEnd);
  assert.match(batchBlock, /kolGatedIndexes\(/);
  assert.match(batchBlock, /PRO_REQUIRED_REASON/);
  assert.match(batchBlock, /skipReason:\s*kolGated\[index\]/);

  const autoBlock = source.slice(autoStart, autoEnd);
  assert.match(autoBlock, /kolGatedIndexes\(/);
});
