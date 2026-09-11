import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });

// 動態 import：確保 _core/env 喺 config() 之後先載入（否則 DASHSCOPE_API_KEY / DATABASE_URL 讀唔到）
const { isNull, or, eq } = await import("drizzle-orm");
const { getDb } = await import("../server/db");
const { customRecipes, officialRecipes } = await import("../drizzle/schema");
const { classifyRecipeDishTypeLLM } = await import("../server/utils/dishType");

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const customs = await db.select().from(customRecipes)
    .where(or(isNull(customRecipes.dishType), eq(customRecipes.dishType, "")));
  const officials = await db.select().from(officialRecipes)
    .where(or(isNull(officialRecipes.dishType), eq(officialRecipes.dishType, "")));

  console.log(`Backfilling dishType: ${customs.length} custom, ${officials.length} official`);

  let ok = 0, fail = 0;
  const run = async (table: any, idCol: any, r: any) => {
    const t = await classifyRecipeDishTypeLLM({
      name: r.name,
      description: r.description,
      ingredients: (() => { try { return JSON.parse(r.ingredients || "[]"); } catch { return []; } })(),
      tags: parseTags(r.tags),
      category: r.recipeCategory,
    });
    if (t) {
      await db.update(table).set({ dishType: t }).where(eq(idCol, r.id));
      ok++;
      console.log(`✅ ${r.name} → ${t}`);
    } else {
      fail++;
      console.log(`⚠️  ${r.name} → unclassified`);
    }
  };

  for (const r of customs) await run(customRecipes, customRecipes.id, r);
  for (const r of officials) await run(officialRecipes, officialRecipes.id, r);

  console.log(`\nDone: ${ok} classified, ${fail} unclassified`);
  process.exit(0);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
