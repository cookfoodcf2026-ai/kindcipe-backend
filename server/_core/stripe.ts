/**
 * Stripe billing service — web/Android subscription payments.
 *
 * iOS keeps Apple IAP (App Store guideline 3.1.1). Both channels activate the
 * same family subscription so Pro state is unified across App and Web.
 *
 * Config (Railway env):
 *   STRIPE_SECRET_KEY      sk_live_... / sk_test_...
 *   STRIPE_WEBHOOK_SECRET  whsec_...
 *   STRIPE_PRICE_MONTHLY   price_... (HK$30/mo)
 *   STRIPE_PRICE_YEARLY    price_... (HK$288/yr)
 *   STRIPE_SUCCESS_URL     https://app.kindcipe.com/settings?billing=success
 *   STRIPE_CANCEL_URL      https://app.kindcipe.com/settings?billing=cancel
 */
import Stripe from "stripe";
import { ENV } from "./env";

let _stripe: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return Boolean(
    ENV.stripeSecretKey && ENV.stripePriceMonthly && ENV.stripePriceYearly
  );
}

export function getStripe(): Stripe {
  if (!ENV.stripeSecretKey) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  if (!_stripe) {
    // Pin a stable API version; omit to use the SDK default if unset.
    _stripe = new Stripe(ENV.stripeSecretKey, { apiVersion: "2025-08-27.basil" as Stripe.LatestApiVersion });
  }
  return _stripe;
}

export function priceIdForPlan(plan: "monthly" | "yearly"): string {
  const id = plan === "yearly" ? ENV.stripePriceYearly : ENV.stripePriceMonthly;
  if (!id) throw new Error(`Stripe price for ${plan} is not configured`);
  return id;
}

export function planForPriceId(priceId: string): "monthly" | "yearly" | null {
  if (priceId === ENV.stripePriceMonthly) return "monthly";
  if (priceId === ENV.stripePriceYearly) return "yearly";
  return null;
}

export const PRODUCT_ID_FOR_PLAN: Record<"monthly" | "yearly", string> = {
  monthly: "kindcipe_monthly_30",
  yearly: "kindcipe_yearly_288",
};
