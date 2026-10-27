/**
 * subscription router — IAP receipt verification + subscription status.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { isSignedTransaction, verifySignedTransaction } from "../_core/appleIap";
import {
  activateFamilySubscription,
  getFamilySubscription,
  getIapTransactionByTransactionId,
  insertIapTransaction,
} from "../db";
import { getPromoState, redeemFoundingCode, redeemTrialCode } from "../services/promo";

const VALID_PRODUCTS: Record<string, { plan: "monthly" | "yearly"; days: number }> = {
  kindcipe_monthly_30: { plan: "monthly", days: 30 },
  kindcipe_yearly_288: { plan: "yearly", days: 365 },
};

export const subscriptionRouter = router({
  /** Get current kitchen's subscription (mirrors family.subscription) */
  get: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.activeFamilyId) return null;
    const [sub, promo] = await Promise.all([
      getFamilySubscription(ctx.activeFamilyId),
      getPromoState(ctx.activeFamilyId, String(ctx.user.id)),
    ]);
    return sub ? { ...sub, promo } : null;
  }),

  /**
   * Verify an IAP receipt and activate the family subscription.
   * Idempotent by transactionId — a retried receipt will not double-extend.
   */
  verifyIap: protectedProcedure
    .input(z.object({
      receipt: z.string().min(1),
      productId: z.string().min(1),
      transactionDate: z.string().optional(),
      purchaseToken: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "請先加入家庭廚房" });
      }
      const product = VALID_PRODUCTS[input.productId];
      if (!product) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "未知產品 ID" });
      }

      // ── Real verification (Phase 0) ────────────────────────────────────────
      // iOS clients send the App Store signed transaction (JWS). Verify the
      // signature + cert chain, then derive the real transactionId/productId.
      let verifiedTxnId: string | null = null;
      let verifiedExpiresAt: number | null = null;
      if (isSignedTransaction(input.receipt)) {
        let payload;
        try {
          payload = verifySignedTransaction(input.receipt);
        } catch (e) {
          console.error("[verifyIap] signed transaction rejected:", (e as Error).message);
          throw new TRPCError({ code: "BAD_REQUEST", message: "購買憑證驗證失敗" });
        }
        if (payload.productId !== input.productId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "產品 ID 不符" });
        }
        const expectedBundle = process.env.APPLE_BUNDLE_ID;
        if (expectedBundle && payload.bundleId !== expectedBundle) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Bundle ID 不符" });
        }
        verifiedTxnId = payload.originalTransactionId;
        verifiedExpiresAt = payload.expiresDate ?? null;
      } else if (process.env.NODE_ENV === "production") {
        // In production we refuse unverifiable receipts.
        throw new TRPCError({ code: "BAD_REQUEST", message: "需要有效的 App Store 交易憑證" });
      }

      const txnDate = input.transactionDate ? new Date(input.transactionDate) : new Date();
      const transactionId = verifiedTxnId
        ? `apple_${verifiedTxnId}`
        : `${ctx.user.id}_${input.productId}_${Math.floor(txnDate.getTime() / 1000)}`;

      // Idempotency: already processed → return current status without re-extending
      const existing = await getIapTransactionByTransactionId(transactionId);
      if (existing) {
        const sub = await getFamilySubscription(ctx.activeFamilyId);
        return { status: "active", plan: existing.planType, expiresAt: sub?.subscriptionExpiresAt ? sub.subscriptionExpiresAt.toISOString() : null, duplicate: true };
      }

      const now = new Date();
      const expiresAt = verifiedExpiresAt
        ? new Date(verifiedExpiresAt)
        : new Date(now.getTime() + product.days * 24 * 60 * 60 * 1000);
      await activateFamilySubscription(ctx.activeFamilyId, product.plan, expiresAt);
      await insertIapTransaction({
        familyId: ctx.activeFamilyId,
        userId: String(ctx.user.id),
        productId: input.productId,
        planType: product.plan,
        receipt: input.receipt,
        purchaseToken: input.purchaseToken ?? null,
        transactionId,
        transactionDate: txnDate,
      });

      return { status: "active", plan: product.plan, expiresAt: expiresAt.toISOString(), duplicate: false };
    }),

  /**
   * Redeem an IG-follow 7-day trial promo code. Any current family member may
   * redeem; all current members are marked trial-used atomically.
   */
  redeemTrialCode: protectedProcedure
    .input(z.object({ code: z.string().min(1).max(24) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "請先加入家庭廚房" });
      }
      const code = input.code.trim();
      if (code.toUpperCase().startsWith("C9F-")) {
        return redeemFoundingCode({
          familyId: ctx.activeFamilyId,
          userId: String(ctx.user.id),
          code,
        });
      }
      return redeemTrialCode({
        familyId: ctx.activeFamilyId,
        userId: String(ctx.user.id),
        code,
      });
    }),

});