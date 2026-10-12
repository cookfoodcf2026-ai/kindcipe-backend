/**
 * backfill-scenario-tags.ts
 * Recompute `scenario_tags` for every official + custom recipe using the
 * deterministic rules in server/utils/scenario.ts, and report hotkey coverage.
 *
 * Usage:
 *   npx tsx scripts/backfill-scenario-tags.ts --dry-run
 *   npx tsx scripts/backfill-scenario-tags.ts --write
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });

const WRITE = process.argv.includes("--write");

async function main() {
  const { getDb } = await import("../server/db");
  const { officialRecipes, customRecipes } = await import("../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const { computeScenarioTags, ALL_SCENARIOS } = await import("../server/utils/scenario");

  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  async function processTable(label: string, rows: any[], table: any) {
    let changed = 0;
    const coverage: Record<string, number> = { "(none)": 0 };
    for (const s of ALL_SCENARIOS) coverage[s] = 0;

    for (const r of rows) {
      const st = computeScenarioTags({
        name: r.name, description: r.description, cookTime: r.cookTime,
        difficulty: r.difficulty, recipeCategory: r.recipeCategory, dishType: r.dishType,
        ingredients: r.ingredients, steps: r.steps, tags: r.tags,
      });
      const tags: string[] = JSON.parse(st);
      if (tags.length === 0) coverage["(none)"]++;
      for (const t of tags) coverage[t]++;
      if (st !== r.scenarioTags) {
        if (WRITE) await db.update(table).set({ scenarioTags: st }).where(eq(table.id, r.id));
        changed++;
      }
    }
    const total = rows.length || 1;
    const none = coverage["(none)"];
    console.log(`\n[${label}] rows=${rows.length} changed=${changed}`);
    for (const s of ALL_SCENARIOS) {
      console.log(`  ${s.padEnd(12)} ${coverage[s]} (${((coverage[s] / total) * 100).toFixed(1)}%)`);
    }
    console.log(`  ${"(none)".padEnd(12)} ${none} (${((none / total) * 100).toFixed(1)}%)`);
    console.log(`  coverage(≥1)  ${(((rows.length - none) / total) * 100).toFixed(1)}%`);
    return { changed, none };
  }

  const official = await db.select().from(officialRecipes).where(eq(officialRecipes.isActive, true));
  const custom = await db.select().from(customRecipes).where(eq(customRecipes.isDraft, false));

  console.log(`[backfill-scenario-tags] mode=${WRITE ? "WRITE" : "dry-run"}`);
  await processTable("official_recipes (active)", official, officialRecipes);
  await processTable("custom_recipes (non-draft)", custom, customRecipes);
  process.exit(0);
}
main().catch((e) => { console.error("[backfill-scenario-tags] failed:", e); process.exit(1); });
