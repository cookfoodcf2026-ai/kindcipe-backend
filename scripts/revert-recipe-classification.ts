/**
 * revert-recipe-classification.ts
 * 用 backfill-recipe-classification.ts 寫入前嘅備份 JSON，還原 recipeCategory / dishType。
 *
 * 用法：
 *   npx tsx scripts/revert-recipe-classification.ts scripts/data/classification-backup-<ts>.json --dry-run
 *   npx tsx scripts/revert-recipe-classification.ts scripts/data/classification-backup-<ts>.json --write
 */
import { config } from "dotenv";
import { resolve } from "path";
import { readFileSync } from "fs";
config({ path: resolve(process.cwd(), ".env") });

const { eq } = await import("drizzle-orm");
const { getDb } = await import("../server/db");
const { customRecipes, officialRecipes } = await import("../drizzle/schema");

type Row = { table: string; id: any; recipeCategory: any; dishType: any };

async function main() {
  const argv = process.argv.slice(2);
  const file = argv.find((a) => !a.startsWith("--"));
  const write = argv.includes("--write");
  if (!file) {
    console.error("用法: npx tsx scripts/revert-recipe-classification.ts <backup.json> [--write]");
    process.exit(1);
  }

  let rows: Row[];
  try {
    rows = JSON.parse(readFileSync(resolve(process.cwd(), file), "utf8"));
  } catch (e) {
    console.error("讀取備份失敗:", (e as Error).message);
    process.exit(1);
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    console.error("備份為空或格式錯誤");
    process.exit(1);
  }

  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  console.log(`備份檔: ${file}（${rows.length} rows）`, write ? "⚠️ WRITE" : "DRY-RUN");

  const tableOf = (t: string) => (t === "official" ? officialRecipes : customRecipes);

  let ok = 0;
  let failed = 0;
  for (const r of rows) {
    const label = r.table === "official" ? "official" : "custom";
    console.log(`[${write ? "WRITE" : "DRY "}] ${label}/${r.id} → cat: ${r.recipeCategory ?? "-"} dish: ${r.dishType ?? "-"}`);
    if (write) {
      try {
        await db
          .update(tableOf(label))
          .set({ recipeCategory: r.recipeCategory, dishType: r.dishType })
          .where(eq(tableOf(label).id, r.id));
        ok++;
      } catch (e) {
        failed++;
        console.error(`[ERR] ${label}/${r.id}:`, (e as Error)?.message);
      }
    }
  }

  console.log("\n===== report =====");
  console.log(JSON.stringify({ total: rows.length, restored: ok, failed }, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
