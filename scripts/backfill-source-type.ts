/**
 * backfill-source-type.ts
 * 一次性修正舊 custom_recipes 嘅 source_type：
 *   - Facebook / fb.watch / fb.me 連結，之前存成 "manual" → "facebook"
 *   - 其他網頁連結（非社交白名單），之前存成 "manual" → "import"
 *   （文字貼上／截圖冇 source_url，無法追溯辨識 → 維持 "manual"）
 *
 * 用法：
 *   npx tsx scripts/backfill-source-type.ts --dry-run
 *   npx tsx scripts/backfill-source-type.ts --write
 *
 * Rollback（緊急）：
 *   UPDATE custom_recipes SET source_type='manual' WHERE source_type IN ('facebook','import');
 */
import { config } from "dotenv";
import { resolve } from "path";
import postgres from "postgres";

config({ path: resolve(process.cwd(), ".env") });

const WRITE = process.argv.includes("--write");
const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 1 });

const FB_WHERE = `source_type = 'manual' AND source_url IS NOT NULL AND source_url <> '' AND (source_url ILIKE '%facebook.com%' OR source_url ILIKE '%fb.watch%' OR source_url ILIKE '%fb.me%')`;
const IMPORT_WHERE = `source_type = 'manual' AND source_url IS NOT NULL AND source_url <> '' AND NOT (source_url ILIKE '%facebook.com%' OR source_url ILIKE '%fb.watch%' OR source_url ILIKE '%fb.me%')`;

async function main() {
  const fbCount = await sql.unsafe(`SELECT COUNT(*)::int AS n FROM custom_recipes WHERE ${FB_WHERE}`);
  const impCount = await sql.unsafe(`SELECT COUNT(*)::int AS n FROM custom_recipes WHERE ${IMPORT_WHERE}`);
  console.log(`[backfill-source-type] facebook → ${fbCount[0].n}, import → ${impCount[0].n} (mode: ${WRITE ? "WRITE" : "dry-run"})`);

  if (!WRITE) {
    console.log("Dry-run only. Re-run with --write to apply.");
    await sql.end();
    return;
  }

  const fb = await sql.unsafe(`UPDATE custom_recipes SET source_type='facebook' WHERE ${FB_WHERE} RETURNING id`);
  const imp = await sql.unsafe(`UPDATE custom_recipes SET source_type='import' WHERE ${IMPORT_WHERE} RETURNING id`);
  console.log(`[backfill-source-type] ✅ updated facebook=${fb.length}, import=${imp.length}`);
  await sql.end();
}

main().catch(async (e) => {
  console.error("[backfill-source-type] failed:", e);
  await sql.end();
  process.exit(1);
});
