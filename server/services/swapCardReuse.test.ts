import assert from "node:assert/strict";
import test from "node:test";
import { resolveSwapExplicitCount, swapAllowReuse } from "./swapCardPolicy";

test("swap turn + 3 fresh cards -> cap 3", () => {
  assert.equal(
    resolveSwapExplicitCount({ isSwapTurn: true, structuredEntry: true, askedCount: 0, servedCount: 3 }),
    3,
  );
});

test("swap turn + 5 cards -> cap 3", () => {
  assert.equal(
    resolveSwapExplicitCount({ isSwapTurn: true, structuredEntry: false, askedCount: 0, servedCount: 5 }),
    3,
  );
});

test("swap without 可以重複 -> allowReuse false", () => {
  assert.equal(swapAllowReuse("庫內搜尋：蒸魚；同類別：meat"), false);
});

test("swap with 可以重複 -> allowReuse true", () => {
  assert.equal(swapAllowReuse("庫內搜尋：蒸魚；同類別：meat；可以重複"), true);
});

test("non-swap library entry -> cap 1", () => {
  assert.equal(
    resolveSwapExplicitCount({ isSwapTurn: false, structuredEntry: true, askedCount: 4, servedCount: 3 }),
    1,
  );
});
