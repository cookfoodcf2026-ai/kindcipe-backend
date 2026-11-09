import assert from "node:assert/strict";
import crypto from "crypto";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  compareDailyOrder,
  dailyOrderKey,
  officialOrderBy,
  resolveOfficialSearchOrder,
  type OfficialOrder,
} from "./officialRecipeOrder";

const dialect = new PgDialect();

function rendered(order: OfficialOrder): string[] {
  return officialOrderBy(order).map((clause) => dialect.sqlToQuery(clause).sql);
}

function sortDaily(ids: number[], hkDate: string): number[] {
  return ids
    .map((id) => ({ id }))
    .sort((a, b) => compareDailyOrder(a, b, hkDate))
    .map((row) => row.id);
}

test("daily hashes id with the Hong Kong calendar date and breaks ties by id", () => {
  const clauses = rendered("daily");
  assert.equal(
    clauses[0],
    `md5(concat("official_recipes"."id"::text, (now() AT TIME ZONE 'Asia/Hong_Kong')::date::text))`,
  );
  assert.equal(clauses[1], `"official_recipes"."id" asc`);
});

test("daily key is md5 of id::text concatenated with the YYYY-MM-DD date", () => {
  const id = 42;
  const hkDate = "2026-11-09";
  const expected = crypto.createHash("md5").update(`42${hkDate}`).digest("hex");
  assert.equal(dailyOrderKey(id, hkDate), expected);
  assert.match(dailyOrderKey(id, hkDate), /^[0-9a-f]{32}$/);
});

test("fastest orders cookTime asc with NULLs last, then id asc", () => {
  assert.deepEqual(rendered("fastest"), [
    `"official_recipes"."cook_time" asc nulls last`,
    `"official_recipes"."id" asc`,
  ]);
});

test("newest orders createdAt desc with id desc as the tiebreaker", () => {
  assert.deepEqual(rendered("newest"), [
    `"official_recipes"."created_at" desc`,
    `"official_recipes"."id" desc`,
  ]);
});

test("all orders are bound-parameter free so the SQL can use indexes as written", () => {
  for (const order of ["daily", "fastest", "newest"] as const) {
    for (const clause of officialOrderBy(order)) {
      assert.deepEqual(dialect.sqlToQuery(clause).params, []);
    }
  }
});

test("daily pagination is stable within one day and rotates the next day", () => {
  const hkDate = "2026-11-09";
  const ids = Array.from({ length: 25 }, (_, i) => i + 1);

  const full = sortDaily(ids, hkDate);
  const page1 = full.slice(0, 10);
  const page2 = full.slice(10, 20);
  const page3 = full.slice(20);
  assert.deepEqual([...page1, ...page2, ...page3], full);
  assert.equal(new Set(full).size, ids.length);

  // Two calls on the same day produce the exact same order.
  assert.deepEqual(sortDaily(ids, hkDate), full);

  // Same inputs in a different insertion order still produce the same pages.
  assert.deepEqual(sortDaily([...ids].reverse(), hkDate), full);

  // Next day produces a different rotation.
  assert.notDeepEqual(sortDaily(ids, "2026-11-10"), full);
});

test("search applies order only for the official source", () => {
  assert.equal(resolveOfficialSearchOrder({ source: "official", order: "daily" }), "daily");
  assert.equal(resolveOfficialSearchOrder({ source: "official", order: "fastest" }), "fastest");
  assert.equal(resolveOfficialSearchOrder({ source: "official", order: "newest" }), "newest");

  for (const source of ["all", "user", "kol", "hot", "ai", undefined, null]) {
    assert.equal(
      resolveOfficialSearchOrder({ source, order: "fastest" }),
      undefined,
      `source=${String(source)} must ignore order`,
    );
  }

  assert.equal(resolveOfficialSearchOrder({ source: "official" }), undefined);
  assert.equal(resolveOfficialSearchOrder({ source: "official", order: undefined }), undefined);
});
