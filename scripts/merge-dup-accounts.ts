/**
 * One-off: merge duplicate account A into account B (same email), delete empty
 * test kitchens, then add a case-insensitive unique index on users.email.
 *
 * Dry-run by default. Pass --commit to actually write.
 *   npx tsx scripts/merge-dup-accounts.ts
 *   npx tsx scripts/merge-dup-accounts.ts --commit
 */
import "dotenv/config";
import postgres from "postgres";

const COMMIT = process.argv.includes("--commit");
const A = "8bc8505d-1f7a-4a5d-8ec2-93e2f62e1471";
const B = "c26ef69c-5f92-4289-acfe-0cf3abd04ad4";
const EMPTY_KITCHENS = [14, 15, 16];

const sql = postgres(process.env.DATABASE_URL!);
const log = (s: string) => console.log((COMMIT ? "[COMMIT] " : "[DRY]    ") + s);

// Tables that reference a user id and could keep an orphan after deleting A.
const USER_REF_COLUMNS: [string, string][] = [
  ["admin_audit_logs", "target_user_id"],
  ["ai_chat_sessions", "user_id"],
  ["ai_chat_usage", "user_id"],
  ["custom_recipes", "approved_by_user_id"],
  ["custom_recipes", "created_by_user_id"],
  ["email_verification_codes", "user_id"],
  ["family_eat_out", "set_by_user_id"],
  ["family_members", "user_id"],
  ["favorite_items", "user_id"],
  ["iap_transactions", "user_id"],
  ["import_usage", "user_id"],
  ["kol_creators", "added_by_user_id"],
  ["kol_creators", "user_id"],
  ["meal_plans", "proposed_by_user_id"],
  ["meal_plans", "confirmed_by_user_id"],
  ["password_reset_tokens", "user_id"],
  ["promo_code_redemptions", "user_id"],
  ["purchase_history", "user_id"],
  ["push_tokens", "user_id"],
  ["recipe_events", "user_id"],
  ["recipe_notes", "user_id"],
  ["redirect_logs", "user_id"],
  ["removed_family_members", "user_id"],
  ["shopping_items", "proposed_by_user_id"],
  ["shopping_items", "bought_by_user_id"],
  ["stripe_subscriptions", "user_id"],
  ["user_identities", "user_id"],
  ["user_recipe_collections", "user_id"],
  ["weekly_menu", "set_by_user_id"],
];

const FAMILY_TABLES = [
  "shopping_items", "pantry_items", "meal_plans", "purchase_history", "push_tokens",
  "custom_recipes", "recipe_notes", "family_eat_out", "removed_family_members",
  "recipe_events", "favorite_items", "import_usage", "ai_chat_usage", "family_members",
];

async function count(table: string, col: string, val: string | number): Promise<number> {
  const r = await sql.unsafe(`select count(*)::int c from "${table}" where "${col}"=$1`, [val]);
  return r[0].c as number;
}

async function mergeUsage(table: string) {
  const a = await sql.unsafe(
    `select id, family_id, year_month, count from "${table}" where user_id=$1`, [A]);
  for (const r of a) {
    const b = await sql.unsafe(
      `select id, count from "${table}" where user_id=$1 and family_id=$2 and year_month=$3`,
      [B, r.family_id, r.year_month]);
    if (b.length) {
      log(`${table}: merge count ${r.count} into B's row (family ${r.family_id} ${r.year_month}) + delete A's`);
      if (COMMIT) {
        await sql.unsafe(`update "${table}" set count = count + $1, updated_at = now() where id=$2`, [r.count, b[0].id]);
        await sql.unsafe(`delete from "${table}" where id=$1`, [r.id]);
      }
    } else {
      log(`${table}: repoint A's row (family ${r.family_id} ${r.year_month}) -> B`);
      if (COMMIT) await sql.unsafe(`update "${table}" set user_id=$1 where id=$2`, [B, r.id]);
    }
  }
}

async function main() {
  const rows = await sql`select id, email from users where id in (${A}, ${B})`;
  if (rows.length !== 2) throw new Error("A/B not both found");
  const eA = String(rows.find((r: any) => r.id === A)?.email ?? "").toLowerCase();
  const eB = String(rows.find((r: any) => r.id === B)?.email ?? "").toLowerCase();
  if (!eA || eA !== eB) throw new Error(`emails differ (${eA} vs ${eB})`);
  log(`Merge A=${A} into B=${B} (email ${eA})`);

  const rc = await count("custom_recipes", "created_by_user_id", A);
  log(`custom_recipes.created_by_user_id: ${rc} rows -> B`);
  if (COMMIT) await sql`update custom_recipes set created_by_user_id=${B} where created_by_user_id=${A}`;

  const mp = await count("meal_plans", "proposed_by_user_id", A);
  log(`meal_plans.proposed_by_user_id: ${mp} rows -> B`);
  if (COMMIT) await sql`update meal_plans set proposed_by_user_id=${B} where proposed_by_user_id=${A}`;

  await mergeUsage("import_usage");
  await mergeUsage("ai_chat_usage");

  const fm = await count("family_members", "user_id", A);
  log(`family_members.user_id: delete ${fm} rows (B already owns those kitchens)`);
  if (COMMIT) await sql`delete from family_members where user_id=${A}`;

  const ev = await count("email_verification_codes", "user_id", A);
  log(`email_verification_codes.user_id: delete ${ev} rows`);
  if (COMMIT) await sql`delete from email_verification_codes where user_id=${A}`;

  // Safety: no remaining refs to A before deleting the user row.
  let remaining = 0;
  for (const [t, c] of USER_REF_COLUMNS) {
    try {
      const n = await count(t, c, A);
      if (n > 0) { console.log(`  ⚠️ remaining ${t}.${c} = ${n}`); remaining += n; }
    } catch { /* table/col may not exist */ }
  }
  if (remaining > 0 && COMMIT) throw new Error(`Abort: ${remaining} rows still reference A`);
  log(`remaining refs to A: ${remaining}`);

  log(`delete user row A`);
  if (COMMIT) await sql`delete from users where id=${A}`;

  // Empty test kitchens
  for (const f of EMPTY_KITCHENS) {
    const members = await count("family_members", "family_id", f);
    const recipes = await count("custom_recipes", "family_id", f);
    log(`kitchen ${f}: members=${members} recipes=${recipes} -> delete`);
    if (COMMIT) {
      for (const t of FAMILY_TABLES) {
        try { await sql.unsafe(`delete from "${t}" where family_id=$1`, [f]); } catch { /* ignore */ }
      }
      await sql`delete from families where id=${f}`;
    }
  }

  // Case-insensitive unique index on email (prevents future duplicates).
  log(`create unique index users_email_lower_unique on users (lower(email))`);
  if (COMMIT) {
    await sql`create unique index if not exists users_email_lower_unique on users (lower(email)) where email is not null and email <> ''`;
  }

  console.log(COMMIT ? "✅ Done." : "ℹ️  Dry-run only. Re-run with --commit to apply.");
  await sql.end();
}

main().catch(async (e) => { console.error("Failed:", e); await sql.end(); process.exit(1); });
