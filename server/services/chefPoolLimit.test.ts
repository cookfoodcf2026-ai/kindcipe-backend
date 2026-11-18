import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_GENERIC_POOL_LIMIT,
  GENERIC_POOL_LIMIT_ENV,
  UNLIMITED_GENERIC_POOL_LIMIT,
  getGenericPoolLimit,
  orderPoolForReturn,
  parseGenericPoolLimit,
  poolCustomFirstCap,
  poolFetchLimit,
  slicePoolForReturn,
} from "./chefPoolLimit";

function withEnv<T>(raw: string | undefined, fn: () => T): T {
  const prev = process.env[GENERIC_POOL_LIMIT_ENV];
  if (raw === undefined) delete process.env[GENERIC_POOL_LIMIT_ENV];
  else process.env[GENERIC_POOL_LIMIT_ENV] = raw;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[GENERIC_POOL_LIMIT_ENV];
    else process.env[GENERIC_POOL_LIMIT_ENV] = prev;
  }
}

const rows = (count: number, prefix = "r") =>
  Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`);

test("env unset / empty keeps the legacy 400 cap", () => {
  assert.equal(parseGenericPoolLimit(undefined), 400);
  assert.equal(parseGenericPoolLimit(""), 400);
  assert.equal(parseGenericPoolLimit("   "), 400);
  assert.equal(withEnv(undefined, () => getGenericPoolLimit()), 400);
  assert.equal(withEnv("", () => getGenericPoolLimit()), 400);
  assert.equal(DEFAULT_GENERIC_POOL_LIMIT, 400);
});

test("env 0 means unlimited and is mapped to the SQL ceiling", () => {
  assert.equal(parseGenericPoolLimit("0"), 0);
  assert.equal(withEnv("0", () => getGenericPoolLimit()), UNLIMITED_GENERIC_POOL_LIMIT);
  assert.ok(UNLIMITED_GENERIC_POOL_LIMIT >= 438);
});

test("env positive integer overrides the cap", () => {
  assert.equal(parseGenericPoolLimit("600"), 600);
  assert.equal(parseGenericPoolLimit(" 800 "), 800);
  assert.equal(withEnv("438", () => getGenericPoolLimit()), 438);
});

test("env invalid values fail safe to 400 (never unbounded)", () => {
  for (const raw of ["abc", "-5", "1.5", "400x", "NaN", "Infinity"]) {
    assert.equal(parseGenericPoolLimit(raw), 400, raw);
    assert.equal(withEnv(raw, () => getGenericPoolLimit()), 400, raw);
  }
});

test("poolFetchLimit maps 0 / non-positive to the ceiling, NaN to 400", () => {
  assert.equal(poolFetchLimit(400), 400);
  assert.equal(poolFetchLimit(1000.9), 1000);
  assert.equal(poolFetchLimit(0), UNLIMITED_GENERIC_POOL_LIMIT);
  assert.equal(poolFetchLimit(-1), UNLIMITED_GENERIC_POOL_LIMIT);
  assert.equal(poolFetchLimit(Number.POSITIVE_INFINITY), UNLIMITED_GENERIC_POOL_LIMIT);
  assert.equal(poolFetchLimit(Number.NaN), DEFAULT_GENERIC_POOL_LIMIT);
});

test("slicePoolForReturn caps at limit, 0 returns all, never mutates input", () => {
  const pool = rows(500);
  assert.equal(slicePoolForReturn(pool, 400).length, 400);
  assert.equal(slicePoolForReturn(pool, 400)[399], "r-400");
  assert.equal(slicePoolForReturn(pool, 0).length, 500);
  assert.equal(slicePoolForReturn(pool, -3).length, 500);
  assert.equal(slicePoolForReturn(pool, 9999).length, 500);
  assert.equal(pool.length, 500);
  assert.equal(slicePoolForReturn([], 400).length, 0);
});

test("raising the cap does not reorder the first 400 rows", () => {
  const custom = rows(300, "custom");
  const official = rows(300, "official");
  const legacy = orderPoolForReturn(custom, official, DEFAULT_GENERIC_POOL_LIMIT);
  const widened = orderPoolForReturn(custom, official, UNLIMITED_GENERIC_POOL_LIMIT);
  assert.deepEqual(slicePoolForReturn(widened, 400), slicePoolForReturn(legacy, 400));
  assert.equal(poolCustomFirstCap(400), 200);
  assert.equal(poolCustomFirstCap(20_000), 200);
  assert.equal(poolCustomFirstCap(0), 200);
});

test("custom rows take at most half of the first 200, official follows, rest custom", () => {
  const custom = rows(300, "custom");
  const official = rows(3, "official");
  const ordered = orderPoolForReturn(custom, official, 400);
  assert.deepEqual(ordered.slice(0, 200), custom.slice(0, 200));
  assert.deepEqual(ordered.slice(200, 203), official);
  assert.deepEqual(ordered.slice(203, 303), custom.slice(200));
});
