/**
 * backfill-official-ingredients.ts
 * Fill missing ingredient translations (nameEn/nameFil/nameId) in
 * official_recipes.ingredients.
 *
 * Pass 1: common-ingredient dictionary (free).
 * Pass 2 (--llm): LLM-translate remaining rare/brand names (batched).
 *
 * Usage:
 *   npx tsx scripts/backfill-official-ingredients.ts --dry-run
 *   npx tsx scripts/backfill-official-ingredients.ts --write
 *   npx tsx scripts/backfill-official-ingredients.ts --write --llm
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });

const WRITE = process.argv.includes("--write");
const LLM = process.argv.includes("--llm");
const LIMIT = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1] || 0) || undefined;

async function main() {
  const { getDb, resolveCommonIngredientByName } = await import("../server/db");
  const { officialRecipes } = await import("../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const { translateIngredientNames } = await import("../server/utils/translateContent");

  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  let rows = await db
    .select({ id: officialRecipes.id, name: officialRecipes.name, ingredients: officialRecipes.ingredients })
    .from(officialRecipes)
    .where(eq(officialRecipes.isActive, true));
  if (LIMIT) rows = rows.slice(0, LIMIT);

  const parsed = rows.map((r) => {
    let arr: any[] = [];
    try { arr = Array.isArray(r.ingredients) ? (r.ingredients as any) : JSON.parse(r.ingredients as any); } catch { arr = []; }
    return { id: r.id, arr: Array.isArray(arr) ? arr : [] };
  });

  let dictFilled = 0;
  const missing = new Map<string, Set<{ id: number; ing: any }>>();

  // Pass 1: dictionary
  for (const { id, arr } of parsed) {
    for (const ing of arr) {
      const nm = String(ing?.name ?? "").trim();
      if (!nm) continue;
      if (ing.nameEn && ing.nameFil && ing.nameId) continue;
      const ci: any = await resolveCommonIngredientByName(nm);
      if (ci?.nameEn) ing.nameEn = ing.nameEn || ci.nameEn;
      if (ci?.nameFil) ing.nameFil = ing.nameFil || ci.nameFil;
      if (ci?.nameId) ing.nameId = ing.nameId || ci.nameId;
      if (ing.nameEn && ing.nameFil && ing.nameId) {
        dictFilled++;
      } else {
        if (!missing.has(nm)) missing.set(nm, new Set());
        missing.get(nm)!.add({ id, ing });
      }
    }
  }

  let llmFilled = 0;
  let llmMissingNames = missing.size;

  // Pass 2: LLM for remaining names
  if (LLM && missing.size > 0) {
    const names = [...missing.keys()];
    const missingIngs: any[] = [];
    for (const targets of missing.values()) for (const t of targets) missingIngs.push(t.ing);
    const BATCH = 40;
    for (let i = 0; i < names.length; i += BATCH) {
      const batch = names.slice(i, i + BATCH);
      const translated = await translateIngredientNames(batch);
      batch.forEach((nm, j) => {
        const tr = translated[j] || {};
        const targets = missing.get(nm)!;
        for (const { ing } of targets) {
          if (tr.en) ing.nameEn = ing.nameEn || tr.en;
          if (tr.fil) ing.nameFil = ing.nameFil || tr.fil;
          if (tr.id) ing.nameId = ing.nameId || tr.id;
        }
      });
      console.log(`[backfill] LLM batch ${i / BATCH + 1}/${Math.ceil(names.length / BATCH)} done`);
    }
    for (const ing of missingIngs) {
      if (ing.nameEn && ing.nameFil && ing.nameId) llmFilled++;
    }
    const still = missingIngs.filter((ing) => !(ing.nameEn && ing.nameFil && ing.nameId)).length;
    llmMissingNames = still;
  }

  let recsChanged = 0;
  if (WRITE) {
    for (const { id, arr } of parsed) {
      if (arr.length === 0) continue;
      await db.update(officialRecipes).set({ ingredients: JSON.stringify(arr) } as any).where(eq(officialRecipes.id, id));
      recsChanged++;
    }
  }

  console.log(
    `[backfill-official-ingredients] rows=${rows.length} recipesWritten=${recsChanged} dictFilled=${dictFilled} ` +
      `llm=${LLM ? "on" : "off"} llmFilledTotal=${llmFilled} stillMissing=${LLM ? llmMissingNames : "n/a"} (mode: ${WRITE ? "WRITE" : "dry-run"})`
  );
  process.exit(0);
}
main().catch((e) => { console.error("[backfill] failed:", e); process.exit(1); });
