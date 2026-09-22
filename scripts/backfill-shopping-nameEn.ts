/**
 * Backfill nameEn on shopping items that are missing it, by resolving the
 * Chinese `name` to a common ingredient (exact → contains).
 * Idempotent. Run against Railway DB via DATABASE_URL in .env.
 *
 * Run:  npx tsx scripts/backfill-shopping-nameEn.ts   (from ../kindcipe-backend)
 */
import "dotenv/config";
import { getDb } from "../server/db";
import { eq, isNull } from "drizzle-orm";
import { shoppingItems, commonIngredients } from "../drizzle/schema";

const norm = (s: string) => s.replace(/\s+/g, "").replace(/[，,。．.、()（）【】\[\]《》]/g, "").trim();

function buildLookup(all: { nameZh: string; nameYue: string; nameEn: string | null }[]) {
  const byName = new Map<string, string | null>();
  const sorted: { k: string; en: string }[] = [];
  for (const c of all) {
    const en = c.nameEn;
    if (c.nameZh) byName.set(norm(c.nameZh), en);
    if (c.nameYue) byName.set(norm(c.nameYue), en);
    if (en && c.nameZh) sorted.push({ k: norm(c.nameZh), en });
  }
  sorted.sort((a, b) => b.k.length - a.k.length);
  const resolve = (q: string): string | null => {
    if (!q) return null;
    const nq = norm(q);
    if (byName.has(nq)) return byName.get(nq) ?? null;
    for (const { k, en } of sorted) {
      if (k.length < 2) continue;
      if (nq.includes(k) || k.includes(nq)) return en;
    }
    return null;
  };
  return resolve;
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const all = await db.select().from(commonIngredients);
  const resolve = buildLookup(all as any[]);

  const rows = await db
    .select({ id: shoppingItems.id, name: shoppingItems.name })
    .from(shoppingItems)
    .where(isNull(shoppingItems.nameEn));
  console.log(`Shopping items missing nameEn: ${rows.length}`);

  const updates: { id: number; nameEn: string }[] = [];
  for (const row of rows) {
    const en = resolve(row.name);
    if (en) updates.push({ id: row.id, nameEn: en });
  }
  console.log(`Resolvable: ${updates.length}`);

  // Batch update (each row has its own nameEn)
  const CHUNK = 500;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    for (const u of chunk) {
      await db.update(shoppingItems).set({ nameEn: u.nameEn }).where(eq(shoppingItems.id, u.id));
    }
    console.log(`  chunk ${i / CHUNK + 1} done (${chunk.length})`);
  }
  console.log(`Done. Updated ${updates.length} items.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
