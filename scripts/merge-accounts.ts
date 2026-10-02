/**
 * merge-accounts.ts — 合併重複帳號（例：同一 email 因 Apple relay / admin 排除而開咗多個帳號）。
 *
 * 預設 DRY-RUN（只列計劃，唔改嘢）。要真正執行加 `--apply`。
 *
 * 做嘅嘢（把 --merge 帳號併入 --canonical）：
 *   1. user_identities：由 merge → canonical（若該 identity 已屬 canonical 則刪 merge 嗰條）
 *   2. families.ownerId：由 merge → canonical
 *   3. family_members.userId：由 merge → canonical（同一 family 已存在則刪 merge 嗰條）
 * 唔會刪 users 列（只令 merge 帳號冇 identity → 無法再登入，可事後人手清）。
 *
 * 用法：
 *   railway run npx tsx scripts/merge-accounts.ts --canonical 123 --merge 456 789
 *   railway run npx tsx scripts/merge-accounts.ts --canonical 123 --merge 456 789 --apply
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });

const { getDb } = await import("../server/db");
const { users, userIdentities, families, familyMembers } = await import("../drizzle/schema");
const { eq, and, inArray } = await import("drizzle-orm");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function argList(name: string): string[] {
  const i = process.argv.indexOf(name);
  if (i < 0) return [];
  const out: string[] = [];
  for (let j = i + 1; j < process.argv.length && !process.argv[j].startsWith("--"); j++) out.push(process.argv[j]);
  return out;
}

async function main() {
  const canonicalId = arg("--canonical");
  const mergeIds = argList("--merge").map((s) => String(s));
  const apply = process.argv.includes("--apply");

  if (!canonicalId || mergeIds.length === 0) {
    console.error("用法：--canonical <userId> --merge <userId...> [--apply]");
    process.exit(1);
  }
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const allIds = [canonicalId, ...mergeIds];
  const rows = await db.select().from(users).where(inArray(users.id, allIds as any));
  const byId = new Map(rows.map((r: any) => [String(r.id), r]));
  const canonical = byId.get(String(canonicalId));
  if (!canonical) { console.error("搵唔到 canonical user:", canonicalId); process.exit(1); }

  console.log(`\n${apply ? "🚨 APPLY" : "🔎 DRY-RUN"}  merge-accounts`);
  console.log(`canonical: #${canonical.id} openId=${canonical.openId} email=${canonical.email} role=${canonical.role}`);
  for (const mid of mergeIds) {
    const m = byId.get(String(mid));
    console.log(`  merge:   #${mid} ${m ? `openId=${m.openId} email=${m.email} role=${m.role}` : "(NOT FOUND)"}`);
  }

  for (const mid of mergeIds) {
    if (String(mid) === String(canonicalId)) continue;
    const m = byId.get(String(mid));
    if (!m) continue;

    // 1) identities
    const idents = await db.select().from(userIdentities).where(eq(userIdentities.userId, String(mid)));
    for (const ident of idents) {
      const conflict = await db.select().from(userIdentities)
        .where(and(eq(userIdentities.provider, ident.provider), eq(userIdentities.providerUserId, ident.providerUserId)))
        .limit(1);
      const existing = conflict[0];
      if (existing && String(existing.userId) === String(canonicalId)) {
        console.log(`  - identity ${ident.provider}:${ident.providerUserId} → 已屬 canonical，刪 merge 嗰條`);
        if (apply) await db.delete(userIdentities).where(eq(userIdentities.id, ident.id));
      } else {
        console.log(`  - identity ${ident.provider}:${ident.providerUserId} → 改屬 canonical`);
        if (apply) await db.update(userIdentities).set({ userId: String(canonicalId) }).where(eq(userIdentities.id, ident.id));
      }
    }

    // 2) families owned
    const owned = await db.select().from(families).where(eq(families.ownerId, String(mid)));
    for (const fam of owned) {
      console.log(`  - family #${fam.id} (${fam.name}) owner → canonical`);
      if (apply) await db.update(families).set({ ownerId: String(canonicalId) }).where(eq(families.id, fam.id));
    }

    // 3) memberships
    const mems = await db.select().from(familyMembers).where(eq(familyMembers.userId, String(mid)));
    for (const mem of mems) {
      const dup = await db.select().from(familyMembers)
        .where(and(eq(familyMembers.familyId, mem.familyId), eq(familyMembers.userId, String(canonicalId))))
        .limit(1);
      if (dup.length > 0) {
        console.log(`  - membership family #${mem.familyId} → canonical 已係成員，刪 merge 嗰條`);
        if (apply) await db.delete(familyMembers).where(eq(familyMembers.id, mem.id));
      } else {
        console.log(`  - membership family #${mem.familyId} → 改屬 canonical`);
        if (apply) await db.update(familyMembers).set({ userId: String(canonicalId) }).where(eq(familyMembers.id, mem.id));
      }
    }
  }

  console.log(apply ? "\n✅ 已套用。建議即刻用 Apple/Google 兩邊登入驗證。\n" : "\n(DRY-RUN：未改任何嘢。確認後加 --apply)\n");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
