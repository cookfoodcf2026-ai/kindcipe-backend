import test from "node:test";
import assert from "node:assert/strict";

import {
  compareSeenFirst,
  deterministicShuffle,
  normalizeSeenMap,
  orderBySeenIfEnabled,
  seenKey,
  sortBySeenFirst,
  type SeenInfo,
} from "./chefSeenOrder";
import {
  DEFAULT_KEYWORD_POOL_LIMIT,
  KEYWORD_POOL_LIMIT_ENV,
  LEGACY_KEYWORD_POOL_LIMIT,
  getKeywordPoolLimit,
  keywordPoolFetchLimit,
  parseKeywordPoolLimit,
} from "./chefPoolLimit";

const row = (name: string, createdAt: string, id?: number) => ({ name, createdAt, id });
const seen = (entries: Record<string, Partial<SeenInfo>>) => new Map(Object.entries(entries));

test("unseen first, then fewer serves, then more-seen cards last", () => {
  const rows = [
    row("Unseen", "2026-01-01T00:00:00Z"),
    row("SeenOnce", "2026-01-02T00:00:00Z"),
    row("SeenThrice", "2026-01-03T00:00:00Z"),
  ];
  const map = seen({
    SeenOnce: { count: 1, lastSeenAt: 1000 },
    SeenThrice: { count: 3, lastSeenAt: 9000 },
  });
  assert.deepEqual(sortBySeenFirst(rows, map).map((r) => r.name), [
    "Unseen",
    "SeenOnce",
    "SeenThrice",
  ]);
});

test("same count: older lastSeenAt first", () => {
  const rows = [row("Fresh", "2026-01-01T00:00:00Z"), row("Stale", "2026-01-02T00:00:00Z")];
  const map = seen({
    Fresh: { count: 2, lastSeenAt: 5000 },
    Stale: { count: 2, lastSeenAt: 1000 },
  });
  assert.deepEqual(sortBySeenFirst(rows, map).map((r) => r.name), ["Stale", "Fresh"]);
});

test("deterministic: identical input twice yields identical order", () => {
  const rows = Array.from({ length: 50 }, (_, i) =>
    row(`dish-${i}`, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(), i + 1),
  );
  const map = seen({ "dish-1": { count: 2, lastSeenAt: 10 }, "dish-7": { count: 1, lastSeenAt: 5 } });
  const a = sortBySeenFirst(rows, map).map((r) => r.name);
  const b = sortBySeenFirst(rows, map).map((r) => r.name);
  assert.deepEqual(a, b);
  assert.deepEqual(deterministicShuffle(rows, ["seed"]).map((r) => r.name), deterministicShuffle(rows, ["seed"]).map((r) => r.name));
});

test("all seen with equal count/lastSeenAt falls back to createdAt desc", () => {
  const rows = [
    row("Old", "2025-01-01T00:00:00Z"),
    row("Newest", "2026-06-01T00:00:00Z"),
    row("Middle", "2025-09-01T00:00:00Z"),
  ];
  const map = seen({
    Old: { count: 1, lastSeenAt: 100 },
    Newest: { count: 1, lastSeenAt: 100 },
    Middle: { count: 1, lastSeenAt: 100 },
  });
  assert.deepEqual(sortBySeenFirst(rows, map).map((r) => r.name), ["Newest", "Middle", "Old"]);
});

test("empty and single-card pools do not crash", () => {
  assert.deepEqual(sortBySeenFirst([], new Map()), []);
  const one = [row("Only", "2026-01-01T00:00:00Z")];
  assert.deepEqual(sortBySeenFirst(one, new Map()), one);
  assert.equal(compareSeenFirst(one[0], one[0], new Map()), 0);
  assert.equal(seenKey("  Chicken Rice  "), "chicken rice");
  assert.equal(normalizeSeenMap(undefined).size, 0);
});

test("flag OFF keeps legacy order and the 80-row keyword limit", () => {
  const rows = [row("A", "2025-01-01T00:00:00Z"), row("B", "2026-01-01T00:00:00Z")];
  const map = seen({ A: { count: 9, lastSeenAt: 9999 }, B: { count: 1, lastSeenAt: 1 } });
  assert.deepEqual(orderBySeenIfEnabled(rows, map, false).map((r) => r.name), ["A", "B"]);
  assert.equal(keywordPoolFetchLimit(false), LEGACY_KEYWORD_POOL_LIMIT);
  assert.equal(keywordPoolFetchLimit(false, { [KEYWORD_POOL_LIMIT_ENV]: "2000" } as NodeJS.ProcessEnv), 80);
});

test("flag ON keyword limit defaults to 800 and honours the env override", () => {
  assert.equal(DEFAULT_KEYWORD_POOL_LIMIT, 800);
  assert.equal(parseKeywordPoolLimit(undefined), 800);
  assert.equal(parseKeywordPoolLimit(""), 800);
  assert.equal(parseKeywordPoolLimit("garbage"), 800);
  assert.equal(parseKeywordPoolLimit("0"), 800);
  assert.equal(parseKeywordPoolLimit("1200"), 1200);
  assert.equal(getKeywordPoolLimit({} as NodeJS.ProcessEnv), 800);
  assert.equal(keywordPoolFetchLimit(true, {} as NodeJS.ProcessEnv), 800);
  assert.equal(keywordPoolFetchLimit(true, { [KEYWORD_POOL_LIMIT_ENV]: "500" } as NodeJS.ProcessEnv), 500);
});

test("integration: 395-card pool, 100 serves => >=99% distinct coverage", () => {
  const pool = Array.from({ length: 395 }, (_, i) =>
    row(`pool-${i}`, new Date(Date.UTC(2025, 0, 1) + i * 60_000).toISOString(), i + 1),
  );
  const map = new Map<string, SeenInfo>();
  const served = new Set<string>();
  for (let round = 0; round < 100; round++) {
    const batch = sortBySeenFirst(pool, map).slice(0, 4);
    assert.equal(new Set(batch.map((r) => r.name)).size, batch.length);
    for (const item of batch) {
      served.add(item.name);
      const prev = map.get(item.name);
      map.set(item.name, { count: (prev?.count ?? 0) + 1, lastSeenAt: round + 1 });
    }
  }
  assert.equal(served.size, 395);
  assert.ok(served.size / pool.length >= 0.99, `coverage=${served.size}/${pool.length}`);
});
