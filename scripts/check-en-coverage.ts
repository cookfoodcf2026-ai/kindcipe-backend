/**
 * check-en-coverage.ts — CI gate for the English baseline.
 * Every active official + non-draft custom recipe MUST have English content:
 *   nameEn, descriptionEn, stepsEn, and every ingredient nameEn.
 * Exits non-zero if any gap is found.
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });

async function main() {
  const { getDb } = await import("../server/db");
  const { officialRecipes, customRecipes } = await import("../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const official = await db.select().from(officialRecipes).where(eq(officialRecipes.isActive, true));
  const custom = await db.select().from(customRecipes).where(eq(customRecipes.isDraft, false));

  let problems = 0;
  const report: string[] = [];
  const check = (label: string, rows: any[]) => {
    for (const r of rows) {
      const miss: string[] = [];
      if (!r.nameEn) miss.push("nameEn");
      const hasDesc = !!String(r.description ?? "").trim();
      if (hasDesc && !r.descriptionEn) miss.push("descriptionEn");
      let stepCount = 0;
      try {
        stepCount = (JSON.parse(r.steps || "[]") as any[])
          .map((s: any) => (typeof s === "string" ? s : String(s?.instruction ?? s?.text ?? "")))
          .filter((s: string) => s.trim()).length;
      } catch { /* ignore */ }
      if (stepCount > 0 && !r.stepsEn) miss.push("stepsEn");
      let ing = 0;
      try { ing = (JSON.parse(r.ingredients || "[]") as any[]).filter((g) => g?.name && !g.nameEn).length; } catch { /* ignore */ }
      if (ing > 0) miss.push(`ingredients.nameEn x${ing}`);
      if (miss.length) { problems++; report.push(`  ${label} id=${r.id} "${r.name}": ${miss.join(", ")}`); }
    }
  };
  check("official", official);
  check("custom", custom);

  if (problems > 0) {
    console.error(`❌ EN coverage: ${problems} recipe(s) missing English baseline`);
    console.error(report.slice(0, 40).join("\n"));
    process.exit(1);
  }
  console.log(`✅ EN coverage: ${official.length} official + ${custom.length} custom all have nameEn/descriptionEn/stepsEn/ingredient nameEn`);
  process.exit(0);
}
main().catch((e) => { console.error("[check-en-coverage] failed:", e); process.exit(1); });
