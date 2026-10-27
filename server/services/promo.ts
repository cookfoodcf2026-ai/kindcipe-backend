/**
 * Trial-first Instagram promo (C9T) + first-100 founding member state.
 *
 * C9T grants a 7-day trial and auto-issues a family-bound C9D code. C9D is
 * never shown to clients: checkout resolves it server-side and applies the
 * founding Stripe price ID. The 7 days after trial end are a CLAIM WINDOW,
 * not a 7-day discount.
 */
import { randomInt } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb, getFamilySubscription } from "../db";
import { ENV } from "../_core/env";
import { isPromoPricingConfigured } from "../_core/stripe";
import {
  earlybirdRedemptions,
  families,
  iapTransactions,
  promoCodes,
  promoCodeRedemptions,
  stripeSubscriptions,
  users,
} from "../../drizzle/schema";

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const DAY_MS = 24 * 60 * 60 * 1000;

export type PromoKind = "C9T" | "C9D" | "C9F";

export function generatePromoCode(kind: PromoKind): string {
  let suffix = "";
  for (let i = 0; i < 8; i++) suffix += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${kind}-${suffix}`;
}

export function discountWindowEnd(trialEndsAt: Date | null | undefined): Date | null {
  if (!trialEndsAt) return null;
  return new Date(trialEndsAt.getTime() + ENV.earlybirdWindowDays * DAY_MS);
}

export async function getEarlybirdCounts(): Promise<{
  paid: number;
  reserved: number;
  held: number;
  slotsRemaining: number;
}> {
  const db = await getDb();
  if (!db) return { paid: 0, reserved: 0, held: 0, slotsRemaining: ENV.earlybirdCap };
  const [row] = await db
    .select({
      paid: sql<number>`count(*) filter (where ${earlybirdRedemptions.status} = 'paid')::int`,
      reserved: sql<number>`count(*) filter (where ${earlybirdRedemptions.status} = 'reserved')::int`,
      held: sql<number>`count(*) filter (where ${earlybirdRedemptions.status} <> 'released')::int`,
    })
    .from(earlybirdRedemptions);
  const paid = row?.paid ?? 0;
  const reserved = row?.reserved ?? 0;
  const held = row?.held ?? 0;
  return { paid, reserved, held, slotsRemaining: Math.max(0, ENV.earlybirdCap - held) };
}

export async function getPromoState(familyId: number, userId: string) {
  const db = await getDb();
  if (!db) return null;
  const [family] = await db.select().from(families).where(eq(families.id, familyId)).limit(1);
  if (!family) return null;

  const sub = await getFamilySubscription(familyId);
  const [redemption] = await db
    .select({ code: promoCodeRedemptions.code })
    .from(promoCodeRedemptions)
    .where(eq(promoCodeRedemptions.familyId, familyId))
    .limit(1);
  const [member] = await db
    .select({ trialCount: users.trialCount })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const [earlybird] = await db
    .select({ status: earlybirdRedemptions.status })
    .from(earlybirdRedemptions)
    .where(eq(earlybirdRedemptions.familyId, familyId))
    .limit(1);
  const [foundingCode] = await db
    .select({ code: promoCodes.code })
    .from(promoCodes)
    .where(
      and(
        eq(promoCodes.assignedFamilyId, familyId),
        eq(promoCodes.plan, "founding"),
        ne(promoCodes.usedCount, 0)
      )
    )
    .limit(1);
  const counts = await getEarlybirdCounts();
  const [stripe] = await db
    .select({ status: stripeSubscriptions.status })
    .from(stripeSubscriptions)
    .where(
      and(
        eq(stripeSubscriptions.familyId, familyId),
        inArray(stripeSubscriptions.status, ["active", "trialing", "past_due", "pending", "unpaid", "canceled"])
      )
    )
    .orderBy(desc(stripeSubscriptions.updatedAt))
    .limit(1);
  const [iap] = await db
    .select({ id: iapTransactions.id })
    .from(iapTransactions)
    .where(eq(iapTransactions.familyId, familyId))
    .limit(1);
  const [priorStripe] = await db
    .select({ id: stripeSubscriptions.id })
    .from(stripeSubscriptions)
    .where(
      and(
        eq(stripeSubscriptions.familyId, familyId),
        inArray(stripeSubscriptions.status, ["active", "trialing", "past_due", "unpaid", "canceled"])
      )
    )
    .limit(1);

  const now = new Date();
  const promoEnabled = ENV.earlybirdPromoActive && isPromoPricingConfigured();
  const trialEndsAt = family.trialEndsAt ?? sub?.trialEndsAt ?? null;
  const discountExpiresAt = null;
  const foundingMember = earlybird?.status === "paid";
  const priorPaid = Boolean(iap || priorStripe);
  const activePaid = sub?.status === "active";
  const promoActive = Boolean(
    promoEnabled &&
      (earlybird?.status === "reserved" || Boolean(foundingCode)) &&
      !foundingMember &&
      !activePaid
  );
  const freeOrExpired = sub?.status === "free" || sub?.status === "expired";
  const trialUsed = Boolean(member?.trialCount || redemption || trialEndsAt || priorPaid);
  const trialEligible = Boolean(
    promoEnabled &&
      freeOrExpired &&
      !trialUsed &&
      !foundingMember &&
      counts.held < ENV.earlybirdCap
  );

  const billingProvider =
    stripe && ["active", "trialing", "past_due"].includes(stripe.status)
      ? "stripe"
      : iap
        ? "apple"
        : family.googleOrderId
          ? "google"
          : null;

  return {
    promoActive,
    promoEnabled,
    trialEligible,
    trialUsed,
    trialEndsAt,
    discountExpiresAt,
    foundingMember,
    earlybirdPaidCount: counts.paid,
    earlybirdHeldCount: counts.held,
    earlybirdSlotsRemaining: counts.slotsRemaining,
    earlybirdCap: ENV.earlybirdCap,
    priceTier: foundingMember || earlybird?.status === "reserved" || Boolean(foundingCode) ? "founding" : "regular",
    billingProvider,
  };
}

/**
 * Create the family-bound C9D if an older trial predates automatic issuance.
 * Returns null when the family is not inside a claim window.
 */
export async function ensureC9DForFamily(familyId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const [existing] = await db
    .select({ code: promoCodes.code })
    .from(promoCodes)
    .where(eq(promoCodes.assignedFamilyId, familyId))
    .orderBy(desc(promoCodes.createdAt))
    .limit(1);
  if (existing?.code) return existing.code;

  const [family] = await db.select().from(families).where(eq(families.id, familyId)).limit(1);
  const windowEnd = discountWindowEnd(family?.trialEndsAt);
  if (!windowEnd || windowEnd <= new Date()) return null;

  const code = generatePromoCode("C9D");
  const inserted = await db
    .insert(promoCodes)
    .values({
      code,
      plan: "earlybird",
      maxUses: 1,
      expiresAt: windowEnd,
      assignedFamilyId: familyId,
      autoIssued: true,
      note: `Auto-issued after C9T trial for family ${familyId}`,
    })
    .onConflictDoNothing()
    .returning({ code: promoCodes.code });
  if (inserted[0]?.code) return inserted[0].code;
  const [again] = await db
    .select({ code: promoCodes.code })
    .from(promoCodes)
    .where(eq(promoCodes.assignedFamilyId, familyId))
    .orderBy(desc(promoCodes.createdAt))
    .limit(1);
  return again?.code ?? null;
}

export interface RedeemTrialResult {
  status: "trial";
  expiresAt: string;
  discountExpiresAt: string;
  maxMembers: number;
}

/**
 * Redeem a C9T code atomically. Any current member may redeem; every current
 * member is marked as trial-used so leaving/rejoining cannot farm trials.
 */
export async function redeemTrialCode(params: {
  familyId: number;
  userId: string;
  code: string;
}): Promise<RedeemTrialResult> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "資料庫暫時不可用" });
  if (!ENV.earlybirdPromoActive || !isPromoPricingConfigured()) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "試用活動未開放" });
  }
  const code = params.code.trim().toUpperCase();
  if (!code.startsWith("C9T-")) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "試用碼無效" });
  }

  return db.transaction(async (tx) => {
    const [promo] = await tx
      .select()
      .from(promoCodes)
      .where(eq(promoCodes.code, code))
      .for("update");
    if (!promo || !promo.active || promo.plan !== "trial7") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "試用碼無效" });
    }
    if (promo.assignedFamilyId && promo.assignedFamilyId !== params.familyId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "試用碼無效" });
    }

    const [family] = await tx
      .select()
      .from(families)
      .where(eq(families.id, params.familyId))
      .for("update");
    if (!family) throw new TRPCError({ code: "NOT_FOUND", message: "找不到家庭廚房" });
    const [user] = await tx
      .select({ id: users.id, trialCount: users.trialCount })
      .from(users)
      .where(eq(users.id, params.userId))
      .for("update");
    if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "找不到用戶" });

    const now = new Date();
    if (promo.expiresAt && promo.expiresAt < now) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "試用碼已過期" });
    }
    if (promo.usedCount >= promo.maxUses) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "試用碼已用盡" });
    }
    if (family.subscriptionStatus !== "free" && family.subscriptionStatus !== "expired") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "目前方案不可兌換試用碼" });
    }
    if (user.trialCount > 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "你已使用過免費試用" });
    }
    const [priorIap] = await tx
      .select({ id: iapTransactions.id })
      .from(iapTransactions)
      .where(eq(iapTransactions.familyId, params.familyId))
      .limit(1);
    const [priorStripe] = await tx
      .select({ id: stripeSubscriptions.id })
      .from(stripeSubscriptions)
      .where(
        and(
          eq(stripeSubscriptions.familyId, params.familyId),
          inArray(stripeSubscriptions.status, [
            "active",
            "trialing",
            "past_due",
            "unpaid",
            "canceled",
          ])
        )
      )
      .limit(1);
    if (
      priorIap ||
      priorStripe ||
      family.trialEndsAt ||
      family.subscriptionExpiresAt ||
      family.appleTransactionId ||
      family.googleOrderId
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "此廚房已使用過試用或付款，無法再兌換 C9T",
      });
    }
    const [existingRedemption] = await tx
      .select({ id: promoCodeRedemptions.id })
      .from(promoCodeRedemptions)
      .where(eq(promoCodeRedemptions.familyId, params.familyId))
      .limit(1);
    if (existingRedemption) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "此廚房已兌換過試用碼" });
    }
    const [existingEarlybird] = await tx
      .select({ id: earlybirdRedemptions.id, status: earlybirdRedemptions.status })
      .from(earlybirdRedemptions)
      .where(eq(earlybirdRedemptions.familyId, params.familyId))
      .limit(1);
    if (existingEarlybird && existingEarlybird.status !== "released") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "此廚房已有會員記錄" });
    }

    const claimedUser = await tx
      .update(users)
      .set({ trialCount: sql`${users.trialCount} + 1`, updatedAt: now })
      .where(and(eq(users.id, params.userId), eq(users.trialCount, 0)))
      .returning({ id: users.id });
    if (claimedUser.length === 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "你已使用過免費試用" });
    }

    const trialEndsAt = new Date(now.getTime() + 7 * DAY_MS);
    await tx
      .update(families)
      .set({
        subscriptionStatus: "trial",
        subscriptionPlan: null,
        trialStartedAt: now,
        trialEndsAt,
        maxMembers: 4,
        updatedAt: now,
      })
      .where(eq(families.id, params.familyId));

    // Every current member consumes their one-time trial, even if they later
    // leave or the family is dissolved.
    await tx.execute(sql`
      update users u
         set trial_count = 1, updated_at = now()
       where u.id::text in (
         select fm.user_id from family_members fm where fm.family_id = ${params.familyId}
       )
         and u.trial_count = 0
    `);

    await tx
      .update(promoCodes)
      .set({ usedCount: sql`${promoCodes.usedCount} + 1` })
      .where(and(eq(promoCodes.code, code), sql`${promoCodes.usedCount} < ${promoCodes.maxUses}`));
    await tx.insert(promoCodeRedemptions).values({
      code,
      familyId: params.familyId,
      userId: params.userId,
    });

    const windowEnd = discountWindowEnd(trialEndsAt)!;
    return {
      status: "trial" as const,
      expiresAt: trialEndsAt.toISOString(),
      discountExpiresAt: windowEnd.toISOString(),
      maxMembers: 4,
    };
  });
}

export interface RedeemFoundingResult {
  status: "founding";
  priceTier: "founding";
  maxMembers: number;
}

export async function redeemFoundingCode(params: {
  familyId: number;
  userId: string;
  code: string;
}): Promise<RedeemFoundingResult> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "資料庫暫時不可用" });
  if (!ENV.earlybirdPromoActive || !isPromoPricingConfigured()) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "創始會員活動未開放" });
  }
  const code = params.code.trim().toUpperCase();
  if (!code.startsWith("C9F-")) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "創始會員碼無效" });
  }

  return db.transaction(async (tx) => {
    const [promo] = await tx
      .select()
      .from(promoCodes)
      .where(eq(promoCodes.code, code))
      .for("update");
    if (!promo || !promo.active || promo.plan !== "founding") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "創始會員碼無效" });
    }
    if (promo.assignedFamilyId && promo.assignedFamilyId !== params.familyId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "此創始會員碼不屬於此廚房" });
    }
    const [family] = await tx
      .select()
      .from(families)
      .where(eq(families.id, params.familyId))
      .for("update");
    if (!family) throw new TRPCError({ code: "NOT_FOUND", message: "找不到家庭廚房" });
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, params.userId))
      .for("update");
    if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "找不到用戶" });

    const now = new Date();
    if (promo.expiresAt && promo.expiresAt < now) throw new TRPCError({ code: "BAD_REQUEST", message: "創始會員碼已過期" });
    if (promo.usedCount >= promo.maxUses) throw new TRPCError({ code: "BAD_REQUEST", message: "創始會員碼已用盡" });
    if (family.subscriptionStatus !== "free" && family.subscriptionStatus !== "expired") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "目前方案不可使用創始會員碼" });
    }
    const [existing] = await tx
      .select({ id: earlybirdRedemptions.id, status: earlybirdRedemptions.status })
      .from(earlybirdRedemptions)
      .where(eq(earlybirdRedemptions.familyId, params.familyId))
      .for("update");
    if (existing && existing.status === "paid") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "此廚房已有創始會員記錄" });
    }

    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('kindcipe_earlybird_capacity'))`);
    const [heldRow] = await tx
      .select({ held: sql<number>`count(*)::int` })
      .from(earlybirdRedemptions)
      .where(ne(earlybirdRedemptions.status, "released"));
    if ((heldRow?.held ?? 0) >= ENV.earlybirdCap) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "首100個創始會員名額已滿" });
    }

    await tx.update(promoCodes)
      .set({ usedCount: sql`${promoCodes.usedCount} + 1` })
      .where(and(eq(promoCodes.code, code), sql`${promoCodes.usedCount} < ${promoCodes.maxUses}`));

    return { status: "founding" as const, priceTier: "founding" as const, maxMembers: 4 };
  });
}
