/**
 * backfill-shopping-l10n.ts
 * Fill missing shopping_items name translations (dictionary first, then LLM).
 * Reports English coverage.
 *
 * Usage: npx tsx scripts/backfill-shopping-l10n.ts --dry-run|--write
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });

const WRITE = process.argv.includes("--write");

async function main() {
  const { getDb, resolveIngredientL10n } = await import("../server/db");
  const { shoppingItems } = await import("../drizzle/schema");
  const { eq } = await import("drizzle-orm");

  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const rows = await db.select().from(shoppingItems);
  let changed = 0, missingBefore = 0, missingAfter = 0;
  for (const r of rows) {
    if (!r.nameEn) missingBefore++;
    if (r.nameEn && r.nameFil && r.nameId) continue;
    const l10n = await resolveIngredientL10n(String(r.name), (r as any).commonIngredientId ?? null);
    const nameEn = r.nameEn || l10n.nameEn || undefined;
    const nameFil = r.nameFil || l10n.nameFil || undefined;
    const nameId = r.nameId || l10n.nameId || undefined;
    if (!nameEn) missingAfter++;
    const patch: any = {};
    if (nameEn && !r.nameEn) patch.nameEn = nameEn;
    if (nameFil && !r.nameFil) patch.nameFil = nameFil;
    if (nameId && !r.nameId) patch.nameId = nameId;
    if (Object.keys(patch).length > 0) {
      if (WRITE) await db.update(shoppingItems).set(patch).where(eq(shoppingItems.id, r.id));
      changed++;
    }
  }
  console.log(`[backfill-shopping-l10n] mode=${WRITE ? "WRITE" : "dry-run"} rows=${rows.length} changed=${changed} nameEnMissing ${missingBefore}->${missingAfter}`);
  process.exit(0);
}
main().catch((e) => { console.error("[backfill-shopping-l10n] failed:", e); process.exit(1); });
