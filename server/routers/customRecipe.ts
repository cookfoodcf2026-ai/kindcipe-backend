/**
 * customRecipe router — CRUD for user-created recipes stored in the database.
 * All procedures are protected (require login + family membership).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, familyWriteProcedure, router } from "../_core/trpc";
import {
  getCustomRecipes,
  insertCustomRecipe,
  updateCustomRecipeById,
  deleteCustomRecipeById,
  getFamilySubscription,
  getImportUsage,
  incrementImportUsage,
  countCustomRecipesCreatedThisMonth,
  getPushTokensByFamily,
} from "../db";
import { sendPushNotifications } from "../pushNotification";

export const customRecipeRouter = router({
  /** List all custom recipes for the current user's family */
  list: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.activeFamilyId) return [];
    return getCustomRecipes(ctx.activeFamilyId);
  }),

  /** Create a new custom recipe */
  create: familyWriteProcedure
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
        sourceType: z.enum(["instagram", "youtube", "xiaohongshu", "threads", "manual"]).optional(),
        sourceUrl: z.string().optional(),
        sourceUrlHash: z.string().optional(),
        sourceAuthor: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No family found" });
      }

      // Check import limits for non-paid families
      const sub = await getFamilySubscription(ctx.activeFamilyId);
      if (sub && !sub.isPaid) {
        const usage = await getImportUsage(ctx.activeFamilyId);
        if (usage >= sub.maxImportsPerMonth) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `免費版每月最多匯入 ${usage}/${sub.maxImportsPerMonth} 條食譜，升級家庭版可匯入 200 條`,
          });
        }

        // 免費版每月最多建立 20 條自訂食譜（含匯入）
        const createdThisMonth = await countCustomRecipesCreatedThisMonth(ctx.activeFamilyId);
        if (createdThisMonth >= 20) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `免費版每月最多建立 20 條自訂食譜（已用 ${createdThisMonth}/20），升級家庭版可無限建立`,
          });
        }
      }

      // Only count as "import" if it came from an external source
      const isImport = input.sourceType && input.sourceType !== "manual";
      if (isImport) {
        await incrementImportUsage(ctx.user.id, ctx.activeFamilyId);
      }

      const recipe = await insertCustomRecipe({
        ...input,
        familyId: ctx.activeFamilyId,
        createdByUserId: String(ctx.user.id),
      });

      // Push notification to all family members when a recipe is imported
      if (isImport && ctx.activeFamilyId) {
        const tokens = await getPushTokensByFamily(ctx.activeFamilyId);
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
  update: familyWriteProcedure
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
      if (!ctx.activeFamilyId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No family found" });
      }
      const { id, ...data } = input;
      return updateCustomRecipeById(id, ctx.activeFamilyId, data);
    }),

  /** Delete a custom recipe (must belong to same family) */
  delete: familyWriteProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No family found" });
      }
      await deleteCustomRecipeById(input.id, ctx.activeFamilyId);
      return { success: true };
    }),
});
