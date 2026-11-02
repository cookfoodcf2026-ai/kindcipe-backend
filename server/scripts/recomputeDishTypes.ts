/**
 * 一次性 backfill：用 guardDishTypeByIngredients 修正「肉／海鮮 但食材完全冇對應字」嘅誤分類。
 * 用法：
 *   npx tsx server/scripts/recomputeDishTypes.ts            # dry-run（只印會改嘅）
 *   npx tsx server/scripts/recomputeDishTypes.ts --apply    # 實際更新
 */
import { getDb } from "../db";
import { officialRecipes, customRecipes } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { guardDishTypeByIngredients, type DishKind } from "../utils/dishType";

const APPLY = process.argv.includes("--apply");

function parseIngredients(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function run() {
  const db = await getDb();
  if (!db) {
    console.error("no db");
    process.exit(1);
  }

  let changed = 0;

  for (const table of [officialRecipes, customRecipes] as const) {
    const rows = await db
      .select({ id: table.id, name: table.name, dishType: table.dishType, ingredients: table.ingredients })
      .from(table);

    for (const r of rows) {
      const current = (r.dishType ?? "other") as DishKind;
      if (current !== "seafood" && current !== "meat") continue;
      const next = guardDishTypeByIngredients(r.name ?? "", parseIngredients(r.ingredients), current);
      if (next === current) continue;
      changed++;
      console.log(`${table === officialRecipes ? "official" : "custom"} #${r.id} "${r.name}" ${current} → ${next}`);
      if (APPLY) {
        await db.update(table).set({ dishType: next }).where(eq(table.id, r.id));
      }
    }
  }

  console.log(`\n${APPLY ? "APPLIED" : "DRY-RUN"} changes=${changed}`);
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
