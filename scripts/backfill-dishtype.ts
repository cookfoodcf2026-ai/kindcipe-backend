import { config } from "dotenv";
import { resolve } from "path";
import { isNull, or, eq } from "drizzle-orm";
import { getDb } from "../server/db";
import { customRecipes, officialRecipes } from "../drizzle/schema";
import { classifyRecipeDishTypeLLM } from "../server/utils/dishType";

config({ path: resolve(process.cwd(), ".env") });

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
