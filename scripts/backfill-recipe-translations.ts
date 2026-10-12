/**
 * backfill-recipe-translations.ts
 * Fill missing name/description/steps (+ingredient) translations via
 * buildTranslationPatch (idempotent — only fills gaps).
 *
 * Usage: npx tsx scripts/backfill-recipe-translations.ts --dry-run|--write
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });

const WRITE = process.argv.includes("--write");

async function main() {
  const { getDb } = await import("../server/db");
  const { officialRecipes, customRecipes } = await import("../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const { buildTranslationPatch } = await import("../server/utils/recipeTranslations");

  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  async function run(label: string, rows: any[], table: any) {
    let patched = 0;
    for (const r of rows) {
      try {
        const patch = await buildTranslationPatch(r as any);
        if (Object.keys(patch).length > 0) {
          if (WRITE) await db.update(table).set(patch as any).where(eq(table.id, r.id));
          patched++;
        }
      } catch (e) {
        console.warn(`[${label}] patch failed id=${r.id}:`, (e as Error)?.message);
      }
    }
    console.log(`[${label}] rows=${rows.length} patched=${patched}`);
  }

  const official = await db.select().from(officialRecipes).where(eq(officialRecipes.isActive, true));
  const custom = await db.select().from(customRecipes).where(eq(customRecipes.isDraft, false));
  console.log(`[backfill-recipe-translations] mode=${WRITE ? "WRITE" : "dry-run"}`);
  await run("official", official, officialRecipes);
  await run("custom", custom, customRecipes);
  process.exit(0);
}
main().catch((e) => { console.error("[backfill-recipe-translations] failed:", e); process.exit(1); });
