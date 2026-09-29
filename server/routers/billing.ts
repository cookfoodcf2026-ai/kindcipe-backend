/**
 * Billing router — Stripe checkout / portal / status for web + Android.
 *
 * iOS uses Apple IAP (see subscription.verifyIap); this router is the web path.
 * Both call activateFamilySubscription() so Pro state is unified.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { stripeSubscriptions, families } from "../../drizzle/schema";
import { activateFamilySubscription, getFamilySubscription } from "../db";
import {
  getStripe,
  isStripeConfigured,
  priceIdForPlan,
  PRODUCT_ID_FOR_PLAN,
} from "../_core/stripe";
import { ENV } from "../_core/env";

const SELF_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean)
);

function resolveReturnUrl(kind: "success" | "cancel", fallback: string): string {
  const explicit = kind === "success" ? ENV.stripeSuccessUrl : ENV.stripeCancelUrl;
  if (explicit) return explicit;
  return fallback;
}

export const billingRouter = router({
  /** Whether Stripe is configured (frontend can hide/disable web checkout). */
  status: protectedProcedure.query(async () => {
    return { configured: isStripeConfigured() };
  }),

  /**
   * Create a Stripe Checkout Session for the current family, then the web
   * client redirects the browser to `url`.
   */
  createCheckoutSession: protectedProcedure
    .input(
      z.object({
        plan: z.enum(["monthly", "yearly"]),
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

      const origin =
        input.returnUrl && SELF_ORIGINS.has(new URL(input.returnUrl).origin)
          ? new URL(input.returnUrl).origin
          : ENV.stripeSuccessUrl
            ? new URL(ENV.stripeSuccessUrl).origin
            : undefined;

      const stripe = getStripe();
      const db = await getDb();

      // Reuse an existing Stripe customer for this family, if any.
      let customerId: string | undefined;
      if (db) {
        const existing = await db
          .select({ id: stripeSubscriptions.stripeCustomerId })
          .from(stripeSubscriptions)
          .where(eq(stripeSubscriptions.familyId, ctx.activeFamilyId))
          .orderBy(desc(stripeSubscriptions.updatedAt))
          .limit(1);
        customerId = existing[0]?.id ?? undefined;
      }
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: ctx.user?.email ?? undefined,
          metadata: { familyId: String(ctx.activeFamilyId), userId: String(ctx.user?.id ?? "") },
        });
        customerId = customer.id;
      }

      const successUrl = origin
        ? `${origin}/settings?billing=success&session_id={CHECKOUT_SESSION_ID}`
        : resolveReturnUrl("success", "https://app.kindcipe.com/settings?billing=success");
      const cancelUrl = origin
        ? `${origin}/settings?billing=cancel`
        : resolveReturnUrl("cancel", "https://app.kindcipe.com/settings?billing=cancel");

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: priceIdForPlan(input.plan), quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: String(ctx.activeFamilyId),
        metadata: {
          familyId: String(ctx.activeFamilyId),
          userId: String(ctx.user?.id ?? ""),
          plan: input.plan,
        },
        subscription_data: {
          metadata: { familyId: String(ctx.activeFamilyId), plan: input.plan },
        },
      });

      // Record the pending checkout so we can correlate the webhook.
      if (db) {
        await db.insert(stripeSubscriptions).values({
          familyId: ctx.activeFamilyId,
          userId: String(ctx.user?.id ?? ""),
          stripeCustomerId: customerId,
          stripeCheckoutSessionId: session.id,
          productId: PRODUCT_ID_FOR_PLAN[input.plan],
          planType: input.plan,
          status: "pending",
        });
      }

      return { url: session.url };
    }),

  /** Stripe Billing Portal link (manage/cancel). */
  createPortalSession: protectedProcedure.mutation(async ({ ctx }) => {
    if (!isStripeConfigured()) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "網上付款暫時未開放。" });
    }
    if (!ctx.activeFamilyId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "請先加入家庭廚房" });
    }
    const db = await getDb();
    let customerId: string | undefined;
    if (db) {
      const rows = await db
        .select({ id: stripeSubscriptions.stripeCustomerId })
        .from(stripeSubscriptions)
        .where(eq(stripeSubscriptions.familyId, ctx.activeFamilyId))
        .orderBy(desc(stripeSubscriptions.updatedAt))
        .limit(1);
      customerId = rows[0]?.id ?? undefined;
    }
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
      if (session.payment_status !== "paid" && session.status !== "complete") {
        return { status: "pending" as const };
      }
      const sub = session.subscription as import("stripe").Stripe.Subscription | null;
      const periodEnd =
        sub && typeof sub !== "string" && (sub as any).current_period_end
          ? new Date((sub as any).current_period_end * 1000)
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const plan = (session.metadata?.plan === "yearly" ? "yearly" : "monthly") as
        | "monthly"
        | "yearly";
      await activateFamilySubscription(ctx.activeFamilyId, plan, periodEnd);
      return { status: "active" as const, plan, expiresAt: periodEnd.toISOString() };
    }),

  /** Current subscription for the active family. */
  current: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.activeFamilyId) return null;
    const sub = await getFamilySubscription(ctx.activeFamilyId);
    return sub ?? null;
  }),
});

/** Exported for the webhook route + tests. */
export const _internal = { resolveReturnUrl, SELF_ORIGINS };
