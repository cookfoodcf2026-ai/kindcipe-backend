/**
 * One-time cleanup: delete stale (past-dated, non-bought) shopping items for a specific family.
 * Backs up the rows to a JSON file first.
 *
 * Run:  npx tsx scripts/cleanup-family-stale-items.ts <familyId>   (from ../kindcipe-backend)
 */
import "dotenv/config";
import * as fs from "fs";
import { getDb } from "../server/db";
import { shoppingItems } from "../drizzle/schema";
import { and, eq, ne, isNotNull, lt, inArray } from "drizzle-orm";

async function main() {
  const familyId = Number(process.argv[2]);
  if (!familyId) throw new Error("Usage: tsx scripts/cleanup-family-stale-items.ts <familyId>");
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const today = new Date().toISOString().slice(0, 10);

  const rows = await db
    .select()
    .from(shoppingItems)
    .where(
      and(
        eq(shoppingItems.familyId, familyId),
        ne(shoppingItems.status, "bought"),
        isNotNull(shoppingItems.plannedDate),
        lt(shoppingItems.plannedDate, today)
      )
    );

  console.log(`Family #${familyId}: ${rows.length} stale (past-dated, non-bought) items`);
  if (rows.length === 0) { console.log("Nothing to delete."); return; }

  const backupPath = `/tmp/cleanup-family-${familyId}-stale-items-${Date.now()}.json`;
  fs.writeFileSync(backupPath, JSON.stringify(rows, null, 2));
  console.log(`Backup written: ${backupPath}`);

  const ids = rows.map((r) => r.id);
  const CHUNK = 500;
  let deleted = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const res = await db.delete(shoppingItems).where(inArray(shoppingItems.id, chunk)).returning({ id: shoppingItems.id });
    deleted += res.length;
  }
  console.log(`Deleted ${deleted} items.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
