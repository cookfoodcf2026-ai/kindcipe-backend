/**
 * One-time grandfathering: mark every existing user's email as verified so the
 * new email-verification requirement does not lock out accounts created before
 * it existed.
 *
 * Usage:
 *   npx tsx scripts/grandfather-email-verified.ts           # dry-run
 *   npx tsx scripts/grandfather-email-verified.ts --commit
 */
import "dotenv/config";
import { getDb, markAllUsersEmailVerified } from "../server/db";
import { sql } from "drizzle-orm";

const COMMIT = process.argv.includes("--commit");

async function main() {
  const db = await getDb();
  const r: any = await db.execute(
    sql`select count(*)::int total, count(*) filter (where email_verified = false)::int unverified from users`
  );
  const row = (r.rows ?? r)[0];
  console.log(`users: ${row.total} | unverified: ${row.unverified}`);

  if (!COMMIT) {
    console.log("\nDRY-RUN. Re-run with --commit to mark all as verified.");
    return;
  }

  const n = await markAllUsersEmailVerified();
  console.log(`\nDONE. marked ${n} users as emailVerified.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
