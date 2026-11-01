/**
 * Stripe webhook — the authoritative async path for web billing.
 *
 * Mounted BEFORE express.json() so the raw body is available for signature
 * verification. Endpoint: POST /api/stripe/webhook
 */
import type { Express, Request, Response } from "express";
import express from "express";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { getStripe } from "./stripe";
import { ENV } from "./env";
import { getDb, getFamilyById } from "../db";
import { stripeSubscriptions } from "../../drizzle/schema";
import {
  expireCheckoutSession,
  syncCheckoutSession,
  syncInvoicePaid,
  syncSubscription,
} from "../services/stripeBilling";

class RetryableWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableWebhookError";
  }
}

function isTrpcError(err: unknown): err is { code?: unknown; message?: unknown } {
  if (!err || typeof err !== "object") return false;
  const candidate = err as { name?: unknown; code?: unknown };
  return err instanceof TRPCError || candidate.name === "TRPCError";
}

function isPreconditionError(err: unknown): boolean {
  if (!isTrpcError(err)) return false;
  return err.code === "PRECONDITION_FAILED";
}

function parseFamilyId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const legacy = invoice as unknown as {
    subscription?: string | { id: string } | null;
  };
  const modern = invoice as unknown as {
    parent?: { subscription_details?: { subscription?: string | { id: string } | null } };
  };
  const raw =
    legacy.subscription ?? modern.parent?.subscription_details?.subscription ?? null;
  return typeof raw === "string" ? raw : raw?.id ?? null;
}

export interface StripeWebhookDeps {
  webhookSecret: string;
  constructEvent(body: Buffer, signature: string, secret: string): Stripe.Event;
  getFamilyById(familyId: number): Promise<{ id?: number } | null | undefined>;
  findFamilyIdBySubscriptionId(subscriptionId: string): Promise<number | null>;
  syncCheckoutSession: typeof syncCheckoutSession;
  syncSubscription: typeof syncSubscription;
  syncInvoicePaid: typeof syncInvoicePaid;
  expireCheckoutSession: typeof expireCheckoutSession;
}

export function createStripeWebhookHandler(deps: StripeWebhookDeps) {
  const skip = (
    res: Response,
    event: Stripe.Event,
    reason: "no_family_ref" | "precondition",
  ) => {
    console.warn(`[stripe] skipped event=${event.type} id=${event.id} reason=${reason}`);
    res.json({ received: true, skipped: true });
  };

  const requireFamily = async (familyId: number) => {
    const family = await deps.getFamilyById(familyId);
    if (!family) {
      throw new RetryableWebhookError(`family ${familyId} not found`);
    }
  };

  const resolveSubscriptionFamilyId = async (
    sub: Stripe.Subscription,
  ): Promise<number | null> => {
    const fromMetadata = parseFamilyId(sub.metadata?.familyId);
    if (fromMetadata) return fromMetadata;
    return deps.findFamilyIdBySubscriptionId(sub.id);
  };

  return async (req: Request, res: Response) => {
    if (!deps.webhookSecret) {
      res.status(503).send("Stripe webhook not configured");
      return;
    }
    const sig = req.headers["stripe-signature"];
    let event: Stripe.Event;
    try {
      event = deps.constructEvent(req.body as Buffer, String(sig), deps.webhookSecret);
    } catch (err) {
      console.error("[stripe] webhook signature failed:", (err as Error).message);
      res.status(400).send(`Webhook Error: ${(err as Error).message}`);
      return;
    }

    const eventAt = new Date(event.created * 1000);
    try {
      switch (event.type) {
        case "checkout.session.completed":
        case "checkout.session.async_payment_succeeded": {
          const session = event.data.object as Stripe.Checkout.Session;
          const familyId = parseFamilyId(
            session.metadata?.familyId ?? session.client_reference_id,
          );
          if (!familyId) {
            skip(res, event, "no_family_ref");
            return;
          }
          await requireFamily(familyId);
          await deps.syncCheckoutSession(session, { eventAt });
          break;
        }
        case "checkout.session.expired":
        case "checkout.session.async_payment_failed": {
          const session = event.data.object as Stripe.Checkout.Session;
          await deps.expireCheckoutSession(session.id);
          break;
        }
        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
          const sub = event.data.object as Stripe.Subscription;
          const familyId = await resolveSubscriptionFamilyId(sub);
          if (!familyId) {
            skip(res, event, "no_family_ref");
            return;
          }
          await requireFamily(familyId);
          await deps.syncSubscription(sub, { eventAt });
          break;
        }
        case "invoice.paid":
        case "invoice.payment_failed": {
          const invoice = event.data.object as Stripe.Invoice;
          const subscriptionId = invoiceSubscriptionId(invoice);
          const familyId = subscriptionId
            ? await deps.findFamilyIdBySubscriptionId(subscriptionId)
            : null;
          if (!familyId) {
            skip(res, event, "no_family_ref");
            return;
          }
          await requireFamily(familyId);
          await deps.syncInvoicePaid(invoice, eventAt);
          break;
        }
        default:
          break;
      }
      console.log(`[stripe] webhook ok event=${event.type}`);
      res.json({ received: true });
    } catch (err) {
      if (isPreconditionError(err)) {
        skip(res, event, "precondition");
        return;
      }
      const message = (err as Error).message;
      console.error(`[stripe] retryable event=${event.type} reason=${message}`);
      res.status(500).json({ error: "webhook handler failed" });
    }
  };
}

export function registerStripeWebhook(app: Express) {
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    createStripeWebhookHandler({
      get webhookSecret() {
        return ENV.stripeWebhookSecret;
      },
      constructEvent: (body, signature, secret) =>
        getStripe().webhooks.constructEvent(body, signature, secret),
      getFamilyById,
      findFamilyIdBySubscriptionId: async (subscriptionId) => {
        const db = await getDb();
        if (!db) throw new RetryableWebhookError("database unavailable");
        const [row] = await db
          .select({ familyId: stripeSubscriptions.familyId })
          .from(stripeSubscriptions)
          .where(eq(stripeSubscriptions.stripeSubscriptionId, subscriptionId))
          .limit(1);
        return row?.familyId ?? null;
      },
      syncCheckoutSession,
      syncSubscription,
      syncInvoicePaid,
      expireCheckoutSession,
    })
  );
}
