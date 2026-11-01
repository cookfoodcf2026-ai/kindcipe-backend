/**
 * Stripe webhook — the authoritative async path for web billing.
 *
 * Mounted BEFORE express.json() so the raw body is available for signature
 * verification. Endpoint: POST /api/stripe/webhook
 */
import type { Express, Request, Response } from "express";
import express from "express";
import { TRPCError } from "@trpc/server";
import type Stripe from "stripe";
import { getStripe } from "./stripe";
import { ENV } from "./env";
import {
  expireCheckoutSession,
  syncCheckoutSession,
  syncInvoicePaid,
  syncSubscription,
} from "../services/stripeBilling";

/**
 * Business errors that will never succeed on retry (bad/missing metadata,
 * unknown family, unmet precondition). Stripe retries 5xx for up to 3 days,
 * so acknowledge these with 200 and log instead of returning 500.
 */
const NON_RETRYABLE_TRPC_CODES = new Set([
  "BAD_REQUEST",
  "NOT_FOUND",
  "PRECONDITION_FAILED",
]);

function isNonRetryable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const candidate = err as { name?: unknown; code?: unknown };
  const isTrpc = err instanceof TRPCError || candidate.name === "TRPCError";
  if (!isTrpc) return false;
  return typeof candidate.code === "string" && NON_RETRYABLE_TRPC_CODES.has(candidate.code);
}

export interface StripeWebhookDeps {
  webhookSecret: string;
  constructEvent(body: Buffer, signature: string, secret: string): Stripe.Event;
  syncCheckoutSession: typeof syncCheckoutSession;
  syncSubscription: typeof syncSubscription;
  syncInvoicePaid: typeof syncInvoicePaid;
  expireCheckoutSession: typeof expireCheckoutSession;
}

export function createStripeWebhookHandler(deps: StripeWebhookDeps) {
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
          await deps.syncSubscription(sub, { eventAt });
          break;
        }
        case "invoice.paid":
        case "invoice.payment_failed": {
          const invoice = event.data.object as Stripe.Invoice;
          await deps.syncInvoicePaid(invoice, eventAt);
          break;
        }
        default:
          break;
      }
      console.log(`[stripe] webhook ok event=${event.type}`);
      res.json({ received: true });
    } catch (err) {
      const message = (err as Error).message;
      if (isNonRetryable(err)) {
        console.warn(
          `[stripe] skipped event=${event.type} id=${event.id} reason=${message}`
        );
        res.json({ received: true, skipped: true });
        return;
      }
      console.error(
        `[stripe] webhook handling failed event=${event.type} id=${event.id}:`,
        message
      );
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
      syncCheckoutSession,
      syncSubscription,
      syncInvoicePaid,
      expireCheckoutSession,
    })
  );
}
