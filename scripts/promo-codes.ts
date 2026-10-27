/**
 * C9T promo-code batch tooling.
 *
 * Uses DATABASE_PUBLIC_URL when present so it can run from a laptop against
 * Railway. Never run this through `railway run` (that injects the private
 * postgres.railway.internal host).
 *
 *   npm run promo:codes -- gen --count 100            # dry-run
 *   npm run promo:codes -- gen --count 100 --commit   # insert + CSV
 *   npm run promo:codes -- list
 *   npm run promo:codes -- reconcile
 *   npm run promo:codes -- deactivate C9T-ABCD2345
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import postgres from "postgres";
import { generatePromoCode } from "../server/services/promo";

const url = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_PUBLIC_URL or DATABASE_URL is required");
  process.exit(1);
}
const sql = postgres(url, { ssl: "require", max: 1 });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function counts() {
  const [row] = await sql`
    select
      count(*) filter (where status = 'paid')::int as paid,
      count(*) filter (where status = 'reserved')::int as reserved,
      count(*) filter (where status <> 'released')::int as held
    from earlybird_redemptions
  `;
  return row;
}

async function generate() {
  const count = Math.max(1, Math.min(500, Number(arg("count") ?? 100)));
  const kind = (arg("kind") ?? "C9T").toUpperCase();
  if (kind !== "C9T" && kind !== "C9F") throw new Error("Only C9T / C9F batches can be generated");
  const codes = Array.from({ length: count }, () => generatePromoCode(kind as "C9T" | "C9F"));
  const validDays = Math.max(1, Math.min(365, Number(arg("valid-days") ?? (kind === "C9F" ? 365 : 7))));
  const expiresAt = new Date(Date.now() + validDays * 24 * 60 * 60 * 1000);
  const outPath = path.resolve(
    arg("out") ?? path.join(homedir(), "kindcipe-promo", `c9t-${new Date().toISOString().slice(0, 10)}.csv`)
  );
  mkdirSync(path.dirname(outPath), { recursive: true });
  const plan = kind === "C9F" ? "founding" : "trial7";
  const csv = ["code,plan,max_uses,expires_at", ...codes.map((c) => `${c},${plan},1,${expiresAt.toISOString()}`)].join("\n") + "\n";
  writeFileSync(outPath, csv, "utf8");

  if (!flag("commit")) {
    console.log(`[dry-run] ${count} ${kind} codes → ${outPath}`);
    console.log(codes.slice(0, 5).join("\n"));
    if (count > 5) console.log(`… ${count - 5} more`);
    return;
  }

  await sql.begin(async (tx) => {
    for (const code of codes) {
      await tx`
        insert into promo_codes (code, plan, max_uses, used_count, active, expires_at, auto_issued, note)
        values (${code}, ${plan}, 1, 0, true, ${expiresAt}, false, ${`IG ${kind} batch`})
        on conflict (code) do nothing
      `;
    }
  });
  console.log(`[commit] ${count} ${kind} codes → ${outPath}`);
}

async function list() {
  const rows = await sql`
    select code, plan, used_count, max_uses, active, expires_at, assigned_family_id, auto_issued
      from promo_codes
     where plan in ('trial7', 'earlybird', 'founding')
     order by created_at desc
     limit 200
  `;
  console.table(rows);
  console.log(await counts());
}

async function deactivate() {
  const code = (arg("code") ?? process.argv[3] ?? "").trim().toUpperCase();
  if (!code) throw new Error("Provide a code: deactivate C9T-...");
  await sql`update promo_codes set active = false where code = ${code}`;
  console.log(`[deactivated] ${code}`);
}

async function reconcile() {
  const [codes] = await sql`
    select
      count(*) filter (where plan = 'trial7')::int as c9t,
      count(*) filter (where plan = 'earlybird')::int as c9d,
      count(*) filter (where plan = 'founding')::int as c9f
    from promo_codes
  `;
  const eb = await counts();
  const [subs] = await sql`
    select
      count(*) filter (where status = 'pending')::int as pending,
      count(*) filter (where status = 'trialing')::int as trialing,
      count(*) filter (where status = 'active')::int as active
    from stripe_subscriptions
  `;
  console.log({ codes, earlybird: eb, stripe: subs });
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === "gen") await generate();
  else if (cmd === "list") await list();
  else if (cmd === "reconcile") await reconcile();
  else if (cmd === "deactivate") await deactivate();
  else {
    console.log("Usage: promo:codes -- gen|list|reconcile|deactivate [options]");
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e?.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
