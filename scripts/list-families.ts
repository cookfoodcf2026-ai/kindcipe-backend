/**
 * List all families with owner email + data counts, to decide test-data cleanup.
 * Read-only.  npx tsx scripts/list-families.ts
 */
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  const rows = await sql`
    select f.id, f.name,
      (select u.email from users u join family_members fm on fm.user_id = u.id::text where fm.family_id = f.id and fm.family_role = 'owner' limit 1) as owner_email,
      (select count(*)::int from family_members m where m.family_id = f.id) as members,
      (select count(*)::int from custom_recipes r where r.family_id = f.id) as recipes,
      (select count(*)::int from shopping_items s where s.family_id = f.id) as shopping,
      (select count(*)::int from meal_plans p where p.family_id = f.id) as plans
    from families f order by f.id`;
  for (const r of rows) {
    console.log(`#${r.id}\t${r.name}\towner=${r.owner_email ?? "-"}\tmembers=${r.members} recipes=${r.recipes} shopping=${r.shopping} plans=${r.plans}`);
  }
  console.log(`\nTOTAL families: ${rows.length}`);
  await sql.end();
}
main().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
