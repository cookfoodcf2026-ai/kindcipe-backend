import { router, protectedProcedure, familyWriteProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { familyEatOut, mealPlans, shoppingItems } from "../../drizzle/schema";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import {
  applyEatOutSet,
  type EatOutSetDeps,
} from "../lib/eatOutSnapshot";

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

      const familyId = ctx.activeFamilyId;
      const result = await db.transaction(async (tx) => {
        const deps: EatOutSetDeps = {
          async insertFlag(familyId, date, userId) {
            await tx.insert(familyEatOut).values({
              familyId,
              date,
              setByUserId: userId,
            }).onConflictDoNothing({
              target: [familyEatOut.familyId, familyEatOut.date],
            });
          },
          async getFlag(familyId, date) {
            const rows = await tx.select({ planSnapshot: familyEatOut.planSnapshot })
              .from(familyEatOut)
              .where(and(
                eq(familyEatOut.familyId, familyId),
                eq(familyEatOut.date, date),
              ))
              .limit(1);
            return rows[0] ?? null;
          },
          async deleteFlag(familyId, date) {
            await tx.delete(familyEatOut).where(and(
              eq(familyEatOut.familyId, familyId),
              eq(familyEatOut.date, date),
            ));
          },
          async saveSnapshot(familyId, date, snapshot) {
            await tx.update(familyEatOut)
              .set({ planSnapshot: snapshot, updatedAt: new Date() })
              .where(and(
                eq(familyEatOut.familyId, familyId),
                eq(familyEatOut.date, date),
              ));
          },
          async listMealPlans(familyId, date, mealTypes) {
            return tx.select()
              .from(mealPlans)
              .where(and(
                eq(mealPlans.familyId, familyId),
                eq(mealPlans.date, date),
                inArray(mealPlans.mealType, mealTypes as never),
              ));
          },
          async deleteMealPlans(familyId, date, mealTypes) {
            await tx.delete(mealPlans).where(and(
              eq(mealPlans.familyId, familyId),
              eq(mealPlans.date, date),
              inArray(mealPlans.mealType, mealTypes as never),
            ));
          },
          async listShoppingItemIdsForPlans(familyId, planIds) {
            if (planIds.length === 0) return [];
            const rows = await tx.select({ id: shoppingItems.id })
              .from(shoppingItems)
              .where(and(
                eq(shoppingItems.familyId, familyId),
                inArray(shoppingItems.fromMealPlanId, planIds),
              ));
            return rows.map((row) => row.id);
          },
          async listDayMealTypes(familyId, date) {
            const rows = await tx.select({ mealType: mealPlans.mealType })
              .from(mealPlans)
              .where(and(
                eq(mealPlans.familyId, familyId),
                eq(mealPlans.date, date),
              ));
            return rows.map((row) => row.mealType);
          },
          async insertMealPlans(familyId, date, plans) {
            if (plans.length === 0) return [];
            const rows = await tx.insert(mealPlans).values(plans.map((plan) => ({
              familyId,
              date,
              mealType: plan.mealType as never,
              recipeId: plan.recipeId,
              recipeName: plan.recipeName,
              recipeNameEn: plan.recipeNameEn,
              recipeNameFil: plan.recipeNameFil,
              recipeNameId: plan.recipeNameId,
              recipeImage: plan.recipeImage,
              status: plan.status as never,
              proposedByUserId: plan.proposedByUserId,
              proposedByName: plan.proposedByName,
              confirmedByUserId: plan.confirmedByUserId,
              confirmedAt: plan.confirmedAt ? new Date(plan.confirmedAt) : null,
              note: plan.note,
            }))).returning({ id: mealPlans.id });
            return rows.map((row) => row.id);
          },
          async listShoppingItems(familyId, ids) {
            if (ids.length === 0) return [];
            return tx.select({
              id: shoppingItems.id,
              fromMealPlanId: shoppingItems.fromMealPlanId,
            })
              .from(shoppingItems)
              .where(and(
                eq(shoppingItems.familyId, familyId),
                inArray(shoppingItems.id, ids),
              ));
          },
          async relinkShoppingItems(familyId, itemIds, newPlanId) {
            if (itemIds.length === 0) return;
            await tx.update(shoppingItems)
              .set({ fromMealPlanId: newPlanId, updatedAt: new Date() })
              .where(and(
                eq(shoppingItems.familyId, familyId),
                inArray(shoppingItems.id, itemIds),
              ));
          },
        };

        return applyEatOutSet(deps, {
          familyId,
          date: input.date,
          eatOut: input.eatOut,
          userId: String(ctx.user.id),
        });
      });

      return result;
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
