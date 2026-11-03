import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });

// Manual backfill only. Never called automatically by the server or seed scripts.
const { eq, isNull, or } = await import("drizzle-orm");
const { getDb } = await import("../server/db");
const { customRecipes, officialRecipes } = await import("../drizzle/schema");
const { deriveRecipeTags, serializeDerivedTags } = await import("../server/services/deriveRecipeTags");

const all = process.argv.includes("--all");

async function backfillTable(db: any, table: any, label: string) {
  const where = all
    ? undefined
    : or(isNull(table.derivedTags), eq(table.derivedTags, ""));
  const rows = await (where ? db.select().from(table).where(where) : db.select().from(table));
  console.log(`[derived-tags] ${label}: ${rows.length} row(s)${all ? " (--all)" : " missing tags"}`);
  let updated = 0;
  for (const row of rows) {
    const tags = deriveRecipeTags({
      name: row.name,
      ingredients: row.ingredients,
      difficulty: row.difficulty,
      cookTime: row.cookTime,
    });
    const derivedTags = serializeDerivedTags(tags);
    if (derivedTags === row.derivedTags) continue;
    await db.update(table).set({ derivedTags }).where(eq(table.id, row.id));
    updated += 1;
  }
  console.log(`[derived-tags] ${label}: updated ${updated}`);
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await backfillTable(db, customRecipes, "custom_recipes");
  await backfillTable(db, officialRecipes, "official_recipes");
  console.log("[derived-tags] done");
  process.exit(0);
}

main().catch((error) => {
  console.error("[derived-tags] FATAL:", error);
  process.exit(1);
});
