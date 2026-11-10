/**
 * KOL meal-plan gate.
 *
 * Product rule: KOL recipes are viewable by free families but adding one to a
 * meal plan requires Pro. Own/imported/AI/manual and official recipes stay
 * free. Pure unit coverage for the same helper the routers use; no database.
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
  isProRequiredError,
} from "../../lib/mealPlanProGate";

function userRef(id: number): RecipeRef {
  return { type: "user", id };
}

function officialRef(id: number): RecipeRef {
  return { type: "official", id };
}

/** Mirrors the single `mealPlan.add` path: gate first, then insert. */
function addOne(input: {
  ref: RecipeRef;
  sourceType: string | null;
  isPro: boolean;
}): "inserted" {
  assertPlanItemGate(evaluatePlanItemGate(input));
  return "inserted";
}

test("free family + KOL recipe → mealPlan.add succeeds (KOL is free since 2026-11-10)", () => {
  assert.equal(
    addOne({ ref: userRef(701), sourceType: "kol", isPro: false }),
    "inserted",
  );
});

test("pro family + KOL recipe → mealPlan.add succeeds", () => {
  assert.equal(
    addOne({ ref: userRef(701), sourceType: "kol", isPro: true }),
    "inserted",
  );
});

test("free family + own recipe → mealPlan.add succeeds", () => {
  for (const sourceType of ["manual", "import", "ai", "user", null]) {
    assert.equal(
      addOne({ ref: userRef(702), sourceType, isPro: false }),
      "inserted",
      String(sourceType),
    );
  }
});

test("free family + official recipe → mealPlan.add succeeds", () => {
  assert.equal(
    addOne({ ref: officialRef(42), sourceType: null, isPro: false }),
    "inserted",
  );
});

test("free family addBatch: 1 KOL + 2 own → all 3 inserted (KOL is free)", () => {
  const items: Array<{ ref: RecipeRef; sourceType: string | null }> = [
    { ref: userRef(801), sourceType: "kol" },
    { ref: userRef(802), sourceType: "manual" },
    { ref: userRef(803), sourceType: "import" },
  ];

  const insertedIndexes: number[] = [];
  const skippedItems: Array<{
    index: number;
    ok: false;
    skipped: true;
    reason: string;
  }> = [];

  items.forEach((item, index) => {
    const decision = evaluatePlanItemGate({ ...item, isPro: false });
    if (decision.ok) {
      insertedIndexes.push(index);
    } else {
      skippedItems.push({ index, ...decision });
    }
  });

  assert.deepEqual(insertedIndexes, [0, 1, 2]);
  assert.deepEqual(skippedItems, []);
});

test("listKol works for a free family (no assertProFeature gate)", () => {
  const source = readFileSync(
    new URL("../../routers/recipes.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("  listKol: protectedProcedure");
  assert.notEqual(start, -1, "listKol route must exist");

  const closing = "\n    }),\n";
  const end = source.indexOf(closing, start);
  assert.notEqual(end, -1, "listKol block end must be found");

  const block = source.slice(start, end + closing.length);
  assert.equal(
    block.includes("assertProFeature"),
    false,
    "listKol must not require Pro",
  );
  assert.match(block, /id: `user_\$\{r\.id\}`/);
  assert.match(block, /source: "user" as const/);
});
