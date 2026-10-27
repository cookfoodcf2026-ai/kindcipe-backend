/**
 * customRecipe router — CRUD for user-created recipes stored in the database.
 * All procedures are protected (require login + family membership).
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, familyWriteProcedure, router } from "../_core/trpc";
import {
  getCustomRecipes,
  insertCustomRecipe,
  updateCustomRecipeById,
  deleteCustomRecipeById,
  incrementImportUsage,
  getPushTokensByFamily,
  getFamilyLanguage,
} from "../db";
import { msg } from "../_core/msg";
import { sendPushNotifications } from "../pushNotification";
import { normalizeRecipeIngredients } from "../utils/ingredientNormalize";
import { getFamilyEntitlements } from "../services/entitlements";
import { runWithUsage, usageLimitToTRPC } from "../services/usage";

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

      const familyId = ctx.activeFamilyId;
      const userId = String(ctx.user.id);
      const ent = await getFamilyEntitlements(familyId, userId);
      if (!ent) throw new TRPCError({ code: "NOT_FOUND", message: "找不到家庭廚房" });
      if (ent.readOnly) {
        throw new TRPCError({ code: "FORBIDDEN", message: "你目前只可檢視此廚房。" });
      }

      const isImport = Boolean(input.sourceType && input.sourceType !== "manual");
      const cost = isImport ? { credits: 1, imports: 1 } : { customRecipes: 1 };

      try {
        return await runWithUsage(
          {
            familyId,
            userId,
            kind: isImport ? "import" : "custom_recipe",
            limits: ent.limits,
            idempotencyKey: `custom:${ctx.activeFamilyId}:${ctx.user.id}:${randomUUID()}`,
            cost,
            metadata: { name: input.name, sourceType: input.sourceType ?? "manual" },
          },
          async () => {
            let normalizedIngredients = input.ingredients;
            if (input.ingredients) {
              try {
                const parsed = JSON.parse(input.ingredients);
                if (Array.isArray(parsed)) {
                  normalizedIngredients = JSON.stringify(normalizeRecipeIngredients(parsed));
                }
              } catch { /* keep as-is */ }
            }

            const recipe = await insertCustomRecipe({
              ...input,
              ingredients: normalizedIngredients,
              familyId,
              createdByUserId: userId,
            });

            if (isImport) {
              try { await incrementImportUsage(userId, familyId); } catch { /* history only */ }
            }

            if (isImport) {
              const tokens = await getPushTokensByFamily(familyId);
              const lang = await getFamilyLanguage(familyId);
              sendPushNotifications(tokens, {
                title: msg(lang, "push.newRecipe.title"),
                body: msg(lang, "push.newRecipe.body", { name: input.name }),
                data: { type: "recipe_imported", recipeId: String(recipe?.id ?? "") },
              }).catch(() => {});
            }

            return recipe;
          }
        );
      } catch (error) {
        usageLimitToTRPC(error);
      }
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
