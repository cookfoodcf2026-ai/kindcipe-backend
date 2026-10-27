/**
 * Stripe → family state synchronization.
 *
 * Shared by the webhook and confirmCheckout so a delayed webhook and a browser
 * redirect cannot produce different states. Idempotent by session/subscription.
 */
import type Stripe from "stripe";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { getDb, activateFamilySubscription, getFamilyById, getFamilySubscription } from "../db";
import { getStripe, isStripeConfigured, planForPriceId, tierForPriceId, type StripePriceTier } from "../_core/stripe";
import { ENV } from "../_core/env";
import { earlybirdRedemptions, families, stripeSubscriptions } from "../../drizzle/schema";
import { isCanceledTrial, isStaleBillingEvent } from "./billingRules";

type Plan = "monthly" | "yearly";

function asDate(ts: number | null | undefined): Date | null {
  return ts ? new Date(ts * 1000) : null;
}

function subscriptionPeriodEnd(sub: Stripe.Subscription): Date | null {
  return asDate(
    sub.items?.data?.[0]?.current_period_end ??
      (sub as unknown as { current_period_end?: number | null }).current_period_end
  );
}

function subscriptionTrialEnd(sub: Stripe.Subscription): Date | null {
  return asDate(sub.trial_end);
}

function planFromSubscription(sub: Stripe.Subscription): Plan {
  const priceId = sub.items.data[0]?.price?.id ?? "";
  return (
    planForPriceId(priceId) ??
    (sub.metadata?.plan === "yearly" ? "yearly" : "monthly")
  );
}

function tierFromSubscription(sub: Stripe.Subscription): StripePriceTier {
  const metadataTier = sub.metadata?.priceTier;
  if (metadataTier === "founding" || metadataTier === "regular") return metadataTier;
  const priceId = sub.items.data[0]?.price?.id ?? "";
  return tierForPriceId(priceId);
}

async function findStripeRow(params: {
  subscriptionId?: string | null;
  checkoutSessionId?: string | null;
  familyId?: number;
}) {
  const db = await getDb();
  if (!db) return null;
  if (params.subscriptionId) {
    const [row] = await db
      .select()
      .from(stripeSubscriptions)
      .where(eq(stripeSubscriptions.stripeSubscriptionId, params.subscriptionId))
      .limit(1);
    if (row) return row;
  }
  if (params.checkoutSessionId) {
    const [row] = await db
      .select()
      .from(stripeSubscriptions)
      .where(eq(stripeSubscriptions.stripeCheckoutSessionId, params.checkoutSessionId))
      .limit(1);
    if (row) return row;
  }
  if (params.familyId) {
    const [row] = await db
      .select()
      .from(stripeSubscriptions)
      .where(and(eq(stripeSubscriptions.familyId, params.familyId), eq(stripeSubscriptions.status, "pending")))
      .orderBy(desc(stripeSubscriptions.updatedAt))
      .limit(1);
    if (row) return row;
  }
  return null;
}

/**
 * Stripe does not guarantee webhook delivery order. Ignore an event when we
 * already processed a newer event for the same subscription, or when a newer
 * live subscription already exists for the family.
 */
async function shouldIgnoreSubscriptionEvent(params: {
  sub: Stripe.Subscription;
  familyId: number;
  eventAt: Date;
}): Promise<boolean> {
  const existing = await findStripeRow({
    subscriptionId: params.sub.id,
    familyId: params.familyId,
  });
  if (isStaleBillingEvent(existing?.stripeEventAt, params.eventAt)) {
    return true;
  }

  if (!params.sub.created) return false;
  const db = await getDb();
  if (!db) return false;
  const [newer] = await db
    .select({ id: stripeSubscriptions.id })
    .from(stripeSubscriptions)
    .where(
      and(
        eq(stripeSubscriptions.familyId, params.familyId),
        inArray(stripeSubscriptions.status, ["active", "trialing", "past_due"]),
        gt(stripeSubscriptions.stripeCreatedAt, new Date(params.sub.created * 1000)),
        ne(stripeSubscriptions.stripeSubscriptionId, params.sub.id)
      )
    )
    .limit(1);
  return Boolean(newer);
}

async function upsertStripeSubscription(params: {
  familyId: number;
  userId?: string;
  customerId?: string | null;
  subscriptionId: string;
  checkoutSessionId?: string | null;
  plan: Plan;
  tier: StripePriceTier;
  status: string;
  currentPeriodEnd: Date | null;
  trialEnd: Date | null;
  promoCode?: string | null;
  eventAt: Date;
  subscriptionCreatedAt: Date | null;
}) {
  const db = await getDb();
  if (!db) return;
  const existing = await findStripeRow({
    subscriptionId: params.subscriptionId,
    checkoutSessionId: params.checkoutSessionId,
    familyId: params.familyId,
  });
  const values = {
    familyId: params.familyId,
    userId: params.userId ?? existing?.userId ?? "",
    stripeCustomerId: params.customerId ?? existing?.stripeCustomerId ?? null,
    stripeSubscriptionId: params.subscriptionId,
    stripeCheckoutSessionId: params.checkoutSessionId ?? existing?.stripeCheckoutSessionId ?? null,
    productId: `kindcipe_stripe_${params.tier}_${params.plan}`,
    planType: params.plan,
    status: params.status,
    currentPeriodEnd: params.currentPeriodEnd,
    checkoutExpiresAt: null,
    promoCode: params.promoCode ?? existing?.promoCode ?? null,
    priceTier: params.tier,
    trialEnd: params.trialEnd,
    stripeEventAt: params.eventAt,
    stripeCreatedAt: params.subscriptionCreatedAt,
    updatedAt: new Date(),
  };
  if (existing) {
    await db.update(stripeSubscriptions).set(values).where(eq(stripeSubscriptions.id, existing.id));
  } else {
    await db.insert(stripeSubscriptions).values(values);
  }
}

async function setFamilyExpired(familyId: number) {
  const db = await getDb();
  if (!db) return;
  const family = await getFamilyById(familyId);
  if (!family) return;
  const nextStatus = family.subscriptionStatus === "trial" ? "free" : "expired";
  await db
    .update(families)
    .set({ subscriptionStatus: nextStatus, maxMembers: 2, updatedAt: new Date() })
    .where(eq(families.id, familyId));
}

async function markEarlybirdPaid(params: {
  familyId: number;
  userId?: string | null;
  subscriptionId: string;
  checkoutSessionId?: string | null;
}) {
  const db = await getDb();
  if (!db) return;
  const now = new Date();
  const family = await getFamilyById(params.familyId);
  await db
    .insert(earlybirdRedemptions)
    .values({
      familyId: params.familyId,
      userId: params.userId?.trim() || family?.ownerId || "",
      stripeSubscriptionId: params.subscriptionId,
      stripeCheckoutSessionId: params.checkoutSessionId ?? null,
      status: "paid",
      paidAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: earlybirdRedemptions.familyId,
      set: {
        status: "paid",
        stripeSubscriptionId: params.subscriptionId,
        ...(params.checkoutSessionId
          ? { stripeCheckoutSessionId: params.checkoutSessionId }
          : {}),
        paidAt: now,
        releasedAt: null,
        updatedAt: now,
      },
    });
}

export async function releaseEarlybird(params: {
  familyId?: number;
  subscriptionId?: string | null;
  checkoutSessionId?: string | null;
}) {
  const db = await getDb();
  if (!db) return;
  const where = params.subscriptionId
    ? and(
        eq(earlybirdRedemptions.status, "reserved"),
        eq(earlybirdRedemptions.stripeSubscriptionId, params.subscriptionId)
      )
    : params.checkoutSessionId
      ? and(
          eq(earlybirdRedemptions.status, "reserved"),
          eq(earlybirdRedemptions.stripeCheckoutSessionId, params.checkoutSessionId)
        )
      : params.familyId
        ? and(
            eq(earlybirdRedemptions.status, "reserved"),
            eq(earlybirdRedemptions.familyId, params.familyId)
          )
        : null;
  if (!where) return;
  await db
    .update(earlybirdRedemptions)
    .set({ status: "released", releasedAt: new Date(), updatedAt: new Date() })
    .where(where);
}

async function applySubscription(params: {
  sub: Stripe.Subscription;
  familyId: number;
  plan: Plan;
  tier: StripePriceTier;
  checkoutSessionId?: string | null;
  promoCode?: string | null;
  eventAt?: Date;
}) {
  const { sub, familyId, plan, tier } = params;
  const eventAt = params.eventAt ?? new Date();
  if (await shouldIgnoreSubscriptionEvent({ sub, familyId, eventAt })) return;

  const periodEnd = subscriptionPeriodEnd(sub);
  const trialEnd = subscriptionTrialEnd(sub);
  const now = new Date();

  if (sub.status === "trialing") {
    const db = await getDb();
    if (db) {
      await db
        .update(families)
        .set({
          subscriptionStatus: "trial",
          subscriptionPlan: plan,
          trialEndsAt: trialEnd ?? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
          maxMembers: 4,
          updatedAt: now,
        })
        .where(eq(families.id, familyId));

      // Attach the subscription before it converts/cancels so a later
      // cancellation can release exactly this reservation, not another one.
      if (tier === "founding") {
        await db
          .update(earlybirdRedemptions)
          .set({ stripeSubscriptionId: sub.id, updatedAt: now })
          .where(
            and(
              eq(earlybirdRedemptions.familyId, familyId),
              eq(earlybirdRedemptions.status, "reserved")
            )
          );
      }
    }
  } else if (sub.status === "active") {
    await activateFamilySubscription(familyId, plan, periodEnd ?? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000));
    if (tier === "founding") {
      await markEarlybirdPaid({
        familyId,
        userId: sub.metadata?.userId,
        subscriptionId: sub.id,
        checkoutSessionId: params.checkoutSessionId,
      });
    }
  } else if (sub.status === "past_due") {
    if (periodEnd && periodEnd > now) {
      await activateFamilySubscription(familyId, plan, periodEnd);
    } else {
      await setFamilyExpired(familyId);
    }
  } else if (sub.status === "canceled") {
    // A canceled trial is not a paid-through subscription. Stripe may still
    // report a future trial_end, so never promote it to active paid access.
    // A paid subscription canceled during a trial has current_period_end
    // beyond trial_end and must keep its paid-through access.
    const canceledDuringTrial = isCanceledTrial({
      trialEnd,
      currentPeriodEnd: periodEnd,
      now,
    });
    if (!canceledDuringTrial && periodEnd && periodEnd > now) {
      await activateFamilySubscription(familyId, plan, periodEnd);
    } else {
      await setFamilyExpired(familyId);
    }
    await releaseEarlybird({ subscriptionId: sub.id });
  } else if (sub.status === "unpaid" || sub.status === "incomplete_expired" || sub.status === "paused") {
    await setFamilyExpired(familyId);
    await releaseEarlybird({ subscriptionId: sub.id });
  }

  await upsertStripeSubscription({
    familyId,
    userId: sub.metadata?.userId,
    customerId: typeof sub.customer === "string" ? sub.customer : null,
    subscriptionId: sub.id,
    checkoutSessionId: params.checkoutSessionId,
    plan,
    tier,
    status: sub.status,
    currentPeriodEnd: periodEnd,
    trialEnd,
    promoCode: params.promoCode ?? sub.metadata?.promoCode ?? null,
    eventAt,
    subscriptionCreatedAt: sub.created ? new Date(sub.created * 1000) : null,
  });
}

/** Reconcile a Checkout Session (webhook + post-redirect fallback). */
export async function syncCheckoutSession(
  session: Stripe.Checkout.Session,
  opts: { eventAt?: Date } = {}
) {
  const familyId = Number(session.metadata?.familyId ?? session.client_reference_id);
  if (!familyId) throw new TRPCError({ code: "BAD_REQUEST", message: "缺少家庭資訊" });

  const paymentOk =
    session.payment_status === "paid" || session.payment_status === "no_payment_required";
  if (!paymentOk) {
    return { status: "pending" as const, familyId };
  }

  if (!session.subscription) {
    return { status: "pending" as const, familyId };
  }
  const sub =
    typeof session.subscription === "string"
      ? await getStripe().subscriptions.retrieve(session.subscription)
      : session.subscription;
  const plan = (session.metadata?.plan === "yearly"
    ? "yearly"
    : session.metadata?.plan === "monthly"
      ? "monthly"
      : planFromSubscription(sub)) as Plan;
  const tier = (session.metadata?.priceTier === "founding"
    ? "founding"
    : session.metadata?.priceTier === "regular"
      ? "regular"
      : tierFromSubscription(sub)) as StripePriceTier;
  await applySubscription({
    sub,
    familyId,
    plan,
    tier,
    checkoutSessionId: session.id,
    promoCode: session.metadata?.promoCode ?? null,
    eventAt: opts.eventAt,
  });

  if (sub.status === "trialing") {
    return { status: "trial" as const, familyId };
  }
  if (sub.status === "active") {
    return { status: "active" as const, familyId };
  }
  return { status: "pending" as const, familyId };
}

/** Reconcile a subscription (updated/deleted/invoice.paid). */
export async function syncSubscription(
  sub: Stripe.Subscription,
  opts: { checkoutSessionId?: string | null; promoCode?: string | null; eventAt?: Date } = {}
) {
  let familyId = Number(sub.metadata?.familyId);
  if (!familyId) {
    const row = await findStripeRow({ subscriptionId: sub.id });
    familyId = Number(row?.familyId ?? 0);
  }
  if (!familyId) return null;
  await applySubscription({
    sub,
    familyId,
    plan: planFromSubscription(sub),
    tier: tierFromSubscription(sub),
    checkoutSessionId: opts.checkoutSessionId,
    promoCode: opts.promoCode,
    eventAt: opts.eventAt,
  });
  return familyId;
}

export async function syncInvoicePaid(invoice: Stripe.Invoice, eventAt?: Date) {
  const legacy = invoice as unknown as {
    subscription?: string | { id: string } | null;
  };
  const modern = invoice as unknown as {
    parent?: { subscription_details?: { subscription?: string | { id: string } | null } };
  };
  const raw =
    legacy.subscription ?? modern.parent?.subscription_details?.subscription ?? null;
  const subId = typeof raw === "string" ? raw : raw?.id ?? null;
  if (!subId) return null;
  const sub = await getStripe().subscriptions.retrieve(subId);
  return syncSubscription(sub, { eventAt });
}

export async function confirmCheckoutSession(sessionId: string) {
  const session = await getStripe().checkout.sessions.retrieve(sessionId, {
    expand: ["subscription"],
  });
  return syncCheckoutSession(session, {
    eventAt: session.created ? new Date(session.created * 1000) : undefined,
  });
}

/** Release reservations whose Stripe Checkout Session has expired. */
export async function expireStaleReservations(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const pending = await db
    .select({
      sessionId: stripeSubscriptions.stripeCheckoutSessionId,
      familyId: stripeSubscriptions.familyId,
    })
    .from(stripeSubscriptions)
    .where(
      and(
        eq(stripeSubscriptions.status, "pending"),
        sql`${stripeSubscriptions.checkoutExpiresAt} < now()`
      )
    );

  const staleSessionIds: string[] = [];
  for (const row of pending) {
    if (!row.sessionId) {
      await db
        .update(stripeSubscriptions)
        .set({ status: "expired", updatedAt: new Date() })
        .where(
          and(
            eq(stripeSubscriptions.familyId, row.familyId),
            eq(stripeSubscriptions.status, "pending")
          )
        );
      continue;
    }

    if (!isStripeConfigured()) continue;
    try {
      const session = await getStripe().checkout.sessions.retrieve(row.sessionId);
      const paid =
        session.payment_status === "paid" || session.payment_status === "no_payment_required";
      if (paid) {
        // A paid session must never release the slot just because our local
        // expiry timestamp is stale. Let webhook retry if this sync fails.
        if (session.subscription) {
          await syncCheckoutSession(session, {
            eventAt: session.created ? new Date(session.created * 1000) : undefined,
          });
        }
        continue;
      }
      if (session.status === "open" && session.expires_at * 1000 > Date.now()) {
        await db
          .update(stripeSubscriptions)
          .set({ checkoutExpiresAt: new Date(session.expires_at * 1000), updatedAt: new Date() })
          .where(
            and(
              eq(stripeSubscriptions.stripeCheckoutSessionId, row.sessionId),
              eq(stripeSubscriptions.status, "pending")
            )
          );
        continue;
      }
      staleSessionIds.push(row.sessionId);
    } catch (error) {
      console.warn("[stripe] Failed to verify stale checkout session", row.sessionId, error);
    }
  }

  if (!staleSessionIds.length) return;
  await db.transaction(async (tx) => {
    await tx
      .update(earlybirdRedemptions)
      .set({ status: "released", releasedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(earlybirdRedemptions.status, "reserved"),
          inArray(earlybirdRedemptions.stripeCheckoutSessionId, staleSessionIds)
        )
      );
    await tx
      .update(stripeSubscriptions)
      .set({ status: "expired", updatedAt: new Date() })
      .where(
        and(
          eq(stripeSubscriptions.status, "pending"),
          inArray(stripeSubscriptions.stripeCheckoutSessionId, staleSessionIds)
        )
      );
  });
}

/**
 * Reserve a founding slot + pending Stripe row atomically. The caller has
 * already created a Stripe session; if this throws, the caller expires it.
 */
export async function recordFoundingCheckout(params: {
  familyId: number;
  userId: string;
  customerId: string;
  sessionId: string;
  checkoutExpiresAt: Date;
  plan: Plan;
  tier: StripePriceTier;
  promoCode: string;
  trialEnd: Date | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "資料庫暫時不可用" });
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('kindcipe_earlybird_capacity'))`);
    const [existing] = await tx
      .select()
      .from(earlybirdRedemptions)
      .where(eq(earlybirdRedemptions.familyId, params.familyId))
      .for("update");
    if (existing?.status === "paid") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "你已是創始會員" });
    }
    if (existing?.status === "reserved") {
      throw new TRPCError({ code: "CONFLICT", message: "已有進行中的付款，請稍後再試" });
    }
    const [heldRow] = await tx
      .select({ held: sql<number>`count(*)::int` })
      .from(earlybirdRedemptions)
      .where(ne(earlybirdRedemptions.status, "released"));
    if ((heldRow?.held ?? 0) >= ENV.earlybirdCap) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "首100個創始會員名額已滿" });
    }
    await tx.insert(stripeSubscriptions).values({
      familyId: params.familyId,
      userId: params.userId,
      stripeCustomerId: params.customerId,
      stripeCheckoutSessionId: params.sessionId,
      productId: `kindcipe_stripe_${params.tier}_${params.plan}`,
      planType: params.plan,
      status: "pending",
      checkoutExpiresAt: params.checkoutExpiresAt,
      promoCode: params.promoCode,
      priceTier: params.tier,
      trialEnd: params.trialEnd,
      updatedAt: new Date(),
    });
    if (existing) {
      await tx
        .update(earlybirdRedemptions)
        .set({
          userId: params.userId,
          stripeSubscriptionId: null,
          stripeCheckoutSessionId: params.sessionId,
          status: "reserved",
          reservedAt: new Date(),
          paidAt: null,
          releasedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(earlybirdRedemptions.id, existing.id));
    } else {
      await tx.insert(earlybirdRedemptions).values({
        familyId: params.familyId,
        userId: params.userId,
        stripeCheckoutSessionId: params.sessionId,
        status: "reserved",
      });
    }
  });
}

/** Checkout expired/canceled before payment: release the slot. */
export async function expireCheckoutSession(sessionId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await releaseEarlybird({ checkoutSessionId: sessionId });
  await db
    .update(stripeSubscriptions)
    .set({ status: "expired", updatedAt: new Date() })
    .where(
      and(
        eq(stripeSubscriptions.stripeCheckoutSessionId, sessionId),
        eq(stripeSubscriptions.status, "pending")
      )
    );
}

/** Used by checkout to report whether a family is already active. */
export async function isFamilyBillingActive(familyId: number): Promise<boolean> {
  const sub = await getFamilySubscription(familyId);
  if (sub?.status === "active" || sub?.status === "trial") return true;
  return false;
}
