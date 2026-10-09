/**
 * Translation lifecycle backfill: fill missing name/steps/description +
 * ingredient-name translations for existing recipes (en/fil/id).
 *
 * Idempotent — only fills gaps, never overwrites. Uses the same
 * buildTranslationPatch as create/update/on-demand, so behaviour is identical.
 *
 * Usage:
 *   npx tsx scripts/backfill-translations.ts                 # dry-run (both)
 *   npx tsx scripts/backfill-translations.ts --commit
 *   npx tsx scripts/backfill-translations.ts --only=official --commit
 *   npx tsx scripts/backfill-translations.ts --only=custom --limit=50 --commit
 */
import "dotenv/config";
import { getDb } from "../server/db";
import { eq } from "drizzle-orm";
import { customRecipes, officialRecipes } from "../drizzle/schema";
import { buildTranslationPatch } from "../server/utils/recipeTranslations";

const COMMIT = process.argv.includes("--commit");
const onlyArg = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];
const limitArg = process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1];
const LIMIT = limitArg ? parseInt(limitArg, 10) : undefined;
const concArg = process.argv.find((a) => a.startsWith("--concurrency="))?.split("=")[1];
const CONCURRENCY = concArg ? Math.max(1, parseInt(concArg, 10)) : 5;

async function processTable(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  kind: "official" | "custom",
) {
  const table = kind === "official" ? officialRecipes : customRecipes;
  const rows = await db.select().from(table);
  const targets = rows.filter((r: any) => {
    const stepsMissing = !r.stepsEn || !r.stepsFil || !r.stepsId;
    const nameMissing = !r.nameEn || !r.nameFil || !r.nameId;
    const ingMissing = (() => {
      try {
        const arr = r.ingredients ? JSON.parse(r.ingredients) : [];
        return Array.isArray(arr) && arr.some((i: any) => i?.name && (!i.nameEn || !i.nameFil || !i.nameId));
      } catch { return false; }
    })();
    return nameMissing || stepsMissing || ingMissing;
  });

  const limited = LIMIT ? targets.slice(0, LIMIT) : targets;
  console.log(`\n[${kind}] total=${rows.length} need-backfill=${limited.length}${LIMIT ? ` (limit ${LIMIT})` : ""}`);
  if (!COMMIT) return limited.length;

  let done = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < limited.length) {
      const r = limited[cursor++];
      try {
        const patch = await buildTranslationPatch(r as any);
        if (Object.keys(patch).length === 0) { console.log(`  #${r.id} skipped (no patch)`); continue; }
        await db.update(table).set(patch as any).where(eq((table as any).id, r.id));
        done++;
        console.log(`  #${r.id} updated (${Object.keys(patch).join(",")})`);
      } catch (e) {
        console.warn(`  #${r.id} FAILED: ${(e as Error)?.message}`);
      }
      await new Promise((res) => setTimeout(res, 300));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`[${kind}] DONE updated ${done}/${limited.length}`);
  return done;
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  if (!COMMIT) console.log("DRY-RUN (pass --commit to apply)");
  if (!onlyArg || onlyArg === "official") await processTable(db, "official");
  if (!onlyArg || onlyArg === "custom") await processTable(db, "custom");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
