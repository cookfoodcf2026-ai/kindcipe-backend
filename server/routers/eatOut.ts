import { router, protectedProcedure, familyWriteProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { familyEatOut, mealPlans } from "../../drizzle/schema";
import { and, eq, gte, lte } from "drizzle-orm";

export const eatOutRouter = router({
  set: familyWriteProcedure
    .input(z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      eatOut: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "請先加入家庭廚房" });
      }
      if (ctx.activeFamilyRole !== "owner" && ctx.activeFamilyRole !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only owner/admin can set eat-out" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      if (input.eatOut) {
        await db.insert(familyEatOut).values({
          familyId: ctx.activeFamilyId,
          date: input.date,
          setByUserId: ctx.user.id,
        }).onConflictDoNothing({ target: [familyEatOut.familyId, familyEatOut.date] });

        try {
          await db.delete(mealPlans).where(
            and(
              eq(mealPlans.familyId, ctx.activeFamilyId),
              eq(mealPlans.date, input.date),
              eq(mealPlans.mealType, "dinner")
            )
          );
        } catch (e) {
          console.error("[eatOut.set] Failed to delete meal plans:", {
            error: e,
            familyId: ctx.activeFamilyId,
            date: input.date,
          });
        }
      } else {
        await db.delete(familyEatOut).where(
          and(eq(familyEatOut.familyId, ctx.activeFamilyId), eq(familyEatOut.date, input.date))
        );
      }

      return { success: true };
    }),

  listByDateRange: protectedProcedure
    .input(z.object({ startDate: z.string(), endDate: z.string() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) return [];
      const db = await getDb();
      if (!db) return [];
      const result = await db
        .select({ date: familyEatOut.date })
        .from(familyEatOut)
        .where(
          and(
            eq(familyEatOut.familyId, ctx.activeFamilyId),
            gte(familyEatOut.date, input.startDate),
            lte(familyEatOut.date, input.endDate),
          )
        );
      return result.map(r => r.date);
    }),
});
