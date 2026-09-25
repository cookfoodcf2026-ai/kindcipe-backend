/**
 * Cleanup stale shopping_items created by the old mealPlan.addBatch auto-add.
 *
 * The old flow auto-created shopping rows at the MEAL date (plannedDate = meal plan date)
 * with category = NULL, then the ingredient-picker modal re-added the SAME ingredients
 * at the BUY date with a category. Result: duplicated rows on two dates; the meal-date
 * copies have no category (render as 其他).
 *
 * We delete ONLY true duplicates: shopping rows that
 *   - are linked to a meal plan (from_meal_plan_id is not null), AND
 *   - have plannedDate = that meal plan's date (i.e. the MEAL date, not the buy date), AND
 *   - have category IS NULL (the auto-add never set a category), AND
 *   - have ANOTHER row for the same family + name + unit at a DIFFERENT plannedDate
 *     (the buy-date copy created by the modal, which DOES have a category).
 *
 * This guarantees we never delete an ingredient that only exists once.
 * Usage: npx tsx scripts/cleanup-dup-meal-date-shopping.ts [--dry]
 */
import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

const dry = process.argv.includes("--dry");

async function main() {
  const db = await getDb();
  if (!db) throw new Error("no db");

  const target = await db.execute(sql`
    select s.id, s.family_id as familyId, s.name, s.unit, s.planned_date as plannedDate,
           s.from_meal_plan_id as fromMealPlanId, mp.date as mealDate
    from shopping_items s
    join meal_plans mp on mp.id = s.from_meal_plan_id
    where s.from_meal_plan_id is not null
      and s.planned_date = mp.date
      and s.category is null
      and exists (
        select 1 from shopping_items d
        where d.family_id = s.family_id
          and d.name = s.name
          and coalesce(d.unit, '') = coalesce(s.unit, '')
          and d.id <> s.id
          and (d.planned_date is distinct from s.planned_date)
      )
  `);
  const rows = (target.rows ?? target) as { id: number; name: string; plannedDate: string; fromMealPlanId: number; mealDate: string }[];

  console.log(`Found ${rows.length} duplicate meal-date shopping row(s) (meal-date, no category, has buy-date copy).`);

  if (dry) {
    for (const r of rows) {
      console.log(`[dry] would delete #${r.id} "${r.name}" (plannedDate=${r.plannedDate ?? "null"}, mealPlan=${r.fromMealPlanId})`);
    }
  } else {
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      for (let i = 0; i < ids.length; i += 500) {
        const batch = ids.slice(i, i + 500);
        await db.execute(sql`delete from shopping_items where id in (${sql.join(batch.map((id) => sql`${id}`), sql`, `)})`);
      }
      console.log(`Deleted ${ids.length} duplicate row(s).`);
    } else {
      console.log("Nothing to delete.");
    }
  }

  await db.$client?.end?.();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
