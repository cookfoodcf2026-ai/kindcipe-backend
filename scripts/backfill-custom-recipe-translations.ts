/**
 * Backfill missing bilingual fields (name / steps / description) on existing
 * custom_recipes rows, using the shared translateRecipeContent helper.
 *
 * Usage:
 *   npx tsx scripts/backfill-custom-recipe-translations.ts            # dry-run
 *   npx tsx scripts/backfill-custom-recipe-translations.ts --commit
 *   npx tsx scripts/backfill-custom-recipe-translations.ts --all      # include junk-looking names
 */
import "dotenv/config";
import { getDb } from "../server/db";
import { eq } from "drizzle-orm";
import { customRecipes } from "../drizzle/schema";
import { translateRecipeContent } from "../server/utils/translateContent";

const COMMIT = process.argv.includes("--commit");
const INCLUDE_JUNK = process.argv.includes("--all");
const CONCURRENCY = 1;

function stepsToText(steps: unknown): string[] {
  let arr: unknown = steps;
  if (typeof arr === "string") {
    try {
      arr = JSON.parse(arr);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((s: any) => (typeof s === "string" ? s : String(s?.instruction ?? s?.description ?? s?.step ?? "")))
    .map((s) => s.trim())
    .filter(Boolean);
}

function isJunkName(name: string): boolean {
  const n = (name ?? "").trim();
  if (!n) return true;
  if (/^(未命名|unnamed|draft|test|新食譜)/i.test(n)) return true;
  if (/^[\x00-\x7F]{1,4}$/.test(n)) return true; // short ASCII placeholders e.g. "Nbn", "Rde"
  return false;
}

async function main() {
  const db = await getDb();

  const rows = await db
    .select({
      id: customRecipes.id,
      name: customRecipes.name,
      steps: customRecipes.steps,
      nameEn: customRecipes.nameEn,
      nameFil: customRecipes.nameFil,
      nameId: customRecipes.nameId,
      stepsEn: customRecipes.stepsEn,
      stepsFil: customRecipes.stepsFil,
      stepsId: customRecipes.stepsId,
    })
    .from(customRecipes);

  const targets = rows.filter((r) => {
    const missing = !r.nameEn || !r.stepsEn;
    if (!missing) return false;
    if (!INCLUDE_JUNK && isJunkName(r.name ?? "")) return false;
    return stepsToText(r.steps).length > 0;
  });

  console.log(`custom recipes: ${rows.length}`);
  console.log(`need backfill : ${targets.length}${INCLUDE_JUNK ? "" : " (junk names skipped)"}`);
  for (const t of targets) console.log(`  #${t.id} ${t.name}`);

  if (!COMMIT) {
    console.log("\nDRY-RUN. Re-run with --commit to apply.");
    return;
  }

  let done = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < targets.length) {
      const t = targets[cursor++];
      const steps = stepsToText(t.steps);
      try {
        const tr = await translateRecipeContent(t.name ?? "", steps);
        const patch: Record<string, string | null> = {};
        if (!t.nameEn && tr.nameEn) patch.nameEn = tr.nameEn;
        if (!t.nameFil && tr.nameFil) patch.nameFil = tr.nameFil;
        if (!t.nameId && tr.nameId) patch.nameId = tr.nameId;
        if (!t.stepsEn && tr.stepsEn) patch.stepsEn = JSON.stringify(tr.stepsEn);
        if (!t.stepsFil && tr.stepsFil) patch.stepsFil = JSON.stringify(tr.stepsFil);
        if (!t.stepsId && tr.stepsId) patch.stepsId = JSON.stringify(tr.stepsId);
        if (Object.keys(patch).length === 0) {
          console.warn(`  #${t.id} no translation returned`);
          continue;
        }
        await db.update(customRecipes).set(patch as any).where(eq(customRecipes.id, t.id));
        done++;
        console.log(`  #${t.id} updated (${Object.keys(patch).join(",")})`);
      } catch (e) {
        console.warn(`  #${t.id} FAILED: ${(e as Error)?.message}`);
      }
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`\nDONE. updated ${done}/${targets.length}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
