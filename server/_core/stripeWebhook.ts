/**
 * Stripe webhook — activates family subscriptions on successful payment.
 *
 * Mounted BEFORE express.json() so the raw body is available for signature
 * verification. Endpoint: POST /api/stripe/webhook
 */
import type { Express, Request, Response } from "express";
import express from "express";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { stripeSubscriptions } from "../../drizzle/schema";
import { activateFamilySubscription } from "../db";
import { getStripe, planForPriceId, PRODUCT_ID_FOR_PLAN } from "../_core/stripe";
import { ENV } from "../_core/env";

async function upsertSubscription(params: {
  familyId: number;
  userId?: string;
  customerId?: string | null;
  subscriptionId?: string | null;
  checkoutSessionId?: string | null;
  productId: string;
  plan: "monthly" | "yearly";
  status: string;
  currentPeriodEnd?: Date | null;
}) {
  const db = await getDb();
  if (!db) return;
  // Match by subscription id first, then fall back to family.
  const existing = params.subscriptionId
    ? await db
        .select({ id: stripeSubscriptions.id })
        .from(stripeSubscriptions)
        .where(eq(stripeSubscriptions.stripeSubscriptionId, params.subscriptionId))
        .limit(1)
    : [];

  if (existing[0]) {
    await db
      .update(stripeSubscriptions)
      .set({
        status: params.status,
        planType: params.plan,
        productId: params.productId,
        currentPeriodEnd: params.currentPeriodEnd ?? null,
        updatedAt: new Date(),
      })
      .where(eq(stripeSubscriptions.id, existing[0].id));
    return;
  }

  await db.insert(stripeSubscriptions).values({
    familyId: params.familyId,
    userId: params.userId ?? "",
    stripeCustomerId: params.customerId ?? null,
    stripeSubscriptionId: params.subscriptionId ?? null,
    stripeCheckoutSessionId: params.checkoutSessionId ?? null,
    productId: params.productId,
    planType: params.plan,
    status: params.status,
    currentPeriodEnd: params.currentPeriodEnd ?? null,
  });
}

export function registerStripeWebhook(app: Express) {
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      if (!ENV.stripeWebhookSecret) {
        res.status(503).send("Stripe webhook not configured");
        return;
      }
      const sig = req.headers["stripe-signature"];
      let event: import("stripe").Stripe.Event;
      try {
        event = getStripe().webhooks.constructEvent(
          req.body as Buffer,
          String(sig),
          ENV.stripeWebhookSecret
        );
      } catch (err) {
        console.error("[stripe] webhook signature failed:", (err as Error).message);
        res.status(400).send(`Webhook Error: ${(err as Error).message}`);
        return;
      }

      try {
        switch (event.type) {
          case "checkout.session.completed": {
            const session = event.data.object as import("stripe").Stripe.Checkout.Session;
            const familyId = Number(session.metadata?.familyId ?? session.client_reference_id);
            if (!familyId) break;
            const plan = (session.metadata?.plan === "yearly" ? "yearly" : "monthly") as
              | "monthly"
              | "yearly";
            const sub = session.subscription
              ? await getStripe().subscriptions.retrieve(String(session.subscription))
              : null;
            const periodEndTs = sub?.items?.data?.[0]?.current_period_end;
            const periodEnd = periodEndTs
              ? new Date(periodEndTs * 1000)
              : new Date(Date.now() + (plan === "yearly" ? 365 : 30) * 24 * 60 * 60 * 1000);
            await activateFamilySubscription(familyId, plan, periodEnd);
            await upsertSubscription({
              familyId,
              userId: session.metadata?.userId,
              customerId: typeof session.customer === "string" ? session.customer : null,
              subscriptionId: sub?.id ?? null,
              checkoutSessionId: session.id,
              productId: PRODUCT_ID_FOR_PLAN[plan],
              plan,
              status: "active",
              currentPeriodEnd: periodEnd,
            });
            break;
          }
          case "customer.subscription.updated":
          case "customer.subscription.deleted": {
            const sub = event.data.object as import("stripe").Stripe.Subscription;
            const familyId = Number(sub.metadata?.familyId);
            const priceId = sub.items.data[0]?.price?.id ?? "";
            const plan = planForPriceId(priceId) ?? (sub.metadata?.plan === "yearly" ? "yearly" : "monthly");
            const active = sub.status === "active" || sub.status === "trialing";
            const itemPeriodEndTs = sub.items?.data?.[0]?.current_period_end;
            const itemPeriodEnd = itemPeriodEndTs ? new Date(itemPeriodEndTs * 1000) : null;
            if (familyId && active) {
              const periodEnd = itemPeriodEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
              await activateFamilySubscription(familyId, plan, periodEnd);
            }
            if (familyId) {
              await upsertSubscription({
                familyId,
                subscriptionId: sub.id,
                productId: PRODUCT_ID_FOR_PLAN[plan],
                plan,
                status: sub.status,
                currentPeriodEnd: itemPeriodEnd,
              });
            }
            break;
          }
          default:
            break;
        }
        res.json({ received: true });
      } catch (err) {
        console.error("[stripe] webhook handling failed:", (err as Error).message);
        res.status(500).json({ error: "webhook handler failed" });
      }
    }
  );
}
