/**
 * P0: READ-ONLY pool coverage measurement.
 *
 * For each of the 9 dish types compare:
 *   - db_total      : rows of that dish_type in the DB
 *   - keyword_pool  : rows the CURRENT swap path can see (keyword search, cap 30)
 *   - full_pool     : rows the P1 full-category path can see (ORDER BY dishType, id)
 *   - distinct_served: distinct cards after 20 simulated swaps (current+sibling excluded)
 *
 * Also simulates 30 chats × 5 swaps to report the same-chat repeat rate for both
 * modes. This script never writes to the DB.
 *
 * Run: npx tsx server/scripts/measurePoolCoverage.ts
 */

import { and, asc, eq, ilike, or } from "drizzle-orm";
import { getDb } from "../db";
import { officialRecipes } from "../../drizzle/schema";
import { FULL_CATEGORY_POOL_LIMIT, orderFullCategoryPool } from "../services/chefPoolFullCategory";

const DISH_TYPES = ["soup", "meat", "seafood", "vegetable", "carb", "appetizer", "dessert", "drink", "other"] as const;
const SWAP_QUERY: Record<string, string> = {
  soup: "湯", meat: "肉", seafood: "海鮮", vegetable: "菜", carb: "麵",
  appetizer: "小食", dessert: "甜品", drink: "飲品", other: "食譜",
};
const KEYWORD_CAP = 30;
const SIM_SWAPS = 20;
const CHATS = 30;
const SWAPS_PER_CHAT = 5;

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

type Row = { id: number; name: string; dishType: string | null };

function overlapRate(ids: number[]): number {
  if (ids.length === 0) return 0;
  return 1 - new Set(ids).size / ids.length;
}

function simulateSwaps(pool: Row[], seed: number): number[] {
  const served: number[] = [];
  let current = pool[0]?.id;
  let sibling = pool[1]?.id;
  for (let i = 0; i < SIM_SWAPS; i++) {
    const exclude = new Set([current, sibling].filter((id): id is number => typeof id === "number"));
    const ordered = orderFullCategoryPool(
      pool.filter((row) => !exclude.has(row.id)),
      { seed: seed + i },
    );
    const next = ordered[0] as Row | undefined;
    if (!next) break;
    served.push(next.id);
    current = next.id;
    sibling = current;
  }
  return served;
}

function simulateChats(pool: Row[], seed: number): number[] {
  const ids: number[] = [];
  for (let chat = 0; chat < CHATS; chat++) {
    for (let turn = 0; turn < SWAPS_PER_CHAT; turn++) {
      const ordered = orderFullCategoryPool(pool, { seed: seed + chat * 31 + turn });
      const pick = ordered[0] as Row | undefined;
      if (pick) ids.push(pick.id);
    }
  }
  return ids;
}

async function keywordPool(db: Db, dishType: string): Promise<Row[]> {
  const kw = SWAP_QUERY[dishType] ?? dishType;
  const like = `%${kw}%`;
  const rows = await db
    .select({ id: officialRecipes.id, name: officialRecipes.name, dishType: officialRecipes.dishType })
    .from(officialRecipes)
    .where(and(
      eq(officialRecipes.isActive, true),
      or(
        ilike(officialRecipes.name, like),
        ilike(officialRecipes.tags, like),
        ilike(officialRecipes.description, like),
        ilike(officialRecipes.ingredients, like),
      ),
    ))
    .limit(KEYWORD_CAP);
  return rows as Row[];
}

async function fullPool(db: Db, dishType: string): Promise<Row[]> {
  const rows = await db
    .select({ id: officialRecipes.id, name: officialRecipes.name, dishType: officialRecipes.dishType })
    .from(officialRecipes)
    .where(and(eq(officialRecipes.isActive, true), eq(officialRecipes.dishType, dishType)))
    .orderBy(asc(officialRecipes.dishType), asc(officialRecipes.id))
    .limit(FULL_CATEGORY_POOL_LIMIT);
  return rows as Row[];
}

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("No DB (DATABASE_URL missing). This measurement needs a read-only DB connection.");
    process.exitCode = 1;
    return;
  }

  const lines: string[] = [];
  lines.push("| type | db_total | keyword_pool | full_pool | distinct_served(keyword/full) | keyword_chat_repeat | full_chat_repeat |");
  lines.push("|---|---|---|---|---|---|---|");

  for (let index = 0; index < DISH_TYPES.length; index++) {
    const type = DISH_TYPES[index];
    const total = await db
      .select({ id: officialRecipes.id })
      .from(officialRecipes)
      .where(and(eq(officialRecipes.isActive, true), eq(officialRecipes.dishType, type)));
    const kw = await keywordPool(db, type);
    const full = await fullPool(db, type);
    const kwServed = simulateSwaps(kw, 10_000 + index * 100);
    const fullServed = simulateSwaps(full, 10_000 + index * 100);
    const kwChat = simulateChats(kw, 20_000 + index * 100);
    const fullChat = simulateChats(full, 20_000 + index * 100);
    lines.push(
      `| ${type} | ${total.length} | ${kw.length} | ${full.length} | ${new Set(kwServed).size}/${new Set(fullServed).size} | ${(overlapRate(kwChat) * 100).toFixed(1)}% | ${(overlapRate(fullChat) * 100).toFixed(1)}% |`,
    );
  }

  console.log(lines.join("\n"));
  console.log(`\nswap_query=${JSON.stringify(SWAP_QUERY)} keyword_cap=${KEYWORD_CAP} full_cap=${FULL_CATEGORY_POOL_LIMIT}`);
  console.log(`chats=${CHATS} swaps_per_chat=${SWAPS_PER_CHAT} sim_swaps=${SIM_SWAPS} (read-only, official recipes only)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
