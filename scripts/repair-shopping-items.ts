/**
 * Backfill shopping_items: recategorize null/"其他"-category items.
 * (Multi-name split is handled by frontend display insurance — we don't split DB rows.)
 * Usage: npx tsx scripts/repair-shopping-items.ts [--dry]
 */
import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
import { categorizeIngredientName } from "../server/utils/ingredientNormalize";

const dry = process.argv.includes("--dry");

async function main() {
  const db = await getDb();
  if (!db) throw new Error("no db");
  const rows = await db.execute(sql`select id, name, category from shopping_items`);
  const list = (rows.rows ?? rows) as { id: number; name: string; category: string | null }[];
  let fixed = 0;
  for (const row of list) {
    if (row.category && row.category !== "其他") continue; // 已有明確類別
    const guessed = categorizeIngredientName(row.name);
    if (guessed === "其他") continue; // 真係分唔到，唔郁
    if (dry) {
      console.log(`[dry] #${row.id} "${row.name}" → ${guessed}`);
    } else {
      await db.execute(sql`update shopping_items set category = ${guessed} where id = ${row.id}`);
    }
    fixed++;
  }
  console.log(`recategorized: ${fixed}${dry ? " (dry-run)" : ""}`);
  await db.$client?.end?.();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
