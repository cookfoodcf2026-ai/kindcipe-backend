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
  grantFamilyTrial,
  hasPromoRedeemed,
  getPromoCode,
  insertIapTransaction,
  recordPromoRedemption,
  incrementTrialCount,
} from "../db";

const VALID_PRODUCTS: Record<string, { plan: "monthly" | "yearly"; days: number }> = {
  kindcipe_monthly_30: { plan: "monthly", days: 30 },
  kindcipe_yearly_288: { plan: "yearly", days: 365 },
};

export const subscriptionRouter = router({
  /** Get current kitchen's subscription (mirrors family.subscription) */
  get: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.activeFamilyId) return null;
    return getFamilySubscription(ctx.activeFamilyId);
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
   * Redeem an IG-follow 7-day trial promo code. One code per family.
   * Trial is counted from the moment of redemption.
   */
  redeemTrialCode: protectedProcedure
    .input(z.object({ code: z.string().min(1).max(24) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "請先加入家庭廚房" });
      }
      const code = input.code.trim().toUpperCase();
      if (!code) throw new TRPCError({ code: "BAD_REQUEST", message: "請輸入試用碼" });

      const promo = await getPromoCode(code);
      if (!promo || !promo.active) throw new TRPCError({ code: "BAD_REQUEST", message: "試用碼無效" });
      if (promo.expiresAt && promo.expiresAt.getTime() < Date.now()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "試用碼已過期" });
      }
      if (promo.usedCount >= promo.maxUses) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "試用碼已用盡" });
      }
      if (await hasPromoRedeemed(ctx.activeFamilyId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "此廚房已兌換過試用碼" });
      }

      await grantFamilyTrial(ctx.activeFamilyId);
      await recordPromoRedemption(code, ctx.activeFamilyId, String(ctx.user.id));
      await incrementTrialCount(String(ctx.user.id));

      const sub = await getFamilySubscription(ctx.activeFamilyId);
      return {
        status: "trial",
        expiresAt: sub?.trialEndsAt ? sub.trialEndsAt.toISOString() : null,
        maxMembers: sub?.maxMembers ?? 4,
      };
    }),
});