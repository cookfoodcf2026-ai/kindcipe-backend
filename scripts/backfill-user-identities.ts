/**
 * backfill-user-identities.ts
 * 由現有 users.openId 回填 user_identities（idempotent）。
 *   google_xxx → provider google, providerUserId xxx
 *   apple_xxx  → provider apple,  providerUserId xxx
 *   email_xxx  → provider email,  providerUserId xxx
 *
 * 用法： railway run npx tsx scripts/backfill-user-identities.ts
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });

const { getDb } = await import("../server/db");
const { users, userIdentities } = await import("../drizzle/schema");

function derive(openId: string): { provider: "google" | "apple" | "email"; providerUserId: string } | null {
  if (openId.startsWith("google_")) return { provider: "google", providerUserId: openId.slice(7) };
  if (openId.startsWith("apple_")) return { provider: "apple", providerUserId: openId.slice(6) };
  if (openId.startsWith("email_")) return { provider: "email", providerUserId: openId.slice(6) };
  return null;
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const all = await db.select().from(users);
  let created = 0;
  let skipped = 0;
  for (const u of all as any[]) {
    const d = derive(String(u.openId || ""));
    if (!d) { skipped++; continue; }
    const res = await db
      .insert(userIdentities)
      .values({
        userId: String(u.id),
        provider: d.provider,
        providerUserId: d.providerUserId,
        email: u.email ? String(u.email).toLowerCase() : null,
        emailVerified: !!u.emailVerified,
      })
      .onConflictDoNothing()
      .returning({ id: userIdentities.id });
    if (res.length > 0) created++;
  }
  const total = await db.select().from(userIdentities);
  console.log(`users=${all.length} created=${created} skipped=${skipped} total_identities=${total.length}`);
  process.exit(0);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
