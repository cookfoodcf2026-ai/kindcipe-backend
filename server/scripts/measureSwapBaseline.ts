/**
 * Step-2A baseline: drive the CURRENT production swap path with the in-memory
 * fixture pool. No DB, no LLM. Measures 6 dish categories, cold-start first
 * card distribution, fixture coverage, latency, and a mixed 3+1 meal flow.
 *
 * Run: npx tsx server/scripts/measureSwapBaseline.ts
 */

delete process.env.DATABASE_URL;

import { processAIChefChat } from "../routers/aiRecipe";
import {
  CHEF_FIXTURE_POOL,
  fixtureSearch,
  withSeededRandom,
} from "../services/chefSelector.fixtures";

const SWAPS = 20;
const COLD_RUNS = 20;
const MIX_SWAPS = 10;

type Category = {
  type: "meat" | "seafood" | "vegetable" | "soup" | "carb" | "dessert";
  label: string;
};

const CATEGORIES: Category[] = [
  { type: "meat", label: "肉" },
  { type: "seafood", label: "海鮮" },
  { type: "vegetable", label: "菜" },
  { type: "soup", label: "湯" },
  { type: "carb", label: "麵" },
  { type: "dessert", label: "甜品" },
];

const LABEL_BY_TYPE: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((category) => [category.type, category.label]),
);

const pickedGlobal = new Set<string>();

type SwapCall = {
  seed: number;
  familyId: number;
  label: string;
  type: string;
  excludeNames: string[];
};

async function swapOnce(call: SwapCall) {
  const startedAt = Date.now();
  const result = await withSeededRandom(call.seed, () =>
    processAIChefChat(
      [{ role: "user", content: `換一張 庫內搜尋：${call.label}；同類別：${call.type}` }],
      call.familyId,
      undefined,
      "library",
      call.excludeNames,
      undefined,
      "zh-TW",
      [],
      false,
      {},
      "replace",
      true,
      true,
      fixtureSearch,
    ),
  );
  const ms = Date.now() - startedAt;
  const picked = result.recipes[0] ?? null;
  if (picked?.name) pickedGlobal.add(picked.name);
  return { ms, name: picked?.name ?? null, clarifyReason: result.clarifyReason ?? null };
}

async function mealOnce(seed: number, familyId: number, text = "三餸一湯") {
  const startedAt = Date.now();
  const result = await withSeededRandom(seed, () =>
    processAIChefChat(
      [{ role: "user", content: text }],
      familyId,
      undefined,
      "library",
      [],
      undefined,
      "zh-TW",
      [],
      false,
      {},
      "replace",
      true,
      true,
      fixtureSearch,
    ),
  );
  const ms = Date.now() - startedAt;
  for (const recipe of result.recipes) if (recipe.name) pickedGlobal.add(recipe.name);
  return { ms, result };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

async function measureCategory(category: Category, categoryIndex: number) {
  const rows = CHEF_FIXTURE_POOL.filter((row) => row.dishType === category.type);
  const start = rows[0]!.name;
  const sibling = rows[1]!.name;
  let current = start;
  const seenHistory: string[] = [];
  const picks: Array<{ index: number; name: string | null; recycled: boolean; ms: number }> = [];

  for (let index = 1; index <= SWAPS; index++) {
    const outcome = await swapOnce({
      seed: 300_000 + categoryIndex * 1_000 + index,
      familyId: 500_000 + categoryIndex,
      label: category.label,
      type: category.type,
      excludeNames: [current, sibling].filter(Boolean),
    });
    const recycled = Boolean(outcome.name && seenHistory.includes(outcome.name));
    picks.push({ index, name: outcome.name, recycled, ms: outcome.ms });
    if (outcome.name) {
      current = outcome.name;
      seenHistory.unshift(outcome.name);
    }
  }

  const served = picks.filter((pick) => pick.name);
  const distinct = [...new Set(served.map((pick) => pick.name!))];
  const duplicatePicks = served.length - distinct.length;
  const latencies = picks.map((pick) => pick.ms);

  return {
    type: category.type,
    poolSize: rows.length,
    eligiblePool: Math.max(0, rows.length - 2),
    start,
    sibling,
    served: served.length,
    distinct: distinct.length,
    duplicatePicks,
    repeatRate: served.length === 0 ? 0 : Number((duplicatePicks / served.length).toFixed(4)),
    zeroCards: picks.filter((pick) => !pick.name).length,
    recycled: picks.filter((pick) => pick.recycled).length,
    p50ms: percentile(latencies, 50),
    p95ms: percentile(latencies, 95),
    sequence: picks.map((pick) => pick.name),
  };
}

async function measureColdStart() {
  const firstCounts = new Map<string, number>();
  const sequences: Array<Array<string>> = [];
  for (let i = 0; i < COLD_RUNS; i++) {
    const { result } = await mealOnce(600_000 + i, 700_000 + i);
    const names = result.recipes.map((recipe) => recipe.name);
    sequences.push(names);
    const first = names[0] ?? "<0 cards>";
    firstCounts.set(first, (firstCounts.get(first) ?? 0) + 1);
  }
  return {
    runs: COLD_RUNS,
    distinctFirstCards: firstCounts.size,
    firstCardDistribution: Object.fromEntries(firstCounts),
    sequences,
  };
}

async function measureMixedFlow() {
  const initial = await mealOnce(800_001, 900_001);
  const hand = initial.result.recipes.map((recipe) => ({
    name: recipe.name,
    dishType: recipe.dishType ?? null,
    officialId: recipe.officialId ?? null,
  }));
  for (const card of hand) if (card.name) pickedGlobal.add(card.name);

  const rounds: Array<{
    round: number;
    slot: number;
    swappedOut: string | null;
    swappedIn: string | null;
    hand: string[];
    duplicate: boolean;
    duplicateNames: string[];
  }> = [];

  let duplicates = 0;
  for (let round = 1; round <= MIX_SWAPS; round++) {
    const slot = (round - 1) % hand.length;
    const card = hand[slot]!;
    const type = card.dishType ?? "any";
    const label = LABEL_BY_TYPE[type] ?? type;
    const outcome = await swapOnce({
      seed: 810_000 + round,
      familyId: 900_001,
      label,
      type,
      excludeNames: [card.name],
    });
    const swappedIn = outcome.name;
    if (swappedIn) {
      hand[slot] = { name: swappedIn, dishType: (card.dishType ?? null), officialId: null };
    }
    const names = hand.map((entry) => entry.name);
    const seen = new Set<string>();
    const duplicateNames = names.filter((name) => (seen.has(name) ? true : (seen.add(name), false)));
    if (duplicateNames.length > 0) duplicates += 1;
    rounds.push({
      round,
      slot,
      swappedOut: card.name,
      swappedIn,
      hand: names,
      duplicate: duplicateNames.length > 0,
      duplicateNames: [...new Set(duplicateNames)],
    });
  }

  return { initialHand: initial.result.recipes.map((recipe) => recipe.name), rounds, duplicateRounds: duplicates };
}

function coverage() {
  return CHEF_FIXTURE_POOL.filter((row) => !pickedGlobal.has(row.name)).map((row) => ({
    id: row.id,
    name: row.name,
    dishType: row.dishType,
  }));
}

function printSummary(payload: {
  categories: Awaited<ReturnType<typeof measureCategory>>[];
  coldStart: Awaited<ReturnType<typeof measureColdStart>>;
  unselected: ReturnType<typeof coverage>;
  mixed: Awaited<ReturnType<typeof measureMixedFlow>>;
}) {
  console.log("\n=== 6 類 swap（各 20 次） ===");
  console.log("type       pool served distinct dup repeat zero p50ms p95ms");
  for (const row of payload.categories) {
    console.log(
      `${row.type.padEnd(10)} ${String(row.poolSize).padStart(4)} ${String(row.served).padStart(6)} ${String(row.distinct).padStart(8)} ${String(row.duplicatePicks).padStart(3)} ${row.repeatRate.toFixed(2).padStart(6)} ${String(row.zeroCards).padStart(4)} ${String(row.p50ms).padStart(5)} ${String(row.p95ms).padStart(5)}`,
    );
  }
  console.log("\n=== 冷啟首卡分佈（同 request 20 次） ===");
  console.log(`distinct first cards: ${payload.coldStart.distinctFirstCards}/${payload.coldStart.runs}`);
  console.log(JSON.stringify(payload.coldStart.firstCardDistribution, null, 2));
  console.log("\n=== 24 張 fixture 中 0 次被選 ===");
  if (payload.unselected.length === 0) console.log("(none)");
  for (const row of payload.unselected) console.log(`id=${row.id} ${row.name} (${row.dishType})`);
  console.log("\n=== 三餸一湯混合 flow（連換 10 次） ===");
  console.log(`duplicate rounds: ${payload.mixed.duplicateRounds}/${payload.mixed.rounds.length}`);
  for (const round of payload.mixed.rounds) {
    console.log(
      `#${String(round.round).padStart(2, "0")} out=${round.swappedOut} in=${round.swappedIn ?? "<0>"} dup=${round.duplicate ? round.duplicateNames.join(",") : "-"} hand=${round.hand.join(" | ")}`,
    );
  }
}

async function main() {
  const categories = [];
  for (let i = 0; i < CATEGORIES.length; i++) {
    categories.push(await measureCategory(CATEGORIES[i]!, i));
  }
  const coldStart = await measureColdStart();
  const mixed = await measureMixedFlow();
  const unselected = coverage();

  const payload = {
    generatedAt: new Date().toISOString(),
    swapsPerCategory: SWAPS,
    coldRuns: COLD_RUNS,
    mixSwaps: MIX_SWAPS,
    categories,
    coldStart,
    unselectedCount: unselected.length,
    unselected,
    mixed,
  };

  console.log("=== JSON ===");
  console.log(JSON.stringify(payload, null, 2));
  printSummary({ categories, coldStart, unselected, mixed });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
