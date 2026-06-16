/**
 * customRecipe router — CRUD for user-created recipes stored in the database.
 * All procedures are protected (require login + family membership).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getCustomRecipes,
  insertCustomRecipe,
  updateCustomRecipeById,
  deleteCustomRecipeById,
  getFamilySubscription,
  getImportUsage,
  incrementImportUsage,
  getPushTokensByFamily,
} from "../db";
import { sendPushNotifications } from "../pushNotification";

export const customRecipeRouter = router({
  /** List all custom recipes for the current user's family */
  list: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user.familyId) return [];
    return getCustomRecipes(ctx.user.familyId);
  }),

  /** Create a new custom recipe */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(128),
        description: z.string().optional(),
        image: z.string().optional(),
        thumbnailUrl: z.string().optional(),
        cookTime: z.number().int().min(0).optional(),
        servings: z.number().int().min(1).optional(),
        difficulty: z.string().optional(),
        recipeCategory: z.string().optional(),
        ingredients: z.string().optional(), // JSON string
        steps: z.string().optional(),       // JSON string
        tags: z.string().optional(),        // JSON string
        sourceType: z.enum(["instagram", "youtube", "xiaohongshu", "manual"]).optional(),
        sourceUrl: z.string().optional(),
        sourceUrlHash: z.string().optional(),
        sourceAuthor: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.familyId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No family found" });
      }

      // Check import limits for non-paid families
      const sub = await getFamilySubscription(ctx.user.familyId);
      if (sub && !sub.isPaid) {
        const usage = await getImportUsage(ctx.user.id);
        if (usage >= 5) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `Free plan allows 5 recipe imports per month. You've used ${usage}/5. Upgrade to import unlimited recipes.`,
          });
        }
      }

      // Only count as "import" if it came from an external source
      const isImport = input.sourceType && input.sourceType !== "manual";
      if (isImport) {
        await incrementImportUsage(ctx.user.id);
      }

      const recipe = await insertCustomRecipe({
        ...input,
        familyId: ctx.user.familyId,
        createdByUserId: String(ctx.user.id),
      });

      // Push notification to all family members when a recipe is imported
      if (isImport && ctx.user.familyId) {
        const tokens = await getPushTokensByFamily(ctx.user.familyId);
        const importerName = ctx.user.name || "家庭成員";
        sendPushNotifications(tokens, {
          title: "🍳 新食譜加入廚房",
          body: `${importerName} 匯入了新食譜：${input.name}`,
          data: { type: "recipe_imported", recipeId: String(recipe?.id ?? "") },
        }).catch(() => {});
      }

      return recipe;
    }),

  /** Update an existing custom recipe (must belong to same family) */
  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int(),
        name: z.string().min(1).max(128).optional(),
        description: z.string().optional(),
        image: z.string().optional(),
        cookTime: z.number().int().min(0).optional(),
        servings: z.number().int().min(1).optional(),
        difficulty: z.string().optional(),
        recipeCategory: z.string().optional(),
        ingredients: z.string().optional(),
        steps: z.string().optional(),
        tags: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.familyId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No family found" });
      }
      const { id, ...data } = input;
      return updateCustomRecipeById(id, ctx.user.familyId, data);
    }),

  /** Delete a custom recipe (must belong to same family) */
  delete: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.familyId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No family found" });
      }
      await deleteCustomRecipeById(input.id, ctx.user.familyId);
      return { success: true };
    }),
});
