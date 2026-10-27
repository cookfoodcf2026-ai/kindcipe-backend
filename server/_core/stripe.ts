/**
 * Stripe billing service — web subscription payments only.
 *
 * iOS uses Apple IAP (App Store guideline 3.1.1); Android uses Google Play
 * Billing (Play payments policy). All channels activate the same family
 * subscription so Pro state is unified across App and Web.
 *
 * Config (Railway env):
 *   STRIPE_SECRET_KEY      sk_live_... / sk_test_...
 *   STRIPE_WEBHOOK_SECRET  whsec_...
 *   STRIPE_PRICE_MONTHLY        price_... (regular HK$38/mo)
 *   STRIPE_PRICE_YEARLY         price_... (regular HK$365/yr)
 *   STRIPE_PRICE_MONTHLY_PROMO  price_... (founding HK$30/mo)
 *   STRIPE_PRICE_YEARLY_PROMO   price_... (founding HK$288/yr)
 *   STRIPE_SUCCESS_URL     https://app.kindcipe.com/settings?billing=success
 *   STRIPE_CANCEL_URL      https://app.kindcipe.com/settings?billing=cancel
 */
import Stripe from "stripe";
import { ENV } from "./env";

let _stripe: Stripe | null = null;

export function isStripeConfigured(): boolean {
  const webhookReady = !ENV.isProduction || Boolean(ENV.stripeWebhookSecret);
  return Boolean(
    ENV.stripeSecretKey &&
      ENV.stripePriceMonthly &&
      ENV.stripePriceYearly &&
      webhookReady
  );
}

export function isPromoPricingConfigured(): boolean {
  return Boolean(ENV.stripePriceMonthlyPromo && ENV.stripePriceYearlyPromo);
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

export type StripePriceTier = "regular" | "founding";

export function priceIdForPlan(
  plan: "monthly" | "yearly",
  tier: StripePriceTier = "regular"
): string {
  const id =
    tier === "founding"
      ? plan === "yearly"
        ? ENV.stripePriceYearlyPromo
        : ENV.stripePriceMonthlyPromo
      : plan === "yearly"
        ? ENV.stripePriceYearly
        : ENV.stripePriceMonthly;
  if (!id) throw new Error(`Stripe ${tier} price for ${plan} is not configured`);
  return id;
}

export function planForPriceId(priceId: string): "monthly" | "yearly" | null {
  if (priceId === ENV.stripePriceMonthly || priceId === ENV.stripePriceMonthlyPromo) return "monthly";
  if (priceId === ENV.stripePriceYearly || priceId === ENV.stripePriceYearlyPromo) return "yearly";
  return null;
}

export function tierForPriceId(priceId: string): StripePriceTier {
  return priceId === ENV.stripePriceMonthlyPromo || priceId === ENV.stripePriceYearlyPromo
    ? "founding"
    : "regular";
}

/** Fetch a plan's configured price amount + currency (smallest unit). */
export async function getPlanPrice(
  plan: "monthly" | "yearly",
  tier: StripePriceTier = "regular"
): Promise<{ amount: number; currency: string } | null> {
  try {
    const stripe = getStripe();
    const price = await stripe.prices.retrieve(priceIdForPlan(plan, tier));
    return { amount: price.unit_amount ?? 0, currency: String(price.currency ?? "hkd").toUpperCase() };
  } catch {
    return null;
  }
}

export const PRODUCT_ID_FOR_PLAN: Record<"monthly" | "yearly", string> = {
  monthly: "kindcipe_monthly_30",
  yearly: "kindcipe_yearly_288",
};

export function stripeProductId(plan: "monthly" | "yearly", tier: StripePriceTier): string {
  return `kindcipe_stripe_${tier}_${plan}`;
}
