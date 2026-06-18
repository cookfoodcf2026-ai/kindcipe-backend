import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { sdk } from "./_core/sdk";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { aiRecipeRouter } from "./routers/aiRecipe";
import { priceWatchRouter } from "./routers/priceWatch";
import { recipesRouter } from "./routers/recipes";
import { customRecipeRouter } from "./routers/customRecipe";
import { weeklyMenuRouter } from "./routers/weeklyMenu";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { broadcastToFamily } from "./_core/sseSync";
import { notifyOwner } from "./_core/notification";
import { sendPushNotifications } from "./pushNotification";
import {
  addFamilyMember,
  addMealPlan,
  addPantryItem,
  addPantryItems,
  addShoppingItem,
  addShoppingItems,
  approveShoppingItem,
  clearBoughtItems,
  createFamily,
  deleteMealPlan,
  deleteShoppingItemsByMealPlan,
  getMealPlanById,
  deletePantryItem,
  deleteShoppingItem,
  deleteShoppingItemsByIds,
  getFamilySubscription,
  initFamilyTrial,
  getImportUsage,
  incrementImportUsage,
  upsertPushToken,
  getPushTokensByFamily,
  getPushTokensByUserIds,
  getPushTokensByUser,
  getFamilyById,
  getFamilyByInviteCode,
  getFamilyMemberByUserId,
  getFamilyMembers,
  getUserFamilies,
  setDefaultFamily,
  updateFamilyMemberRole,
  removeFamilyMember,
  getFamilySettings,
  updateFamilySettings,
  renameFamily,
  deleteFamily,
  getFavoriteItems,
  getMealPlans,
  getMealPlansByDateRange,
  getPantryItems,
  getShoppingItems,
  rejectShoppingItem,
  toggleFavoriteItem,
  updateMealPlanStatus,
  updatePantryItem,
  updateShoppingItemStatus,
  insertRecipeEvent,
  getTrendingRecipes,
  recordPurchase,
  getPurchaseHistory,
  getPurchaseFrequency,
  getLastPurchasePrices,
  updateShoppingItemDetails,
  getRecipeNotes,
  addRecipeNote,
  deleteRecipeNote,
  getUserByEmail,
  createEmailUser,
  verifyPassword,
  touchUserSignIn,
} from "./db";

const familyRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.activeFamilyId) return null;
    const family = await getFamilyById(ctx.activeFamilyId);
    if (!family) return null;
    const members = await getFamilyMembers(ctx.activeFamilyId);
    return {
      ...family,
      members: members.map((m) => ({
        id: m.member.id,
        userId: m.user.id,
        name: m.user.name || m.member.nickname || "Member",
        nickname: m.member.nickname,
        familyRole: m.member.familyRole,
        joinedAt: m.member.joinedAt,
        email: m.user.email,
      })),
    };
  }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const families = await getUserFamilies(String(ctx.user.id));
    return families.map((f) => ({
      id: f.family.id,
      name: f.family.name,
      role: f.member.familyRole,
      isDefault: f.member.isDefault,
      memberCount: 0,
    }));
  }),

  setActive: protectedProcedure
    .input(z.object({ familyId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const member = await getFamilyMemberByUserId(input.familyId, String(ctx.user.id));
      if (!member) throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this kitchen" });
      await setDefaultFamily(String(ctx.user.id), input.familyId);
      return { success: true };
    }),

  create: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(64), nickname: z.string().max(64).optional() }))
    .mutation(async ({ ctx, input }) => {
      const inviteCode = nanoid(6).toUpperCase();
      const family = await createFamily({ name: input.name, inviteCode, ownerId: String(ctx.user.id) });
      if (!family) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await initFamilyTrial(family.id);
      await addFamilyMember({ familyId: family.id, userId: String(ctx.user.id), familyRole: "owner", nickname: input.nickname || ctx.user.name || "Owner", isDefault: true });
      return { ...family, role: "owner" };
    }),

  join: protectedProcedure
    .input(z.object({
      inviteCode: z.string().min(4).max(16),
      familyRole: z.enum(["helper", "member"]).default("member"),
      nickname: z.string().max(64).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const family = await getFamilyByInviteCode(input.inviteCode);
      if (!family) throw new TRPCError({ code: "NOT_FOUND", message: "Invalid invite code" });
      const existing = await getFamilyMemberByUserId(family.id, String(ctx.user.id));
      if (existing) throw new TRPCError({ code: "BAD_REQUEST", message: "Already a member" });
      const sub = await getFamilySubscription(family.id);
      const currentMembers = await getFamilyMembers(family.id);
      if (sub && currentMembers.length >= sub.maxMembers) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: sub.isPaid
            ? `This kitchen has reached the maximum of ${sub.maxMembers} members.`
            : `Free plan allows up to 2 members. The kitchen owner needs to upgrade to add more members.`,
        });
      }
      await addFamilyMember({ familyId: family.id, userId: String(ctx.user.id), familyRole: input.familyRole, nickname: input.nickname || ctx.user.name || (input.familyRole === "helper" ? "Helper" : "Member") });
      return { success: true, family };
    }),

  subscription: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.activeFamilyId) return null;
    return getFamilySubscription(ctx.activeFamilyId);
  }),

  registerPushToken: protectedProcedure
    .input(z.object({
      token: z.string().min(10),
      platform: z.enum(["ios", "android"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await upsertPushToken(ctx.user.id, ctx.activeFamilyId ?? null, input.token, input.platform);
      return { success: true };
    }),

  updateMemberRole: protectedProcedure
    .input(z.object({
      familyId: z.number().int(),
      userId: z.string(),
      role: z.enum(["owner", "admin", "helper", "member"]),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.activeFamilyRole !== "owner") throw new TRPCError({ code: "FORBIDDEN", message: "Only owner can change roles" });
      await updateFamilyMemberRole(input.familyId, input.userId, input.role);
      return { success: true };
    }),

  removeMember: protectedProcedure
    .input(z.object({ familyId: z.number().int(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.activeFamilyRole !== "owner") throw new TRPCError({ code: "FORBIDDEN", message: "Only owner can remove members" });
      await removeFamilyMember(input.familyId, input.userId);
      return { success: true };
    }),

  leave: protectedProcedure
    .input(z.object({ familyId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const member = await getFamilyMemberByUserId(input.familyId, String(ctx.user.id));
      if (!member) throw new TRPCError({ code: "NOT_FOUND", message: "Not a member" });
      if (member.familyRole === "owner") throw new TRPCError({ code: "FORBIDDEN", message: "Owner cannot leave. Transfer ownership or disband instead." });
      await removeFamilyMember(input.familyId, String(ctx.user.id));
      return { success: true };
    }),

  settings: protectedProcedure
    .input(z.object({}).optional())
    .query(async ({ ctx }) => {
      if (!ctx.activeFamilyId) return null;
      return getFamilySettings(ctx.activeFamilyId);
    }),

  updateSettings: protectedProcedure
    .input(z.object({
      approvalRequired: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a kitchen" });
      if (ctx.activeFamilyRole !== "owner" && ctx.activeFamilyRole !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only owner/admin can change kitchen settings" });
      }
      const current = await getFamilySettings(ctx.activeFamilyId) as Record<string, unknown>;
      await updateFamilySettings(ctx.activeFamilyId, { ...current, ...input });
      return { success: true };
    }),

  rename: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a kitchen" });
      if (ctx.activeFamilyRole !== "owner" && ctx.activeFamilyRole !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only owner/admin can rename kitchen" });
      }
      await renameFamily(ctx.activeFamilyId, input.name);
      return { success: true };
    }),

  dissolve: protectedProcedure
    .mutation(async ({ ctx }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a kitchen" });
      if (ctx.activeFamilyRole !== "owner") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only owner can dissolve the kitchen" });
      }
      await deleteFamily(ctx.activeFamilyId);
      return { success: true };
    }),
});

const shoppingRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.activeFamilyId) return [];
    return getShoppingItems(ctx.activeFamilyId);
  }),

  add: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(128),
      nameEn: z.string().max(128).optional(),
      category: z.string().max(64).optional(),
      quantity: z.string().max(64).optional(),
      unit: z.string().max(32).optional(),
      estimatedPrice: z.number().int().optional(),
      status: z.enum(["pending", "active"]).default("active"),
      fromRecipeId: z.string().max(64).optional(),
      fromRecipeName: z.string().max(128).optional(),
      plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      const isHelper = ctx.activeFamilyRole === "helper";
      const status = isHelper ? "pending" : (input.status || "active");
      await addShoppingItem({
        familyId: ctx.activeFamilyId,
        name: input.name,
        nameEn: input.nameEn,
        category: input.category,
        quantity: input.quantity,
        unit: input.unit,
        estimatedPrice: input.estimatedPrice,
        status,
        proposedByUserId: isHelper ? ctx.user.id : undefined,
        proposedByName: isHelper ? (ctx.user.name || "Helper") : undefined,
        fromRecipeId: input.fromRecipeId,
        fromRecipeName: input.fromRecipeName,
        plannedDate: input.plannedDate,
      });
      if (ctx.activeFamilyId) broadcastToFamily(ctx.activeFamilyId, "shopping", ctx.user.id);
      return { success: true };
    }),

  addBatch: protectedProcedure
    .input(z.object({
      items: z.array(z.object({
        name: z.string().min(1).max(128),
        nameEn: z.string().max(128).optional(),
        category: z.string().max(64).optional(),
        quantity: z.string().max(64).optional(),
        unit: z.string().max(32).optional(),
      })),
      fromRecipeId: z.string().max(64).optional(),
      fromRecipeName: z.string().max(128).optional(),
      plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      const isHelper = ctx.activeFamilyRole === "helper";
      const status = isHelper ? "pending" : "active";

      const existingItems = await getShoppingItems(ctx.activeFamilyId);
      const activeItems = existingItems.filter(i => i.status !== "bought");

      function mergeQty(existing: string | null | undefined, adding: string | undefined): string {
        const a = parseFloat(existing ?? "");
        const b = parseFloat(adding ?? "");
        if (!isNaN(a) && !isNaN(b)) {
          const sum = parseFloat((a + b).toFixed(2));
          return String(sum);
        }
        return existing || adding || "";
      }

      const toInsert: typeof input.items = [];
      const toUpdate: { id: number; quantity: string }[] = [];

      for (const item of input.items) {
        const match = activeItems.find(
          i => i.name.trim() === item.name.trim() &&
               (i.unit ?? "").trim() === (item.unit ?? "").trim()
        );
        if (match) {
          toUpdate.push({ id: match.id, quantity: mergeQty(match.quantity, item.quantity) });
        } else {
          toInsert.push(item);
        }
      }

      for (const u of toUpdate) {
        await updateShoppingItemDetails(u.id, { quantity: u.quantity });
      }

      if (toInsert.length > 0) {
        const rows = toInsert.map((item) => ({
          familyId: ctx.activeFamilyId!,
          name: item.name,
          nameEn: item.nameEn,
          category: item.category,
          quantity: item.quantity,
          unit: item.unit,
          status: status as "pending" | "active",
          proposedByUserId: isHelper ? ctx.user.id : undefined,
          proposedByName: isHelper ? (ctx.user.name || "Helper") : undefined,
          fromRecipeId: input.fromRecipeId,
          fromRecipeName: input.fromRecipeName,
          plannedDate: input.plannedDate,
        }));
        await addShoppingItems(rows);
      }

      if (ctx.activeFamilyId) broadcastToFamily(ctx.activeFamilyId, "shopping", ctx.user.id);
      return { success: true, count: toInsert.length + toUpdate.length, merged: toUpdate.length };
    }),

  toggleBought: protectedProcedure
    .input(z.object({ id: z.number().int(), bought: z.boolean(), actualPrice: z.number().int().optional() }))
    .mutation(async ({ ctx, input }) => {
      const status = input.bought ? "bought" : "active";
      await updateShoppingItemStatus(input.id, status, input.bought ? ctx.user.id : undefined, input.bought ? (ctx.user.name || "Someone") : undefined);
      if (input.bought && ctx.activeFamilyId) {
        const items = await getShoppingItems(ctx.activeFamilyId);
        const item = items.find(i => i.id === input.id);
        if (item) {
          recordPurchase({
            familyId: ctx.activeFamilyId,
            userId: ctx.user.id,
            userName: ctx.user.name || 'Someone',
            name: item.name,
            category: item.category ?? undefined,
            unit: item.unit ?? undefined,
            quantity: item.quantity ?? undefined,
            shoppingItemId: input.id,
            actualPrice: input.actualPrice,
          }).catch(() => {});
        }
      }
      if (ctx.activeFamilyId) broadcastToFamily(ctx.activeFamilyId ?? 0, "shopping", ctx.user.id);
      return { success: true };
    }),
  updateItem: protectedProcedure
    .input(z.object({
      id: z.number().int(),
      name: z.string().min(1).max(128).optional(),
      quantity: z.string().max(64).optional(),
      unit: z.string().max(32).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await updateShoppingItemDetails(input.id, {
        name: input.name,
        quantity: input.quantity,
        unit: input.unit,
      });
      return { success: true };
    }),

  approve: protectedProcedure
    .input(z.object({ id: z.number().int(), itemName: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyRole || (ctx.activeFamilyRole !== "owner" && ctx.activeFamilyRole !== "admin")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only owner/admin can approve" });
      }
      await approveShoppingItem(input.id);
      if (ctx.activeFamilyId) {
        broadcastToFamily(ctx.activeFamilyId, "shopping", ctx.user.id);
        const tokens = await getPushTokensByFamily(ctx.activeFamilyId);
        sendPushNotifications(tokens, {
          title: '✅ 採購已批准',
          body: input.itemName ? `Owner已批准採購：${input.itemName}` : 'Owner已批准你的採購提議',
          data: { type: 'shopping_approved' },
        }).catch(() => {});
      }
      return { success: true };
    }),

  reject: protectedProcedure
    .input(z.object({ id: z.number().int(), itemName: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyRole || (ctx.activeFamilyRole !== "owner" && ctx.activeFamilyRole !== "admin")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only owner/admin can reject" });
      }
      await rejectShoppingItem(input.id);
      if (ctx.activeFamilyId) {
        broadcastToFamily(ctx.activeFamilyId, "shopping", ctx.user.id);
        const tokens = await getPushTokensByFamily(ctx.activeFamilyId);
        sendPushNotifications(tokens, {
          title: '❌ 採購未批准',
          body: input.itemName ? `Owner未批准採購：${input.itemName}` : 'Owner未批准你的採購提議',
          data: { type: 'shopping_rejected' },
        }).catch(() => {});
      }
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await deleteShoppingItem(input.id);
      if (ctx.activeFamilyId) broadcastToFamily(ctx.activeFamilyId, "shopping", ctx.user.id);
      return { success: true };
    }),

  deleteMany: protectedProcedure
    .input(z.object({ ids: z.array(z.number().int()) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      await deleteShoppingItemsByIds(input.ids, ctx.activeFamilyId);
      if (ctx.activeFamilyId) broadcastToFamily(ctx.activeFamilyId, "shopping", ctx.user.id);
      return { success: true };
    }),

  clearBought: protectedProcedure
    .mutation(async ({ ctx }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      await clearBoughtItems(ctx.activeFamilyId);
      if (ctx.activeFamilyId) broadcastToFamily(ctx.activeFamilyId, "shopping", ctx.user.id);
      return { success: true };
    }),
});

const mealPlanRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.activeFamilyId) return [];
    return getMealPlans(ctx.activeFamilyId);
  }),

  listByDateRange: protectedProcedure
    .input(z.object({ startDate: z.string(), endDate: z.string() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) return [];
      return getMealPlansByDateRange(ctx.activeFamilyId, input.startDate, input.endDate);
    }),

  add: protectedProcedure
    .input(z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]).default("dinner"),
      recipeId: z.string().min(1).max(64),
      recipeName: z.string().min(1).max(128),
      recipeImage: z.string().optional(),
      note: z.string().max(256).optional(),
      autoAddIngredients: z.boolean().default(true),
      ingredients: z.array(z.object({
        name: z.string(),
        quantity: z.string().optional(),
        unit: z.string().optional(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      const familySettings = await getFamilySettings(ctx.activeFamilyId) as { approvalRequired?: boolean };
      const isMember = ctx.activeFamilyRole === "member";
      const needsApproval = isMember && (familySettings.approvalRequired !== false);
      const status = needsApproval ? "pending" : "confirmed";
      await addMealPlan({
        familyId: ctx.activeFamilyId,
        date: input.date,
        mealType: input.mealType,
        recipeId: input.recipeId,
        recipeName: input.recipeName,
        recipeImage: input.recipeImage,
        status,
        proposedByUserId: ctx.user.id,
        proposedByName: ctx.user.name || (ctx.activeFamilyRole === "helper" ? "Helper" : "Member"),
        note: input.note,
      });
      if (input.autoAddIngredients && input.ingredients && input.ingredients.length > 0) {
        const ingredientStatus = needsApproval ? "pending" as const : "active" as const;
        const rows = input.ingredients.map((ing) => ({
          familyId: ctx.activeFamilyId!,
          name: ing.name,
          quantity: ing.quantity,
          unit: ing.unit,
          status: ingredientStatus,
          proposedByUserId: ctx.user.id,
          proposedByName: ctx.user.name || (needsApproval ? "Member" : "Owner"),
          fromRecipeId: input.recipeId,
          fromRecipeName: input.recipeName,
          plannedDate: input.date,
        }));
        await addShoppingItems(rows);
      }
      if (ctx.activeFamilyId) broadcastToFamily(ctx.activeFamilyId, "mealPlan", ctx.user.id);
      const mealTypeLabels: Record<string, string> = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '小食' };
      const mealLabel = mealTypeLabels[input.mealType] ?? input.mealType;
      const actorName = ctx.user.name || 'Member';
      if (needsApproval) {
        const adminTokens = await getPushTokensByUserIds(
          (await getFamilyMembers(ctx.activeFamilyId))
            .filter(m => m.member.familyRole === "owner" || m.member.familyRole === "admin")
            .map(m => m.user.id)
        );
        sendPushNotifications(adminTokens, {
          title: `🍽️ ${actorName} 提議排餐`,
          body: `${input.date} ${mealLabel}：${input.recipeName}（待確認）`,
          data: { type: 'meal_plan_proposed' },
        }).catch(() => {});
      } else {
        const allTokens = await getPushTokensByFamily(ctx.activeFamilyId);
        sendPushNotifications(allTokens, {
          title: '📅 排餐已更新',
          body: `${input.date} ${mealLabel}：${input.recipeName}`,
          data: { type: 'meal_plan_updated' },
        }).catch(() => {});
      }
      return { success: true, status };
    }),

  confirm: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyRole || (ctx.activeFamilyRole !== "owner" && ctx.activeFamilyRole !== "admin")) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await updateMealPlanStatus(input.id, "confirmed", ctx.user.id);
      if (ctx.activeFamilyId) broadcastToFamily(ctx.activeFamilyId, "mealPlan", ctx.user.id);
      return { success: true };
    }),

  reject: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyRole || (ctx.activeFamilyRole !== "owner" && ctx.activeFamilyRole !== "admin")) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await updateMealPlanStatus(input.id, "rejected", ctx.user.id);
      if (ctx.activeFamilyId) broadcastToFamily(ctx.activeFamilyId, "mealPlan", ctx.user.id);
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      const plan = await getMealPlanById(input.id);
      await deleteMealPlan(input.id);
      if (plan?.recipeId && plan?.date) {
        await deleteShoppingItemsByMealPlan(ctx.activeFamilyId, plan.recipeId, plan.date);
      }
      if (ctx.activeFamilyId) broadcastToFamily(ctx.activeFamilyId, "mealPlan", ctx.user.id);
      return { success: true };
    }),
});

const pantryRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.activeFamilyId) return [];
    return getPantryItems(ctx.activeFamilyId);
  }),

  add: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      category: z.string().optional(),
      quantity: z.string().optional(),
      unit: z.string().optional(),
      expiryDate: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new Error('No family');
      await addPantryItem({
        familyId: ctx.activeFamilyId,
        name: input.name,
        category: input.category ?? null,
        quantity: input.quantity ?? null,
        unit: input.unit ?? null,
        expiryDate: input.expiryDate ?? null,
      });
      return { success: true };
    }),

  /** Batch import bought shopping items into pantry */
  importFromShopping: protectedProcedure
    .input(z.array(z.object({
      name: z.string(),
      category: z.string().optional(),
      quantity: z.string().optional(),
      unit: z.string().optional(),
    })))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new Error('No family');
      const items = input.map(i => ({
        familyId: ctx.activeFamilyId!,
        name: i.name,
        category: i.category ?? null,
        quantity: i.quantity ?? null,
        unit: i.unit ?? null,
        expiryDate: null,
      }));
      await addPantryItems(items);
      return { success: true, count: items.length };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await deletePantryItem(input.id);
      return { success: true };
    }),

  /** Toggle inStock flag */
  toggleInStock: protectedProcedure
    .input(z.object({ id: z.number().int(), inStock: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await updatePantryItem(input.id, { inStock: input.inStock });
      return { success: true };
    }),

  /** Toggle isLow flag */
  toggleLow: protectedProcedure
    .input(z.object({ id: z.number().int(), isLow: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await updatePantryItem(input.id, { isLow: input.isLow });
      return { success: true };
    }),

  /** Add bought shopping items to pantry (one-click import) */
  addFromShopping: protectedProcedure
    .input(z.array(z.object({
      name: z.string(),
      category: z.string().optional(),
      quantity: z.string().optional(),
      unit: z.string().optional(),
    })))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new Error('No family');
      const items = input.map(i => ({
        familyId: ctx.activeFamilyId!,
        name: i.name,
        category: i.category ?? null,
        quantity: i.quantity ?? null,
        unit: i.unit ?? null,
        expiryDate: null,
      }));
      await addPantryItems(items);
      return { success: true, count: items.length };
    }),
});

// ─── Purchase History Router ─────────────────────────────────────────────────────────────
const purchaseHistoryRouter = router({
  /** List purchase history for the current family */
  list: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(100) }).optional())
    .query(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) return [];
      return getPurchaseHistory(ctx.activeFamilyId, input?.limit ?? 100);
    }),
  /** Get purchase frequency stats for smart restock suggestions */
  frequency: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.activeFamilyId) return [];
    return getPurchaseFrequency(ctx.activeFamilyId);
  }),
  /**
   * Batch query: returns last purchase price for a list of item names.
   * Used in MarketPage to show price diff when user inputs a new price.
   */
  lastPrices: protectedProcedure
    .input(z.object({ itemNames: z.array(z.string().min(1)).max(100) }))
    .query(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) return {};
      return getLastPurchasePrices(ctx.activeFamilyId, input.itemNames);
    }),
  /**
   * Save a manually-entered price for a shopping item (without marking it as bought).
   * Records to purchaseHistory so it appears in future lastPrices queries.
   */
  savePrice: protectedProcedure
    .input(z.object({
      itemId: z.number().int(),
      itemName: z.string().min(1).max(128),
      price: z.number().int().min(1),
      category: z.string().optional(),
      unit: z.string().optional(),
      quantity: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not in a family' });
      // Update the estimatedPrice on the shopping item
      await updateShoppingItemDetails(input.itemId, { estimatedPrice: input.price });
      // Record to purchase history for future price diff display
      await recordPurchase({
        familyId: ctx.activeFamilyId,
        userId: ctx.user.id,
        userName: ctx.user.name || 'Someone',
        name: input.itemName,
        category: input.category,
        unit: input.unit,
        quantity: input.quantity,
        shoppingItemId: input.itemId,
        actualPrice: input.price,
      });
      return { success: true };
    }),
});

// ─── Favorite Items Router ─────────────────────────────────────────────────────────────
const favoriteItemsRouter = router({
  /** List all starred items for the current user */
  list: protectedProcedure.query(async ({ ctx }) => {
    return getFavoriteItems(ctx.user.id);
  }),

  /** Toggle star on/off for a product. Returns new state. */
  toggle: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      category: z.string().optional(),
      unit: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return toggleFavoriteItem(ctx.user.id, {
        name: input.name,
        category: input.category ?? null,
        unit: input.unit ?? null,
      });
    }),
});

// ─── Recipe Events Router ────────────────────────────────────────────────────
const recipeEventsRouter = router({
  /** Silently record a recipe interaction (view / plan / save / cook). Fire-and-forget. */
  track: publicProcedure
    .input(z.object({
      recipeId: z.string(),
      recipeName: z.string(),
      eventType: z.enum(['view', 'plan', 'save', 'cook']),
      userId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      await insertRecipeEvent({
        recipeId: input.recipeId,
        recipeName: input.recipeName,
        eventType: input.eventType,
        userId: input.userId ?? null,
      });
      return { ok: true };
    }),

  /** Get top trending recipes (last 7 days by default). */
  trending: publicProcedure
    .input(z.object({
      days: z.number().min(1).max(90).default(7),
      limit: z.number().min(1).max(50).default(20),
    }).optional())
    .query(async ({ input }) => {
      return getTrendingRecipes(input?.days ?? 7, input?.limit ?? 20);
    }),
});

// ─── Recipe Notes Router ────────────────────────────────────────────────────
const recipeNotesRouter = router({
  list: protectedProcedure
    .input(z.object({ recipeId: z.string() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) return [];
      return getRecipeNotes(ctx.activeFamilyId, input.recipeId);
    }),
  add: protectedProcedure
    .input(z.object({
      recipeId: z.string(),
      recipeName: z.string().optional(),
      content: z.string().min(1).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new Error('No family');
      await addRecipeNote({
        familyId: ctx.activeFamilyId,
        recipeId: input.recipeId,
        recipeName: input.recipeName,
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        content: input.content,
      });
      return { ok: true };
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new Error('No family');
      await deleteRecipeNote(input.id, ctx.user.id, ctx.activeFamilyId);
      return { ok: true };
    }),
});

export const appRouter = router({
  system: systemRouter,
  aiRecipe: aiRecipeRouter,
  priceWatch: priceWatchRouter,
  recipes: recipesRouter,
  auth: router({
    me: publicProcedure.query((opts) => {
      const user = opts.ctx.user;
      if (!user) return null;
      return {
        ...user,
        activeFamilyId: opts.ctx.activeFamilyId,
        activeFamilyRole: opts.ctx.activeFamilyRole,
      };
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),

    // ── Email Registration ────────────────────────────────────────────────────
    emailRegister: publicProcedure
      .input(z.object({
        email: z.string().email(),
        password: z.string().min(8, "Password must be at least 8 characters"),
        name: z.string().min(1).max(64),
      }))
      .mutation(async ({ ctx, input }) => {
        // Check if email already exists
        const existing = await getUserByEmail(input.email);
        if (existing) {
          throw new TRPCError({ code: "CONFLICT", message: "此電郵已被使用，請直接登入" });
        }
        // Create user
        const created = await createEmailUser({
          email: input.email,
          password: input.password,
          name: input.name,
        });
        if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "建立帳號失敗，請稍後再試" });

        // Create session token (for React Native / Bearer auth)
        const sessionToken = await sdk.createSessionToken(created.openId, { name: input.name, expiresInMs: ONE_YEAR_MS });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
        return { success: true, token: sessionToken };
      }),

    // ── Email Login ───────────────────────────────────────────────────────────
    emailLogin: publicProcedure
      .input(z.object({
        email: z.string().email(),
        password: z.string().min(1),
      }))
      .mutation(async ({ ctx, input }) => {
        const user = await getUserByEmail(input.email);
        if (!user || !user.passwordHash) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "電郵或密碼錯誤" });
        }
        const valid = verifyPassword(input.password, user.passwordHash);
        if (!valid) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "電郵或密碼錯誤" });
        }
        await touchUserSignIn(user.id);
        const sessionToken = await sdk.createSessionToken(user.openId, { name: user.name || "", expiresInMs: ONE_YEAR_MS });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
        return { success: true, token: sessionToken };

      }),
  }),
  family: familyRouter,
  shopping: shoppingRouter,
  mealPlan: mealPlanRouter,
  pantry: pantryRouter,
  favoriteItems: favoriteItemsRouter,
  recipeEvents: recipeEventsRouter,
  purchaseHistory: purchaseHistoryRouter,
  customRecipe: customRecipeRouter,
  weeklyMenu: weeklyMenuRouter,
  recipeNotes: recipeNotesRouter,
});

export type AppRouter = typeof appRouter;
