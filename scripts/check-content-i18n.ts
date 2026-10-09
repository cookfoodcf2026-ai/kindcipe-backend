/**
 * Content i18n health check: report recipes missing bilingual fields (nameEn / stepsEn).
 * Read-only. Run: npx tsx scripts/check-content-i18n.ts   (from ../kindcipe-backend)
 */
import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const res = await db.execute(sql`
    SELECT 'official' AS src, COUNT(*)::int AS total,
      COUNT(name_en)::int AS name_en, COUNT(name_fil)::int AS name_fil, COUNT(name_id)::int AS name_id,
      COUNT(steps_en)::int AS steps_en, COUNT(steps_fil)::int AS steps_fil, COUNT(steps_id)::int AS steps_id
    FROM official_recipes
    UNION ALL
    SELECT 'custom_kol', COUNT(*)::int,
      COUNT(name_en)::int, COUNT(name_fil)::int, COUNT(name_id)::int,
      COUNT(steps_en)::int, COUNT(steps_fil)::int, COUNT(steps_id)::int
    FROM custom_recipes WHERE source_type IN ('kol','instagram','youtube','xiaohongshu','threads','tiktok')
    UNION ALL
    SELECT 'custom_other', COUNT(*)::int,
      COUNT(name_en)::int, COUNT(name_fil)::int, COUNT(name_id)::int,
      COUNT(steps_en)::int, COUNT(steps_fil)::int, COUNT(steps_id)::int
    FROM custom_recipes WHERE source_type NOT IN ('kol','instagram','youtube','xiaohongshu','threads','tiktok')
  `);
  const rows = ((res as any).rows ?? res) as any[];
  console.table(rows);
  let missing = 0;
  for (const r of rows) {
    const nameGap = Number(r.total) - Number(r.name_en);
    const stepsGap = Number(r.total) - Number(r.steps_en);
    missing += nameGap + stepsGap;
    if (nameGap || stepsGap) console.log(`⚠️ ${r.src}: missing nameEn=${nameGap}, stepsEn=${stepsGap}`);
  }
  console.log(missing ? `\n⚠️ Total missing bilingual fields (en): ${missing}` : "\n✅ All recipes bilingual (en).");
}

main().catch((e) => { console.error(e); process.exit(1); });
