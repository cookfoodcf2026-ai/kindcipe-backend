/**
 * backfill-ingredient-l10n.ts
 * Fill missing ingredient name translations (dictionary-first + LLM) for all
 * active official + non-draft custom recipes. Reports English coverage.
 *
 * Usage: npx tsx scripts/backfill-ingredient-l10n.ts --dry-run|--write
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });

const WRITE = process.argv.includes("--write");

async function main() {
  const { getDb } = await import("../server/db");
  const { officialRecipes, customRecipes } = await import("../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const { localizeIngredientNames } = await import("../server/utils/recipeTranslations");

  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  async function run(label: string, rows: any[], table: any) {
    let changed = 0, total = 0, missingEnBefore = 0, missingEnAfter = 0;
    for (const r of rows) {
      let arr: any[] = [];
      try { arr = JSON.parse(r.ingredients || "[]"); } catch { arr = []; }
      if (!Array.isArray(arr) || arr.length === 0) continue;
      for (const g of arr) if (g?.name) { total++; if (!g.nameEn) missingEnBefore++; }
      const merged = await localizeIngredientNames(arr);
      if (merged) {
        for (const g of merged) if (g?.name && !g.nameEn) missingEnAfter++;
        if (JSON.stringify(merged) !== JSON.stringify(arr)) {
          if (WRITE) await db.update(table).set({ ingredients: JSON.stringify(merged) }).where(eq(table.id, r.id));
          changed++;
        }
      } else {
        for (const g of arr) if (g?.name && !g.nameEn) missingEnAfter++;
      }
    }
    console.log(`[${label}] recipes=${rows.length} changed=${changed} ingredients=${total} nameEnMissing ${missingEnBefore}→${missingEnAfter}`);
  }

  const official = await db.select().from(officialRecipes).where(eq(officialRecipes.isActive, true));
  const custom = await db.select().from(customRecipes).where(eq(customRecipes.isDraft, false));
  console.log(`[backfill-ingredient-l10n] mode=${WRITE ? "WRITE" : "dry-run"}`);
  await run("official", official, officialRecipes);
  await run("custom", custom, customRecipes);
  process.exit(0);
}
main().catch((e) => { console.error("[backfill-ingredient-l10n] failed:", e); process.exit(1); });
