import { z } from "zod";
import { nanoid } from "nanoid";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { createPromoCode, getPromoCode } from "../db";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),

  // ── Admin: generate an IG-follow 7-day trial promo code ───────────────────
  generatePromoCode: adminProcedure
    .input(
      z.object({
        maxUses: z.number().int().min(1).max(10).default(1),
        validDays: z.number().int().min(1).max(90).default(7),
      })
    )
    .mutation(async ({ input }) => {
      const code = nanoid(6).toUpperCase();
      await createPromoCode({ code, maxUses: input.maxUses, expiresAt: new Date(Date.now() + input.validDays * 24 * 60 * 60 * 1000) });
      const row = await getPromoCode(code);
      return {
        code,
        expiresAt: row?.expiresAt ? row.expiresAt.toISOString() : null,
        maxUses: row?.maxUses ?? input.maxUses,
      };
    }),
});
