/**
 * Stripe webhook — the authoritative async path for web billing.
 *
 * Mounted BEFORE express.json() so the raw body is available for signature
 * verification. Endpoint: POST /api/stripe/webhook
 */
import type { Express, Request, Response } from "express";
import express from "express";
import { getStripe } from "./stripe";
import { ENV } from "./env";
import {
  expireCheckoutSession,
  syncCheckoutSession,
  syncInvoicePaid,
  syncSubscription,
} from "../services/stripeBilling";

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

      const eventAt = new Date(event.created * 1000);
      try {
        switch (event.type) {
          case "checkout.session.completed":
          case "checkout.session.async_payment_succeeded": {
            const session = event.data.object as import("stripe").Stripe.Checkout.Session;
            await syncCheckoutSession(session, { eventAt });
            break;
          }
          case "checkout.session.expired":
          case "checkout.session.async_payment_failed": {
            const session = event.data.object as import("stripe").Stripe.Checkout.Session;
            await expireCheckoutSession(session.id);
            break;
          }
          case "customer.subscription.updated":
          case "customer.subscription.deleted": {
            const sub = event.data.object as import("stripe").Stripe.Subscription;
            await syncSubscription(sub, { eventAt });
            break;
          }
          case "invoice.paid":
          case "invoice.payment_failed": {
            const invoice = event.data.object as import("stripe").Stripe.Invoice;
            await syncInvoicePaid(invoice, eventAt);
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
