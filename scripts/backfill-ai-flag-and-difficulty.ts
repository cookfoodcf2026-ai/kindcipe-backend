/**
 * backfill-ai-flag-and-difficulty.ts
 * 1) custom_recipes.is_ai_generated：按 tags 含「AI 生成」補 true（冪等）
 * 2) difficulty 統一 canonical（Medium/Easy/Hard/數字/簡體 → 簡單/中等/困難）
 *
 * 用法：
 *   npx tsx scripts/backfill-ai-flag-and-difficulty.ts --dry-run
 *   npx tsx scripts/backfill-ai-flag-and-difficulty.ts --write
 *
 * Rollback（緊急）：
 *   UPDATE custom_recipes SET is_ai_generated=false WHERE tags LIKE '%"AI 生成"%';
 */
import { config } from "dotenv";
import { resolve } from "path";
import postgres from "postgres";

config({ path: resolve(process.cwd(), ".env") });

const WRITE = process.argv.includes("--write");
const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 1 });

const EASY = "('easy','beginner','1','简单')";
const MED  = "('medium','intermediate','2')";
const HARD = "('hard','advanced','3','困难')";

async function main() {
  const ai = await sql.unsafe(`SELECT COUNT(*)::int n FROM custom_recipes WHERE is_ai_generated=false AND tags LIKE '%"AI 生成"%'`);
  const dCustom = await sql.unsafe(`SELECT COUNT(*)::int n FROM custom_recipes WHERE lower(difficulty) IN ${EASY} OR lower(difficulty) IN ${MED} OR lower(difficulty) IN ${HARD}`);
  const dOfficial = await sql.unsafe(`SELECT COUNT(*)::int n FROM official_recipes WHERE lower(difficulty) IN ${EASY} OR lower(difficulty) IN ${MED} OR lower(difficulty) IN ${HARD}`);
  console.log(`[backfill] ai_flag=${ai[0].n} custom_diff=${dCustom[0].n} official_diff=${dOfficial[0].n} (mode: ${WRITE ? "WRITE" : "dry-run"})`);

  if (!WRITE) { await sql.end(); return; }

  const a = await sql.unsafe(`UPDATE custom_recipes SET is_ai_generated=true WHERE is_ai_generated=false AND tags LIKE '%"AI 生成"%' RETURNING id`);
  const fix = (table: string) => `
    difficulty = CASE
      WHEN lower(difficulty) IN ${EASY} THEN '簡單'
      WHEN lower(difficulty) IN ${MED} THEN '中等'
      WHEN lower(difficulty) IN ${HARD} THEN '困難'
      ELSE difficulty END`;
  const c = await sql.unsafe(`UPDATE custom_recipes SET ${fix("custom_recipes")} WHERE lower(difficulty) IN ${EASY} OR lower(difficulty) IN ${MED} OR lower(difficulty) IN ${HARD} RETURNING id`);
  const o = await sql.unsafe(`UPDATE official_recipes SET ${fix("official_recipes")} WHERE lower(difficulty) IN ${EASY} OR lower(difficulty) IN ${MED} OR lower(difficulty) IN ${HARD} RETURNING id`);
  console.log(`[backfill] ✅ ai=${a.length} custom_diff=${c.length} official_diff=${o.length}`);
  await sql.end();
}

main().catch(async (e) => { console.error("[backfill] failed:", e); await sql.end(); process.exit(1); });
