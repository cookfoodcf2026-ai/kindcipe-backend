import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
import { deriveRecipeTags } from "../server/services/chefDerivedTags";

const db = await getDb();
if (!db) { console.log("NO_DB"); process.exit(0); }
const rows: any = await db.execute(sql`
  select id, name, ingredients from official_recipes
  where is_active and name like '%雞%' limit 400
`);
const list = (rows.rows ?? rows) as any[];
const bad = list.filter((r) => {
  const ings = (Array.isArray(r.ingredients) ? r.ingredients : JSON.parse(r.ingredients ?? "[]"))
    .map((i: any) => String(i?.name ?? ""));
  const tags: string[] = (deriveRecipeTags as any)({ name: r.name, ingredients: ings.map((n: string) => ({ name: n })) });
  return tags.some((t) => t === "protein:seafood" || t === "protein:fish");
});
console.log("CHICKEN_WITH_SEAFOOD_TAG", bad.length, "of", list.length);
for (const r of bad.slice(0, 8)) {
  const ings = (Array.isArray(r.ingredients) ? r.ingredients : JSON.parse(r.ingredients ?? "[]"))
    .map((i: any) => String(i?.name ?? ""));
  console.log("-", r.id, r.name, "|", ings.join("、").slice(0, 120));
}
