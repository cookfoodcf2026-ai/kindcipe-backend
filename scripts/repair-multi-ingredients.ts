/**
 * Data repair: scan official + custom recipes for "一欄多樣" ingredients
 * (name contains / 、 ； etc.) and split them + recategorize.
 * Also backfill shopping_items category=null with recategorize.
 *
 * Usage: npx tsx scripts/repair-multi-ingredients.ts [--dry]
 */
import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
import { normalizeRecipeIngredients } from "../server/utils/ingredientNormalize";

const dry = process.argv.includes("--dry");

async function repairTable(db: any, table: "official_recipes" | "custom_recipes") {
  const rows = await db.execute(sql`select id, name, ingredients from ${sql.raw(table)}`);
  const list = (rows.rows ?? rows) as { id: number; name: string; ingredients: string | null }[];
  let fixed = 0;
  for (const row of list) {
    if (!row.ingredients) continue;
    let parsed: any;
    try { parsed = JSON.parse(row.ingredients); } catch { continue; }
    if (!Array.isArray(parsed)) continue;
    const normalized = normalizeRecipeIngredients(parsed);
    if (JSON.stringify(normalized) === JSON.stringify(parsed)) continue; // 冇變化
    if (dry) {
      console.log(`[dry] ${table}#${row.id} ${row.name}: ${parsed.length} → ${normalized.length}`);
    } else {
      await db.execute(sql`update ${sql.raw(table)} set ingredients = ${JSON.stringify(normalized)} where id = ${row.id}`);
    }
    fixed++;
  }
  return fixed;
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("no db");
  const o = await repairTable(db, "official_recipes");
  const c = await repairTable(db, "custom_recipes");
  console.log(`official fixed: ${o}, custom fixed: ${c}${dry ? " (dry-run)" : ""}`);
  await db.$client?.end?.();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
