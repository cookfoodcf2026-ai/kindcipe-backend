/**
 * Dedup script: 找出同名嘅 custom recipes（AI Chef 重複 save 嘅證據），
 * 保留最舊一份（min id），其餘刪除，並將 meal_plans / shopping_items 嘅引用
 * 由 `user_<delId>` / `<delId>` 改指去 keepId。
 *
 * Run:    npx tsx scripts/dedup-ai-recipes.ts          # dry-run，只列唔刪
 *         npx tsx scripts/dedup-ai-recipes.ts --apply  # 真正執行
 */

import "dotenv/config";
import { getDb } from "../server/db";
import { customRecipes, mealPlans, shoppingItems } from "../drizzle/schema";
import { eq, inArray } from "drizzle-orm";

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "🔧 APPLY MODE（會改資料）" : "🔎 DRY-RUN（只列唔刪）");

  const db = await getDb();
  if (!db) {
    console.error("❌ Failed to connect to database");
    process.exit(1);
  }

  const all = await db.select().from(customRecipes);
  console.log(`📊 ${all.length} custom recipes total\n`);

  const groups = new Map<string, typeof all>();
  for (const r of all) {
    const key = `${r.familyId}|${(r.name || "").trim()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const dupGroups = [...groups.entries()].filter(([, arr]) => arr.length > 1);
  if (dupGroups.length === 0) {
    console.log("✅ 無重複同名食譜");
    return;
  }

  let planToDelete = 0;
  let planToSkipPublic = 0;
  for (const [key, arr] of dupGroups) {
    const [familyId, name] = key.split("|");
    const sorted = [...arr].sort((a, b) => a.id - b.id);
    const keep = sorted[0];
    const dups = sorted.slice(1);
    const publicDups = dups.filter(d => d.visibility === "public");
    const deletable = dups.filter(d => d.visibility !== "public");

    console.log(`\n🏷️  「${name}」 (family ${familyId}) ×${arr.length}`);
    console.log(`   保留: id=${keep.id}  tags=${keep.tags ?? "null"}  visibility=${keep.visibility}`);
    for (const d of dups) {
      const note = d.visibility === "public" ? " [SKIP: public]" : "";
      console.log(`   刪除: id=${d.id}  tags=${d.tags ?? "null"}  visibility=${d.visibility}${note}`);
    }
    planToDelete += deletable.length;
    planToSkipPublic += publicDups.length;
  }

  console.log(`\n🔢 合計：刪 ${planToDelete} 個，跳過 public ${planToSkipPublic} 個`);

  if (!apply) {
    console.log("\n⚠️  未做任何改動。想真正執行加 --apply");
    return;
  }

  for (const [, arr] of dupGroups) {
    const sorted = [...arr].sort((a, b) => a.id - b.id);
    const keep = sorted[0];
    const dups = sorted.slice(1).filter(d => d.visibility !== "public");
    if (dups.length === 0) continue;

    const dupIds = dups.map(d => d.id);
    const refPrefixes = dupIds.flatMap(id => [`user_${id}`, String(id)]);

    const mealHits = await db.select().from(mealPlans).where(inArray(mealPlans.recipeId, refPrefixes));
    for (const m of mealHits) {
      const newRef = m.recipeId.startsWith("user_") ? `user_${keep.id}` : String(keep.id);
      await db.update(mealPlans).set({ recipeId: newRef, recipeName: keep.name }).where(eq(mealPlans.id, m.id));
      console.log(`   ↳ meal_plan #${m.id} recipeId ${m.recipeId} → ${newRef}`);
    }

    const shopHits = await db.select().from(shoppingItems).where(inArray(shoppingItems.fromRecipeId, refPrefixes));
    for (const s of shopHits) {
      const newRef = s.fromRecipeId.startsWith("user_") ? `user_${keep.id}` : String(keep.id);
      await db.update(shoppingItems)
        .set({ fromRecipeId: newRef, fromRecipeName: keep.name, plannedDate: s.plannedDate })
        .where(eq(shoppingItems.id, s.id));
      console.log(`   ↳ shopping_item #${s.id} fromRecipeId ${s.fromRecipeId} → ${newRef}`);
    }

    await db.delete(customRecipes).where(inArray(customRecipes.id, dupIds));
    console.log(`   ✂️  刪除 custom_recipes ${dupIds.join(", ")}（保留 #${keep.id}）`);
  }

  console.log("\n✅ 完成");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
