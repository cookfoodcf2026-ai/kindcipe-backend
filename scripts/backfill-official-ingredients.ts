/**
 * backfill-official-ingredients.ts
 * Fill missing ingredient translations (nameEn/nameFil/nameId) in
 * official_recipes.ingredients using the common-ingredient dictionary.
 *
 * Usage:
 *   npx tsx scripts/backfill-official-ingredients.ts --dry-run
 *   npx tsx scripts/backfill-official-ingredients.ts --write
 *   npx tsx scripts/backfill-official-ingredients.ts --write --limit=50
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });

const WRITE = process.argv.includes("--write");
const LIMIT = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1] || 0) || undefined;

async function main() {
  const { getDb } = await import("../server/db");
  const { resolveCommonIngredientByName } = await import("../server/db");
  const { officialRecipes } = await import("../drizzle/schema");
  const { eq } = await import("drizzle-orm");

  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  let rows = await db.select({ id: officialRecipes.id, name: officialRecipes.name, ingredients: officialRecipes.ingredients }).from(officialRecipes).where(eq(officialRecipes.isActive, true));
  if (LIMIT) rows = rows.slice(0, LIMIT);

  let recsChanged = 0, ingsFilled = 0, ingsMissed = 0;
  for (const r of rows) {
    let arr: any[] = [];
    try { arr = Array.isArray(r.ingredients) ? (r.ingredients as any) : JSON.parse(r.ingredients as any); } catch { arr = []; }
    if (!Array.isArray(arr) || arr.length === 0) continue;
    let changed = false;
    for (const ing of arr) {
      const nm = String(ing?.name ?? "").trim();
      if (!nm) continue;
      if (ing.nameEn && ing.nameFil && ing.nameId) continue;
      const ci: any = await resolveCommonIngredientByName(nm);
      if (ci?.nameEn) { ing.nameEn = ing.nameEn || ci.nameEn; }
      if (ci?.nameFil) { ing.nameFil = ing.nameFil || ci.nameFil; }
      if (ci?.nameId) { ing.nameId = ing.nameId || ci.nameId; }
      if (ing.nameEn && ing.nameFil && ing.nameId) ingsFilled++;
      else ingsMissed++;
      changed = true;
    }
    if (WRITE && changed) {
      await db.update(officialRecipes).set({ ingredients: JSON.stringify(arr) } as any).where(eq(officialRecipes.id, r.id));
      recsChanged++;
    }
  }
  console.log(`[backfill-official-ingredients] rows=${rows.length} recipesChanged=${recsChanged} ingredientsFilled=${ingsFilled} stillMissing=${ingsMissed} (mode: ${WRITE ? "WRITE" : "dry-run"})`);
  process.exit(0);
}
main().catch((e) => { console.error("[backfill] failed:", e); process.exit(1); });
