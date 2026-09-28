/**
 * 帳號身份連結（Identity linking）
 *
 * 目標：一個 user 可綁多個登入方式（apple / google / email / otp），
 * 令用戶換機、換 provider（iOS Apple ↔ Android Google）都搵返同一帳號同資料。
 *
 * 解析次序（單一真實來源）：
 *   1. (provider, providerUserId) 命中 identity → 登入該 user
 *   2. 冇 identity，但 provider 回報「已驗證 email」且非 Apple relay、
 *      冇歧義（只有一個同 email 帳號）、且該帳號唔係 admin → 自動連結
 *   3. 都冇 → 開新 user + identity
 *   永不自動合併兩個已存在帳號（避免搶帳號）。
 */
import { eq, and, sql } from "drizzle-orm";
import { getDb, getUserById, getUserByOpenId, upsertUser } from "./db";
import { userIdentities, users } from "../drizzle/schema";

export type IdentityProvider = "apple" | "google" | "email" | "otp";

export const normalizeEmail = (e?: string | null): string =>
  e ? String(e).trim().toLowerCase() : "";

export const isAppleRelayEmail = (e: string): boolean =>
  /@privaterelay\.appleid\.com$/i.test(String(e || ""));

export async function getIdentity(provider: IdentityProvider, providerUserId: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(userIdentities)
    .where(and(eq(userIdentities.provider, provider), eq(userIdentities.providerUserId, providerUserId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listIdentities(userId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(userIdentities).where(eq(userIdentities.userId, String(userId)));
}

export async function createIdentity(params: {
  userId: string;
  provider: IdentityProvider;
  providerUserId: string;
  email?: string | null;
  emailVerified?: boolean;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(userIdentities)
    .values({
      userId: String(params.userId),
      provider: params.provider,
      providerUserId: params.providerUserId,
      email: normalizeEmail(params.email) || null,
      emailVerified: !!params.emailVerified,
    })
    .onConflictDoNothing();
}

async function touchIdentity(provider: IdentityProvider, providerUserId: string) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(userIdentities)
    .set({ lastLoginAt: new Date() })
    .where(and(eq(userIdentities.provider, provider), eq(userIdentities.providerUserId, providerUserId)));
}

async function countUsersByEmail(email: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.email, email));
  return Number(rows[0]?.c ?? 0);
}

export type ResolveOutcome = "returning" | "linked" | "created";

/**
 * 以一個登入身份解析／建立帳號。
 */
export async function resolveUserForIdentity(params: {
  provider: IdentityProvider;
  providerUserId: string;
  email?: string | null;
  emailVerified?: boolean;
  name?: string | null;
  loginMethod?: string;
}): Promise<{ user: any; outcome: ResolveOutcome } | null> {
  const { provider, providerUserId } = params;
  const email = normalizeEmail(params.email);
  const verified = !!params.emailVerified;

  // 1) 已有 identity
  const ident = await getIdentity(provider, providerUserId);
  if (ident) {
    const user = await getUserById(ident.userId);
    if (user) {
      await touchIdentity(provider, providerUserId);
      return { user, outcome: "returning" };
    }
  }

  // 2) 自動按「已驗證 email」連結（Apple relay / admin / 有歧義 → 唔連）
  if (email && verified && !isAppleRelayEmail(email)) {
    const existing = await getUserByEmailAnyRole(email);
    if (existing && existing.role !== "admin") {
      const n = await countUsersByEmail(email);
      if (n === 1) {
        await createIdentity({ userId: String(existing.id), provider, providerUserId, email, emailVerified: true });
        return { user: existing, outcome: "linked" };
      }
    }
  }

  // 3) 開新帳號
  const openId = `${provider}_${providerUserId}`;
  await upsertUser({
    openId,
    email: email || null,
    name: params.name ?? null,
    loginMethod: params.loginMethod ?? provider,
    lastSignedIn: new Date(),
  });
  const user = await getUserByOpenId(openId);
  if (!user) return null;
  if (verified && !user.emailVerified) {
    const db = await getDb();
    if (db) await db.update(users).set({ emailVerified: true }).where(eq(users.id, user.id));
  }
  await createIdentity({ userId: String(user.id), provider, providerUserId, email, emailVerified: verified });
  return { user, outcome: "created" };
}

/** getUserByEmail 但唔限制大小寫（helpers 專用） */
async function getUserByEmailAnyRole(email: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0] ?? null;
}
