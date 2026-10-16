/**
 * Grant / revoke Pro for a family (for testing). Reversible.
 *   npx tsx scripts/grant-pro.ts <familyId|email>
 *   npx tsx scripts/grant-pro.ts <familyId|email> --commit
 *   npx tsx scripts/grant-pro.ts <familyId|email> --revoke [--commit]
 *
 * Grant:  subscription_status=active, plan=granted, expires=NULL, max_members=4
 * Revoke: subscription_status=free,   plan=NULL,      expires=NULL, max_members=2
 */
import "dotenv/config";
import postgres from "postgres";

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const REVOKE = args.includes("--revoke");
const target = args.find((a) => !a.startsWith("--"));
if (!target) { console.error("Usage: tsx scripts/grant-pro.ts <familyId|email> [--revoke] [--commit]"); process.exit(1); }

const sql = postgres(process.env.DATABASE_URL!);
const log = (s: string) => console.log((COMMIT ? "[COMMIT] " : "[DRY]    ") + s);

async function resolveFamilies(): Promise<{ id: number; name: string }[]> {
  if (/^\d+$/.test(target!)) {
    return await sql`select id, name from families where id=${Number(target)}`;
  }
  return await sql`
    select f.id, f.name
    from families f
    join family_members fm on fm.family_id = f.id
    join users u on u.id::text = fm.user_id
    where lower(u.email) = lower(${target}) and fm.family_role = 'owner'
    order by f.id`;
}

async function main() {
  const fams = await resolveFamilies();
  if (fams.length === 0) { console.error(`No family found for "${target}"`); await sql.end(); process.exit(1); }
  if (fams.length > 1) console.log(`⚠️  ${fams.length} families match "${target}" — applying to all:`);

  for (const f of fams) {
    if (REVOKE) {
      log(`family ${f.id} (${f.name}): REVOKE → free`);
      if (COMMIT) {
        await sql`update families set subscription_status='free', subscription_plan=NULL,
                  subscription_expires_at=NULL, max_members=2, updated_at=now() where id=${f.id}`;
      }
    } else {
      log(`family ${f.id} (${f.name}): GRANT → active (Pro)`);
      if (COMMIT) {
        await sql`update families set subscription_status='active', subscription_plan='granted',
                  subscription_expires_at=NULL, max_members=4, updated_at=now() where id=${f.id}`;
      }
    }
  }
  if (COMMIT) {
    const after = await sql`select id, name, subscription_status, subscription_plan, max_members from families where id in ${sql(fams.map((f) => f.id))}`;
    console.log("Now:", JSON.stringify(after));
  }
  console.log(COMMIT ? "✅ Done." : "ℹ️  Dry-run. Add --commit to apply.");
  await sql.end();
}

main().catch(async (e) => { console.error("Failed:", e); await sql.end(); process.exit(1); });
