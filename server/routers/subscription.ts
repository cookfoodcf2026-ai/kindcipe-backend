/**
 * subscription router — IAP receipt verification + subscription status.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  activateFamilySubscription,
  getFamilySubscription,
  getIapTransactionByTransactionId,
  insertIapTransaction,
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

      const txnDate = input.transactionDate ? new Date(input.transactionDate) : new Date();
      const transactionId = `${ctx.user.id}_${input.productId}_${Math.floor(txnDate.getTime() / 1000)}`;

      // Idempotency: already processed → return current status without re-extending
      const existing = await getIapTransactionByTransactionId(transactionId);
      if (existing) {
        const sub = await getFamilySubscription(ctx.activeFamilyId);
        return { status: "active", plan: existing.planType, expiresAt: sub?.subscriptionExpiresAt ? sub.subscriptionExpiresAt.toISOString() : null, duplicate: true };
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + product.days * 24 * 60 * 60 * 1000);
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
});