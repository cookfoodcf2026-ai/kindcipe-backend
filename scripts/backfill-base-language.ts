/**
 * backfill-base-language.ts
 * 一次性修正「base 非中文」嘅食譜：用 buildAllLangs 反譯成
 * 中文 base + 英/菲/印尼（含 ingredient 譯名）。
 *
 * 用法：
 *   npx tsx scripts/backfill-base-language.ts --dry-run
 *   npx tsx scripts/backfill-base-language.ts --write
 *
 * 只影響 name 唔含 CJK 嘅 row；官方食譜目前 0 條，安全。
 */
import { config } from "dotenv";
import { resolve } from "path";
import { sql } from "drizzle-orm";

config({ path: resolve(process.cwd(), ".env") });

const WRITE = process.argv.includes("--write");
const IDS_ARG = process.argv.find((a) => a.startsWith("--ids="));
const IDS = IDS_ARG ? IDS_ARG.slice("--ids=".length).split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)) : null;
const SRC_ARG = process.argv.find((a) => a.startsWith("--src="));
const FORCE_SRC = SRC_ARG ? SRC_ARG.slice("--src=".length) : null;

const CJK = "[一-鿿]";

function guessSrcLang(name: string): string {
  if (/[\u0E00-\u0E7F]/.test(name)) return "th";
  if (/[\uAC00-\uD7AF]/.test(name)) return "ko";
  if (/[\u3040-\u30FF]/.test(name)) return "ja";
  return "en"; // 拉丁 → 先當英文（LLM 會自行判斷實際語言）
}

function parseArr(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return []; }
  }
  return [];
}

async function main() {
  const { getDb } = await import("../server/db");
  const { customRecipes, officialRecipes } = await import("../drizzle/schema");
  const { buildAllLangs } = await import("../server/routers/recipes");

  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  for (const table of [customRecipes, officialRecipes]) {
    const rows: any[] = IDS
      ? await db.select().from(table).where(sql.raw(`id IN (${IDS.join(",")})`))
      : await db.select().from(table).where(sql.raw(`name !~ '${CJK}'`));
    console.log(`[backfill] ${table === customRecipes ? "custom" : "official"}: ${rows.length} non-Chinese-base row(s) (mode: ${WRITE ? "WRITE" : "dry-run"})`);
    if (!WRITE) {
      for (const r of rows.slice(0, 30)) console.log(`   #${r.id} "${r.name}" (${r.sourceType ?? ""})`);
      continue;
    }
    let done = 0;
    for (const r of rows) {
      try {
        const built = await buildAllLangs({
          name: r.name,
          description: r.description ?? "",
          steps: parseArr(r.steps),
          ingredients: parseArr(r.ingredients),
          srcLang: FORCE_SRC ?? guessSrcLang(r.name),
        });
        await db.update(table).set({
          name: built.name,
          nameEn: built.nameEn, nameFil: built.nameFil, nameId: built.nameId,
          description: built.description,
          descriptionEn: built.descriptionEn, descriptionFil: built.descriptionFil, descriptionId: built.descriptionId,
          steps: JSON.stringify(built.steps),
          stepsEn: built.stepsEn ? JSON.stringify(built.stepsEn) : undefined,
          stepsFil: built.stepsFil ? JSON.stringify(built.stepsFil) : undefined,
          stepsId: built.stepsId ? JSON.stringify(built.stepsId) : undefined,
          ingredients: JSON.stringify(built.ingredients),
        }).where(sql.raw(`id = ${Number(r.id)}`));
        done++;
        console.log(`   ✅ #${r.id} "${r.name}" -> "${built.name}"`);
      } catch (e) {
        console.error(`   ❌ #${r.id} "${r.name}":`, (e as Error)?.message);
      }
    }
    console.log(`[backfill] ${table === customRecipes ? "custom" : "official"}: updated ${done}/${rows.length}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error("[backfill] failed:", e); process.exit(1); });
