import postgres from "postgres";
import { hasUsableMainIngredient } from "./server/utils/ingredientNormalize";
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const sets = [
  ["粟米蛋花湯","豉汁蒸排骨","蝦仁炒蛋","蒜蓉炒菜心"],
  ["紫菜豆腐魚蛋湯","豉油雞翼","勝瓜炒蝦仁","白灼蠔油菜心"],
  ["生菜魚肉","蒜蓉豆豉蒸雞髀肉","花甲蒸水蛋","魚香茄子"],
];
for (const s of sets) {
  for (const n of s) {
    const r = await sql`select id,name,ingredients,is_active from official_recipes where name=${n} limit 1`;
    if (!r.length) { console.log("MISSING", n); continue; }
    const ok = hasUsableMainIngredient((r[0].ingredients ?? []) as any);
    console.log(ok ? "ok  " : "BAD ", n, "#"+r[0].id, "active="+r[0].is_active);
  }
}
await sql.end();
