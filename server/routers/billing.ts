/**
 * Billing router — Stripe checkout / portal / status for web only.
 *
 * Native iOS uses Apple IAP; Android stays free until Play Billing lands.
 * Stripe checkout is always server-priced: clients can never pass a price,
 * discount, or promo code. C9D is resolved from the family server-side.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, getFamilySubscription } from "../db";
import { stripeSubscriptions } from "../../drizzle/schema";
import {
  getStripe,
  isStripeConfigured,
  isPromoPricingConfigured,
  priceIdForPlan,
  getPlanPrice,
  type StripePriceTier,
} from "../_core/stripe";
import { ENV } from "../_core/env";
import { pendingCheckoutMatches } from "../services/billingRules";
import { getPromoState } from "../services/promo";
import {
  expireCheckoutSession,
  expireStaleReservations,
  recordFoundingCheckout,
  syncCheckoutSession,
} from "../services/stripeBilling";

const SELF_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean)
);

const PLAN = z.enum(["monthly", "yearly"]);
const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_MIN_REMAINING_MS = 48 * 60 * 60 * 1000;

function isUniqueViolation(error: unknown): boolean {
  let current = error as
    | (Error & { code?: string; cause?: unknown })
    | undefined;
  while (current) {
    if (current.code === "23505" || /duplicate key value/i.test(current.message ?? "")) {
      return true;
    }
    current = current.cause as typeof current;
  }
  return false;
}

function resolveReturnUrl(kind: "success" | "cancel", fallback: string): string {
  const explicit = kind === "success" ? ENV.stripeSuccessUrl : ENV.stripeCancelUrl;
  if (explicit) {
    if (kind === "success" && !explicit.includes("{CHECKOUT_SESSION_ID}")) {
      return `${explicit}${explicit.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`;
    }
    return explicit;
  }
  return fallback;
}

async function buildQuote(familyId: number, userId: string, plan: "monthly" | "yearly") {
  const state = await getPromoState(familyId, userId);
  if (!state) throw new TRPCError({ code: "NOT_FOUND", message: "找不到家庭廚房" });

  const tier: StripePriceTier =
    state.promoActive && state.earlybirdSlotsRemaining > 0 ? "founding" : "regular";
  if (tier === "founding" && !isPromoPricingConfigured()) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "創始會員價格未設定" });
  }

  const price = await getPlanPrice(plan, tier);
  if (!price) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "價格未設定" });

  const trialEndsAt = state.trialEndsAt ? new Date(state.trialEndsAt).getTime() : 0;
  const trialRemaining = trialEndsAt - Date.now();
  const trialEnd =
    tier === "founding" && trialRemaining >= TRIAL_MIN_REMAINING_MS
      ? new Date(trialEndsAt)
      : null;
  const trialDays = trialEnd ? Math.max(1, Math.ceil(trialRemaining / DAY_MS)) : 0;

  return {
    ...state,
    tier,
    amount: price.amount,
    currency: price.currency,
    trialEnd,
    trialDays,
    chargeToday: trialEnd ? 0 : price.amount,
  };
}

export const billingRouter = router({
  /** Whether Stripe is configured (frontend can hide/disable web checkout). */
  status: protectedProcedure.query(async () => {
    return {
      configured: isStripeConfigured(),
      promoEnabled: ENV.earlybirdPromoActive && isPromoPricingConfigured(),
    };
  }),

  /** Server-authoritative order summary. No client price/code is trusted. */
  previewCheckout: protectedProcedure
    .input(z.object({ plan: PLAN }))
    .query(async ({ ctx, input }) => {
      if (!isStripeConfigured()) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "網上付款暫時未開放，請稍後再試。" });
      }
      if (!ctx.activeFamilyId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "請先加入家庭廚房" });
      }
      const q = await buildQuote(ctx.activeFamilyId, String(ctx.user.id), input.plan);
      return {
        tier: q.tier,
        amount: q.amount,
        currency: q.currency,
        chargeToday: q.chargeToday,
        trialEnd: q.trialEnd ? q.trialEnd.toISOString() : null,
        trialDays: q.trialDays,
        promoActive: q.promoActive,
        trialEligible: q.trialEligible,
        trialUsed: q.trialUsed,
        foundingMember: q.foundingMember,
        discountExpiresAt: null,
        slotsRemaining: q.earlybirdSlotsRemaining,
      };
    }),

  /**
   * Create a Stripe Checkout Session. Price tier, C9D and trial_end are
   * decided here; the client cannot influence them.
   */
  createCheckoutSession: protectedProcedure
    .input(
      z.object({
        plan: PLAN,
        /** Origin the browser should return to (validated against ALLOWED_ORIGINS). */
        returnUrl: z.string().url().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!isStripeConfigured()) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "網上付款暫時未開放，請稍後再試。" });
      }
      if (!ctx.activeFamilyId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "請先加入家庭廚房" });
      }
      const familyId = ctx.activeFamilyId;
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "資料庫暫時不可用" });
      const stripe = getStripe();

      await expireStaleReservations();

      const effective = await getFamilySubscription(familyId);
      if (effective?.status === "active") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "此廚房已有有效訂閱" });
      }

      const [live] = await db
        .select({ status: stripeSubscriptions.status })
        .from(stripeSubscriptions)
        .where(
          and(
            eq(stripeSubscriptions.familyId, familyId),
            inArray(stripeSubscriptions.status, ["active", "trialing", "past_due"])
          )
        )
        .orderBy(desc(stripeSubscriptions.updatedAt))
        .limit(1);
      if (live) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "此廚房已有有效訂閱" });
      }

      const quote = await buildQuote(familyId, String(ctx.user.id), input.plan);
      const getOpenPendingCheckout = async () => {
        const [row] = await db
          .select()
          .from(stripeSubscriptions)
          .where(
            and(
              eq(stripeSubscriptions.familyId, familyId),
              eq(stripeSubscriptions.status, "pending")
            )
          )
          .orderBy(desc(stripeSubscriptions.updatedAt))
          .limit(1);
        if (!row?.stripeCheckoutSessionId) return null;
        try {
          const existing = await stripe.checkout.sessions.retrieve(
            row.stripeCheckoutSessionId
          );
          if (existing.status === "open" && existing.url) {
            return {
              url: existing.url,
              tier: row.priceTier === "founding" ? ("founding" as const) : ("regular" as const),
              trialEnd: row.trialEnd ? row.trialEnd.toISOString() : null,
            };
          }
        } catch {
          // Fall through: the caller will expire/recreate or report an error.
        }
        return null;
      };

      // Reuse only a pending checkout for the same plan/tier/trial window.
      const [pending] = await db
        .select()
        .from(stripeSubscriptions)
        .where(and(eq(stripeSubscriptions.familyId, familyId), eq(stripeSubscriptions.status, "pending")))
        .orderBy(desc(stripeSubscriptions.updatedAt))
        .limit(1);
      if (pending) {
        const sameQuote = pendingCheckoutMatches({
          pendingPlan: pending.planType,
          pendingTier: pending.priceTier,
          pendingTrialEnd: pending.trialEnd,
          plan: input.plan,
          tier: quote.tier,
          trialEnd: quote.trialEnd,
        });
        if (sameQuote && pending.stripeCheckoutSessionId) {
          try {
            const existing = await stripe.checkout.sessions.retrieve(pending.stripeCheckoutSessionId);
            if (existing.status === "open" && existing.url) {
              return {
                url: existing.url,
                tier: pending.priceTier === "founding" ? "founding" : "regular",
                trialEnd: pending.trialEnd ? pending.trialEnd.toISOString() : null,
              };
            }
          } catch {
            // Fall through: expired/unreadable sessions are replaced below.
          }
        }
        if (pending.stripeCheckoutSessionId) {
          await expireCheckoutSession(pending.stripeCheckoutSessionId).catch(() => {});
        } else {
          await db
            .update(stripeSubscriptions)
            .set({ status: "expired", updatedAt: new Date() })
            .where(eq(stripeSubscriptions.id, pending.id));
        }
      }

      const origin =
        input.returnUrl && SELF_ORIGINS.has(new URL(input.returnUrl).origin)
          ? new URL(input.returnUrl).origin
          : ENV.stripeSuccessUrl
            ? new URL(ENV.stripeSuccessUrl).origin
            : undefined;

      const promoCode = quote.tier === "founding" ? "C9F" : null;

      let customerId: string | undefined;
      const existingCustomers = await db
        .select({ id: stripeSubscriptions.stripeCustomerId })
        .from(stripeSubscriptions)
        .where(eq(stripeSubscriptions.familyId, familyId))
        .orderBy(desc(stripeSubscriptions.updatedAt))
        .limit(1);
      customerId = existingCustomers[0]?.id ?? undefined;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: ctx.user?.email ?? undefined,
          metadata: { familyId: String(familyId), userId: String(ctx.user?.id ?? "") },
        });
        customerId = customer.id;
      }

      const successUrl = origin
        ? `${origin}/settings?billing=success&session_id={CHECKOUT_SESSION_ID}`
        : resolveReturnUrl("success", "https://app.kindcipe.com/settings?billing=success");
      const cancelUrl = origin
        ? `${origin}/settings?billing=cancel`
        : resolveReturnUrl("cancel", "https://app.kindcipe.com/settings?billing=cancel");

      const expiresAt = Math.floor(Date.now() / 1000) + 35 * 60;
      const subscriptionData: Record<string, unknown> = {
        metadata: {
          familyId: String(familyId),
          userId: String(ctx.user?.id ?? ""),
          plan: input.plan,
          priceTier: quote.tier,
        },
      };
      if (quote.trialEnd) {
        subscriptionData.trial_end = Math.floor(quote.trialEnd.getTime() / 1000);
      }

      let session: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>;
      try {
        session = await stripe.checkout.sessions.create({
          mode: "subscription",
          customer: customerId,
          line_items: [{ price: priceIdForPlan(input.plan, quote.tier), quantity: 1 }],
          payment_method_collection: "always",
          success_url: successUrl,
          cancel_url: cancelUrl,
          client_reference_id: String(familyId),
          expires_at: expiresAt,
          metadata: {
            familyId: String(familyId),
            userId: String(ctx.user?.id ?? ""),
            plan: input.plan,
            priceTier: quote.tier,
          },
          subscription_data: subscriptionData as never,
        });
      } catch (e) {
        console.error("[billing] checkout session create failed:", (e as Error).message);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "未能建立付款頁面，請稍後再試。" });
      }
      if (!session.url) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "未能建立付款頁面，請稍後再試。" });
      }

      try {
        const checkoutExpiresAt = new Date(expiresAt * 1000);
        if (quote.tier === "founding" && promoCode) {
          await recordFoundingCheckout({
            familyId,
            userId: String(ctx.user.id),
            customerId,
            sessionId: session.id,
            checkoutExpiresAt,
            plan: input.plan,
            tier: "founding",
            promoCode,
            trialEnd: quote.trialEnd,
          });
        } else {
          await db.insert(stripeSubscriptions).values({
            familyId,
            userId: String(ctx.user.id),
            stripeCustomerId: customerId,
            stripeCheckoutSessionId: session.id,
            productId: `kindcipe_stripe_${quote.tier}_${input.plan}`,
            planType: input.plan,
            status: "pending",
            checkoutExpiresAt,
            priceTier: quote.tier,
            trialEnd: quote.trialEnd,
          });
        }
      } catch (e) {
        await stripe.checkout.sessions.expire(session.id).catch(() => {});
        const raceLost =
          isUniqueViolation(e) ||
          (e instanceof TRPCError && e.code === "CONFLICT");
        if (raceLost) {
          // A concurrent checkout won the one-pending-row race. Return that
          // open session instead of surfacing a database error.
          const winner = await getOpenPendingCheckout();
          if (winner) return winner;
        }
        if (e instanceof TRPCError) throw e;
        console.error("[billing] pending checkout record failed:", (e as Error).message);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "未能保留付款名額，請稍後再試。" });
      }

      return {
        url: session.url,
        tier: quote.tier,
        trialEnd: quote.trialEnd ? quote.trialEnd.toISOString() : null,
      };
    }),

  /** Stripe Billing Portal link (owner/admin only). */
  createPortalSession: protectedProcedure.mutation(async ({ ctx }) => {
    if (!isStripeConfigured()) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "網上付款暫時未開放。" });
    }
    if (!ctx.activeFamilyId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "請先加入家庭廚房" });
    }
    if (ctx.activeFamilyRole !== "owner" && ctx.activeFamilyRole !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "只有家庭管理員可以管理訂閱" });
    }
    const [current, promo] = await Promise.all([
      getFamilySubscription(ctx.activeFamilyId),
      getPromoState(ctx.activeFamilyId, String(ctx.user.id)),
    ]);
    if (current?.status === "trial" && promo?.billingProvider === "c9t") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "C9T 體驗沒有 Stripe 訂閱，請使用升級按鈕。",
      });
    }
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "資料庫暫時不可用" });
    const rows = await db
      .select({ id: stripeSubscriptions.stripeCustomerId })
      .from(stripeSubscriptions)
      .where(eq(stripeSubscriptions.familyId, ctx.activeFamilyId))
      .orderBy(desc(stripeSubscriptions.updatedAt))
      .limit(1);
    const customerId = rows[0]?.id ?? undefined;
    if (!customerId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "未有訂閱記錄。" });
    }
    const stripe = getStripe();
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: ENV.stripeSuccessUrl
        ? new URL(ENV.stripeSuccessUrl).origin + "/settings"
        : "https://app.kindcipe.com/settings",
    });
    return { url: portal.url };
  }),

  /** Confirm a checkout after redirect (fallback if the webhook is delayed). */
  confirmCheckout: protectedProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (!isStripeConfigured()) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "網上付款暫時未開放。" });
      }
      if (!ctx.activeFamilyId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "請先加入家庭廚房" });
      }
      const stripe = getStripe();
      const session = await stripe.checkout.sessions.retrieve(input.sessionId, {
        expand: ["subscription"],
      });
      const sessionFamilyId = Number(session.metadata?.familyId ?? session.client_reference_id);
      if (!sessionFamilyId || sessionFamilyId !== ctx.activeFamilyId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "此付款記錄不屬於目前廚房" });
      }

      const synced = await syncCheckoutSession(session, {
        eventAt: session.created ? new Date(session.created * 1000) : undefined,
      });
      const sub = await getFamilySubscription(ctx.activeFamilyId);
      const plan = session.metadata?.plan === "yearly" ? "yearly" : "monthly";
      return {
        status: synced.status,
        plan,
        trialEndsAt: sub?.trialEndsAt ? sub.trialEndsAt.toISOString() : null,
        expiresAt: sub?.subscriptionExpiresAt ? sub.subscriptionExpiresAt.toISOString() : null,
      };
    }),

  /** Current subscription + promo state for the active family. */
  current: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.activeFamilyId) return null;
    const [sub, promo] = await Promise.all([
      getFamilySubscription(ctx.activeFamilyId),
      getPromoState(ctx.activeFamilyId, String(ctx.user.id)),
    ]);
    return sub ? { ...sub, promo } : null;
  }),
});

/** Exported for the webhook route + tests. */
export const _internal = { resolveReturnUrl, SELF_ORIGINS };
