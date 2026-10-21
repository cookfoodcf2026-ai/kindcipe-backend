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

/**
 * Resolve a user-entered promotion code to a Stripe promotion_code id
 * (promo_...). Returns null when unknown / inactive / expired.
 */
export async function resolvePromotionCodeId(code: string): Promise<string | null> {
  const trimmed = String(code ?? "").trim();
  if (!trimmed) return null;
  try {
    const stripe = getStripe();
    const list = await stripe.promotionCodes.list({ code: trimmed, active: true, limit: 1 });
    const pc: any = list.data[0];
    if (!pc) return null;
    if (pc.expires_at && pc.expires_at * 1000 < Date.now()) return null;
    return pc.id as string;
  } catch {
    return null;
  }
}

/**
 * Get a promotion code's coupon + discount info (for the in-app order summary).
 * Amounts are in the smallest currency unit (cents).
 */
export async function getPromotionInfo(code: string): Promise<
  | { promotionCodeId: string; percentOff?: number; amountOff?: number; currency?: string; couponId?: string }
  | null
> {
  const trimmed = String(code ?? "").trim();
  if (!trimmed) return null;
  try {
    const stripe = getStripe();
    const list = await stripe.promotionCodes.list({
      code: trimmed,
      active: true,
      limit: 1,
      expand: ["data.coupon"],
    });
    const pc: any = list.data[0];
    if (!pc) return null;
    if (pc.expires_at && pc.expires_at * 1000 < Date.now()) return null;
    const coupon: any = pc.coupon;
    return {
      promotionCodeId: pc.id as string,
      percentOff: coupon?.percent_off ?? undefined,
      amountOff: coupon?.amount_off ?? undefined,
      currency: coupon?.currency ? String(coupon.currency).toUpperCase() : undefined,
      couponId: coupon?.id,
    };
  } catch {
    return null;
  }
}

/** Fetch a plan's configured price amount + currency (smallest unit). */
export async function getPlanPrice(plan: "monthly" | "yearly"): Promise<{ amount: number; currency: string } | null> {
  try {
    const stripe = getStripe();
    const price = await stripe.prices.retrieve(priceIdForPlan(plan));
    return { amount: price.unit_amount ?? 0, currency: String(price.currency ?? "hkd").toUpperCase() };
  } catch {
    return null;
  }
}

export const PRODUCT_ID_FOR_PLAN: Record<"monthly" | "yearly", string> = {
  monthly: "kindcipe_monthly_30",
  yearly: "kindcipe_yearly_288",
};
