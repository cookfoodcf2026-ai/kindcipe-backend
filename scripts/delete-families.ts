/**
 * Delete family kitchens + all their data. Dry-run by default.
 *   npx tsx scripts/delete-families.ts 56 57
 *   npx tsx scripts/delete-families.ts 56 57 --commit
 */
import "dotenv/config";
import postgres from "postgres";

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const ids = args.filter((a) => /^\d+$/.test(a)).map(Number);
if (ids.length === 0) { console.error("Usage: tsx scripts/delete-families.ts <id...> [--commit]"); process.exit(1); }

const sql = postgres(process.env.DATABASE_URL!);
const log = (s: string) => console.log((COMMIT ? "[COMMIT] " : "[DRY]    ") + s);

const FAMILY_TABLES = [
  "shopping_items", "pantry_items", "meal_plans", "purchase_history", "push_tokens",
  "custom_recipes", "recipe_notes", "family_eat_out", "removed_family_members",
  "recipe_events", "favorite_items", "import_usage", "ai_chat_usage", "family_members",
  "ai_chef_seen_recipes",
];

async function main() {
  for (const f of ids) {
    const name = await sql`select name from families where id=${f}`;
    if (name.length === 0) { log(`family ${f}: NOT FOUND, skip`); continue; }
    const counts: string[] = [];
    for (const t of FAMILY_TABLES) {
      try {
        const r = await sql.unsafe(`select count(*)::int c from "${t}" where family_id=$1`, [f]);
        if (r[0].c > 0) counts.push(`${t}=${r[0].c}`);
      } catch { /* table may not have family_id */ }
    }
    log(`family ${f} (${name[0].name}): ${counts.join(", ") || "empty"} -> delete`);
    if (COMMIT) {
      for (const t of FAMILY_TABLES) {
        try { await sql.unsafe(`delete from "${t}" where family_id=$1`, [f]); } catch { /* ignore */ }
      }
      await sql`delete from families where id=${f}`;
    }
  }
  console.log(COMMIT ? "✅ Done." : "ℹ️  Dry-run. Add --commit to apply.");
  await sql.end();
}

main().catch(async (e) => { console.error("Failed:", e); await sql.end(); process.exit(1); });
