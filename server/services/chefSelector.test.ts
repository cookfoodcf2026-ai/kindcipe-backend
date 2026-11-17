import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  SELECTOR_SEEN_WINDOW_MS,
  SHADOW_MAX_LINES,
  hashSeed,
  selectCards,
  shadowCompareSelector,
  type SeenEntry,
  type SelectorConstraints,
  type SelectorPoolCard,
} from "./chefSelector";
import { CHEF_FIXTURE_POOL } from "./chefSelector.fixtures";

const NOW = Date.parse("2026-11-17T00:00:00.000Z");

function card(id: number, extra: Partial<SelectorPoolCard> = {}): SelectorPoolCard {
  return {
    id,
    name: `card-${id}`,
    category: "meat",
    dishType: "meat",
    cookTime: 20,
    difficulty: "easy",
    language: "zh-TW",
    steps: ["備料", "烹調"],
    hasMedia: true,
    ...extra,
  };
}

function pickPath(result: ReturnType<typeof selectCards>): string[] {
  return result.cards.map((entry) => String(entry.id ?? entry.name));
}

test("selector_hard_filter_order_and_dup", () => {
  const pool: SelectorPoolCard[] = [
    card(1, { name: "dup-first" }),
    card(1, { name: "dup-second" }),
    card(2),
    card(3, { category: "seafood", dishType: "seafood" }),
    card(4, { cookTime: 45 }),
    card(5, { difficulty: "hard" }),
    card(6, { language: "en" }),
    card(7, { steps: [] }),
    card(8, { hasMedia: false }),
    card(9),
  ];
  const constraints: SelectorConstraints = Object.freeze({
    category: "meat",
    maxCookTime: 30,
    difficulty: "medium",
    language: "zh-TW",
  });
  const before = JSON.stringify(constraints);

  const result = selectCards({
    pool,
    n: 10,
    constraints,
    excludeIds: [2],
    now: NOW,
    seed: 42,
  });

  assert.equal(result.countAfterStep1, 9, "step1 dedupes by id and keeps the first row");
  assert.equal(result.countAfterStep2, 8, "step2 removes excluded ids");
  assert.equal(result.countAfterStep3, 4, "step3 removes category/time/difficulty/language");
  assert.equal(result.countAfterStep4, 4, "missing steps/media are penalties, not violations");
  assert.equal(result.countAfterStep5, 4, "non-combo passes the combination check");
  assert.equal(result.reason, "ok");
  assert.equal(JSON.stringify(constraints), before, "constraints object is read-only");
  assert.deepEqual(
    new Set(pickPath(result)),
    new Set(["1", "7", "8", "9"]),
    "only duplicate/excluded/hard-constraint rows are removed",
  );
  assert.equal(new Set(pickPath(result)).size, pickPath(result).length, "no duplicate ids served");
  assert.ok(result.cards.find((entry) => entry.id === 7), "missing steps is still eligible");
  assert.ok(result.cards.find((entry) => entry.id === 8), "missing media is still eligible");
});

test("seen_penalty_never_hard_excludes", () => {
  const pool = [card(1), card(2)];
  const seen: Record<string, SeenEntry> = {
    "1": { count: 3, lastSeenAt: NOW },
  };
  const constraints: SelectorConstraints = Object.freeze({ category: "meat" });

  const single = selectCards({ pool, n: 1, constraints, seenIndex: seen, now: NOW, seed: 7 });
  assert.equal(single.afterHard, 2, "a heavily seen card is still in the eligible pool");
  assert.equal(single.scores.find((row) => row.id === "1")?.seen, 1, "seen penalty is clamped to 1");

  let seenOnce = false;
  for (let i = 1; i <= 200; i++) {
    const now = NOW + i * 60_000;
    const result = selectCards({
      pool,
      n: 1,
      constraints,
      seenIndex: seen,
      now,
      seed: hashSeed(["seen", i]),
      drawIndex: i,
    });
    const picked = result.cards[0];
    assert.ok(picked, "selector must keep serving while a card is eligible");
    if (String(picked.id) === "1") seenOnce = true;
    const key = String(picked.id);
    const previous = seen[key]?.count ?? 0;
    seen[key] = { count: previous + 1, lastSeenAt: now };
  }
  assert.equal(seenOnce, true, "seen penalty can never remove a card permanently");
});

test("every_card_reachable_multi_seed", () => {
  const pool = CHEF_FIXTURE_POOL as SelectorPoolCard[];
  const constraints: SelectorConstraints = Object.freeze({});
  const seeds = [1, 20261117, 424242];
  const draws = 200;
  const minHits = 5;

  for (const seed of seeds) {
    const seen: Record<string, SeenEntry> = {};
    const hits = new Map<string, number>();

    for (let i = 1; i <= draws; i++) {
      const now = NOW + i * 60_000;
      const result = selectCards({
        pool,
        n: 1,
        constraints,
        seenIndex: seen,
        now,
        seed: hashSeed(["reach", seed, i]),
        drawIndex: i,
      });
      const picked = result.cards[0];
      assert.ok(picked, `seed ${seed} draw ${i} must serve one card`);
      const key = String(picked.id);
      hits.set(key, (hits.get(key) ?? 0) + 1);
      const previous = seen[key]?.count ?? 0;
      seen[key] = { count: previous + 1, lastSeenAt: now };
    }

    const under = CHEF_FIXTURE_POOL.filter((fixture) => (hits.get(String(fixture.id)) ?? 0) < minHits);
    assert.equal(
      under.length,
      0,
      `seed ${seed}: ${under.map((fixture) => `${fixture.name}(id=${fixture.id})=${hits.get(String(fixture.id)) ?? 0}`).join(", ")} need >= ${minHits} hits in ${draws} draws`,
    );
  }
});

test("selection_entropy_and_ratio", () => {
  const pool = CHEF_FIXTURE_POOL as SelectorPoolCard[];
  const constraints: SelectorConstraints = Object.freeze({});
  const seen: Record<string, SeenEntry> = {};
  const hits = new Map<string, number>();
  const draws = 1000;

  for (let i = 1; i <= draws; i++) {
    const now = NOW + i * 60_000;
    const result = selectCards({
      pool,
      n: 1,
      constraints,
      seenIndex: seen,
      now,
      seed: hashSeed(["distribution", i]),
      drawIndex: i,
    });
    const picked = result.cards[0];
    assert.ok(picked, `draw ${i} must serve one card`);
    const key = String(picked.id);
    hits.set(key, (hits.get(key) ?? 0) + 1);
    const previous = seen[key]?.count ?? 0;
    seen[key] = { count: previous + 1, lastSeenAt: now };
  }

  const counts = CHEF_FIXTURE_POOL.map((fixture) => hits.get(String(fixture.id)) ?? 0);
  const max = Math.max(...counts);
  const min = Math.min(...counts);
  const total = counts.reduce((sum, count) => sum + count, 0);
  let entropy = 0;
  for (const count of counts) {
    const probability = count / total;
    if (probability > 0) entropy -= probability * Math.log2(probability);
  }
  const upperBound = Math.log2(CHEF_FIXTURE_POOL.length);
  console.log(
    `[selector-distribution] draws=${draws} min=${min} max=${max} ratio=${(max / min).toFixed(2)} entropy=${entropy.toFixed(3)}/${upperBound.toFixed(3)}`,
  );

  assert.ok(min > 0, "every fixture card must be selected at least once");
  assert.ok(max / min <= 3, `max/min selection ratio ${max}/${min} must be <= 3`);
  assert.ok(entropy >= 4.0, `entropy ${entropy.toFixed(3)} bits must be >= 4.0`);
  assert.ok(entropy <= upperBound + 1e-9, `entropy ${entropy.toFixed(3)} bits must be <= ${upperBound.toFixed(3)}`);
});

function withShadowEnv<T>(fn: () => T): T {
  const prevFlag = process.env.AI_CHEF_SELECTOR_V2;
  const prevSample = process.env.AI_CHEF_SELECTOR_SHADOW_SAMPLE;
  try {
    return fn();
  } finally {
    if (prevFlag === undefined) delete process.env.AI_CHEF_SELECTOR_V2;
    else process.env.AI_CHEF_SELECTOR_V2 = prevFlag;
    if (prevSample === undefined) delete process.env.AI_CHEF_SELECTOR_SHADOW_SAMPLE;
    else process.env.AI_CHEF_SELECTOR_SHADOW_SAMPLE = prevSample;
  }
}

function shadowParams(overrides: Partial<Parameters<typeof shadowCompareSelector>[0]> = {}) {
  return {
    requestId: "user-123@example.com",
    path: "swap:keyword",
    pool: CHEF_FIXTURE_POOL as SelectorPoolCard[],
    n: 1,
    constraints: Object.freeze({}) as SelectorConstraints,
    legacyPickedIds: [1],
    now: NOW,
    seed: 1,
    ...overrides,
  };
}

test("shadow_never_throws_and_logs_no_user_data", () => {
  const dir = mkdtempSync(join(tmpdir(), "selector-shadow-"));
  const file = join(dir, "shadow.jsonl");
  try {
    withShadowEnv(() => {
      process.env.AI_CHEF_SELECTOR_V2 = "1";
      process.env.AI_CHEF_SELECTOR_SHADOW_SAMPLE = "0";
      assert.doesNotThrow(() => shadowCompareSelector(shadowParams({ logFile: file })));
      assert.equal(existsSync(file), false, "sample rate 0 must not write");

      process.env.AI_CHEF_SELECTOR_SHADOW_SAMPLE = "1";
      assert.doesNotThrow(() => shadowCompareSelector(shadowParams({ logFile: file })));
      assert.equal(shadowCompareSelector(shadowParams({ logFile: file })) instanceof Promise, false, "shadow stays synchronous");
      assert.ok(existsSync(file), "sample rate 1 must write");
      const logged = readFileSync(file, "utf8");
      assert.ok(logged.includes("\"requestIdHash\""), "log keeps only the hashed request id");
      assert.equal(logged.includes("user-123@example.com"), false, "raw user id/email must not be logged");
      assert.equal(logged.includes("備料"), false, "recipe steps must not be logged");
      assert.equal(logged.includes("清蒸鱸魚"), false, "recipe names must not be logged");
      assert.doesNotThrow(
        () => shadowCompareSelector(shadowParams({ logFile: file, constraints: null as unknown as SelectorConstraints })),
        "selector failure must be swallowed",
      );
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("shadow_log_hard_cap_stops_writes", () => {
  const dir = mkdtempSync(join(tmpdir(), "selector-shadow-cap-"));
  const file = join(dir, "capped.jsonl");
  try {
    writeFileSync(file, "x\n".repeat(SHADOW_MAX_LINES), "utf8");
    withShadowEnv(() => {
      process.env.AI_CHEF_SELECTOR_V2 = "1";
      process.env.AI_CHEF_SELECTOR_SHADOW_SAMPLE = "1";
      assert.doesNotThrow(() => shadowCompareSelector(shadowParams({ logFile: file })));
    });
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    assert.equal(lines.length, SHADOW_MAX_LINES, "no line is written past the cap");
    assert.equal(lines[lines.length - 1], "x", "existing content is untouched");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("same_seed_same_output_three_paths", () => {
  const pool = CHEF_FIXTURE_POOL as SelectorPoolCard[];
  const constraints: SelectorConstraints = Object.freeze({ category: "soup" });
  const base = {
    pool,
    n: 2,
    constraints,
    excludeIds: [13, "14"],
    seenIndex: { "15": { count: 1, lastSeenAt: NOW - 1000 } } as Record<string, SeenEntry>,
    now: NOW,
    seed: 909090,
    drawIndex: 3,
  };

  const first = selectCards(base);
  const second = selectCards({ ...base });
  selectCards({ ...base, seed: 123 });
  const third = selectCards({ ...base });

  const shape = (result: ReturnType<typeof selectCards>) => ({
    ids: pickPath(result),
    seedUsed: result.seedUsed,
    scores: result.scores.map((row) => ({ id: row.id, raw: row.raw })),
  });
  assert.deepEqual(shape(first), shape(second), "same seed + same input => same output");
  assert.deepEqual(shape(first), shape(third), "prior draws share no mutable state");
  assert.ok(
    base.now - (base.seenIndex["15"]!.lastSeenAt as number) < SELECTOR_SEEN_WINDOW_MS,
    "fixture seen timestamp is inside the 7-day window",
  );
});
