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
  getIapTransactionByAppAccountToken,
  getIapTransactionByOriginalAndProduct,
  getIapTransactionByTransactionId,
  hasActiveStripeSubscription,
  insertIapTransaction,
  updateIapTransaction,
} from "../db";
import { getPromoState, redeemFoundingCode, redeemTrialCode } from "../services/promo";
import {
  IapError,
  type IapStore,
  resolveIapProduct,
  verifyIapPurchase,
} from "../services/iapSubscription";

// Single source of truth lives in iapSubscription.ts; re-exported here so the
// router module still exposes the product table it owns.
export { LEGACY_PRODUCT_ALIASES, VALID_PRODUCTS } from "../services/iapSubscription";

const iapStore: IapStore = {
  hasActiveStripeSubscription,
  getByTransactionId: getIapTransactionByTransactionId,
  getByOriginalAndProduct: getIapTransactionByOriginalAndProduct,
  getByAppAccountToken: getIapTransactionByAppAccountToken,
  insert: insertIapTransaction,
  update: updateIapTransaction,
  activateFamily: activateFamilySubscription,
};

function trpcErrorFor(err: IapError): TRPCError {
  switch (err.code) {
    case "ALREADY_SUBSCRIBED":
      return new TRPCError({ code: "CONFLICT", message: err.message });
    default:
      return new TRPCError({ code: "BAD_REQUEST", message: err.message });
  }
}

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
      appAccountToken: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "請先加入家庭廚房" });
      }
      const product = resolveIapProduct(input.productId);
      if (!product) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "未知產品 ID" });
      }

      // ── Real verification (Phase 0) ────────────────────────────────────────
      // iOS clients send the App Store signed transaction (JWS). Verify the
      // signature + cert chain, then derive the real transaction fields.
      let verifiedTxnId: string | null = null;
      let verifiedOriginalTxnId: string | null = null;
      let verifiedExpiresAt: number | null = null;
      let verifiedRevocationDate: number | null = null;
      let verifiedEnvironment: string | null = null;
      let verifiedAppAccountToken: string | null = null;
      if (isSignedTransaction(input.receipt)) {
        let payload;
        try {
          payload = verifySignedTransaction(input.receipt);
        } catch (e) {
          console.error("[verifyIap] signed transaction rejected:", (e as Error).message);
          throw new TRPCError({ code: "BAD_REQUEST", message: "購買憑證驗證失敗" });
        }
        const payloadProduct = resolveIapProduct(payload.productId);
        if (!payloadProduct || payloadProduct.productId !== product.productId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "產品 ID 不符" });
        }
        const expectedBundle = process.env.APPLE_BUNDLE_ID;
        if (expectedBundle && payload.bundleId !== expectedBundle) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Bundle ID 不符" });
        }
        verifiedTxnId = payload.transactionId;
        verifiedOriginalTxnId = payload.originalTransactionId ?? payload.transactionId;
        verifiedExpiresAt = payload.expiresDate ?? null;
        verifiedRevocationDate = payload.revocationDate ?? null;
        verifiedEnvironment = payload.environment ?? null;
        verifiedAppAccountToken = payload.appAccountToken ?? null;
      } else if (process.env.NODE_ENV === "production") {
        // In production we refuse unverifiable receipts.
        throw new TRPCError({ code: "BAD_REQUEST", message: "需要有效的 App Store 交易憑證" });
      }

      const txnDate = input.transactionDate ? new Date(input.transactionDate) : new Date();
      const transactionId = verifiedTxnId
        ? `apple_${verifiedTxnId}`
        : `${ctx.user.id}_${product.productId}_${Math.floor(txnDate.getTime() / 1000)}`;
      const originalTransactionId = verifiedOriginalTxnId ?? transactionId;

      try {
        return await verifyIapPurchase(iapStore, {
          familyId: ctx.activeFamilyId,
          userId: String(ctx.user.id),
          appAccountToken: input.appAccountToken ?? null,
          verified: {
            transactionId: verifiedTxnId ?? transactionId,
            originalTransactionId,
            productId: product.productId,
            expiresAt: verifiedExpiresAt != null ? new Date(verifiedExpiresAt) : null,
            revocationDate:
              verifiedRevocationDate != null ? new Date(verifiedRevocationDate) : null,
            environment: verifiedEnvironment,
            appAccountToken: verifiedAppAccountToken,
            transactionDate: txnDate,
            receipt: input.receipt,
            purchaseToken: input.purchaseToken ?? null,
          },
        });
      } catch (e) {
        if (e instanceof IapError) throw trpcErrorFor(e);
        throw e;
      }
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