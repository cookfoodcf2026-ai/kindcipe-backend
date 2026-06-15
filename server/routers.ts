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
  getPushTokensByUser,
  getFamilyById,
  getFamilyByInviteCode,
  getFamilyMemberByUserId,
  getFamilyMembers,
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
  updateUserFamily,
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
    if (!ctx.user.familyId) return null;
    const family = await getFamilyById(ctx.user.familyId);
    if (!family) return null;
    const members = await getFamilyMembers(ctx.user.familyId);
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

  create: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.familyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Already in a family" });
      const inviteCode = nanoid(6).toUpperCase();
      const family = await createFamily({ name: input.name, inviteCode, ownerId: ctx.user.id });
      if (!family) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // Initialise 7-day free trial for this new family
      await initFamilyTrial(family.id);
      await updateUserFamily(ctx.user.id, family.id, "housewife");
      await addFamilyMember({ familyId: family.id, userId: ctx.user.id, familyRole: "housewife", nickname: ctx.user.name || "Madam" });
      return family;
    }),

  join: protectedProcedure
    .input(z.object({
      inviteCode: z.string().min(4).max(16),
      familyRole: z.enum(["helper", "member"]).default("helper"),
      nickname: z.string().max(64).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.familyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Already in a family" });
      const family = await getFamilyByInviteCode(input.inviteCode);
      if (!family) throw new TRPCError({ code: "NOT_FOUND", message: "Invalid invite code" });
      const existing = await getFamilyMemberByUserId(family.id, ctx.user.id);
      if (existing) throw new TRPCError({ code: "BAD_REQUEST", message: "Already a member" });
      // Check member limit based on subscription
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
      await updateUserFamily(ctx.user.id, family.id, input.familyRole);
      await addFamilyMember({ familyId: family.id, userId: ctx.user.id, familyRole: input.familyRole, nickname: input.nickname || ctx.user.name || (input.familyRole === "helper" ? "Helper" : "Member") });
      return { success: true, family };
    }),

  // Returns subscription status for the current user's family
  subscription: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user.familyId) return null;
    return getFamilySubscription(ctx.user.familyId);
  }),

  // Register push token for this device
  registerPushToken: protectedProcedure
    .input(z.object({
      token: z.string().min(10),
      platform: z.enum(["ios", "android"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await upsertPushToken(ctx.user.id, ctx.user.familyId ?? null, input.token, input.platform);
      return { success: true };
    }),
});

const shoppingRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user.familyId) return [];
    return getShoppingItems(ctx.user.familyId);
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
      if (!ctx.user.familyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      const isHelper = ctx.user.familyRole === "helper";
      const status = isHelper ? "pending" : (input.status || "active");
      await addShoppingItem({
        familyId: ctx.user.familyId,
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
      broadcastToFamily(ctx.user.familyId, "shopping", ctx.user.id);
      // Notify owner when helper proposes a shopping item
      if (isHelper) {
        const helperName = ctx.user.name || "Helper";
        const itemDesc = input.quantity ? `${input.name} × ${input.quantity}${input.unit ?? ''}` : input.name;
        notifyOwner({
          title: `🛒 ${helperName} 提議採購`,
          content: `${helperName} 提議加入採購清單：${itemDesc}，請確認。`,
        }).catch(() => {});
      }
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
      if (!ctx.user.familyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      const isHelper = ctx.user.familyRole === "helper";
      const status = isHelper ? "pending" : "active";

      // 去重合併：先查詢家庭已有未購買的食材，同名稱+單位的自動合併數量
      const existingItems = await getShoppingItems(ctx.user.familyId);
      const activeItems = existingItems.filter(i => i.status !== "bought");

      // Helper: merge numeric quantities for same name+unit
      function mergeQty(existing: string | null | undefined, adding: string | undefined): string {
        const a = parseFloat(existing ?? "");
        const b = parseFloat(adding ?? "");
        if (!isNaN(a) && !isNaN(b)) {
          // Keep up to 2 decimal places, strip trailing zeros
          const sum = parseFloat((a + b).toFixed(2));
          return String(sum);
        }
        // Non-numeric (e.g. "適量"): keep existing
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

      // Update merged items
      for (const u of toUpdate) {
        await updateShoppingItemDetails(u.id, { quantity: u.quantity });
      }

      // Insert new items
      if (toInsert.length > 0) {
        const rows = toInsert.map((item) => ({
          familyId: ctx.user.familyId!,
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

      broadcastToFamily(ctx.user.familyId, "shopping", ctx.user.id);
      return { success: true, count: toInsert.length + toUpdate.length, merged: toUpdate.length };
    }),

  toggleBought: protectedProcedure
    .input(z.object({ id: z.number().int(), bought: z.boolean(), actualPrice: z.number().int().optional() }))
    .mutation(async ({ ctx, input }) => {
      const status = input.bought ? "bought" : "active";
      await updateShoppingItemStatus(input.id, status, input.bought ? ctx.user.id : undefined, input.bought ? (ctx.user.name || "Someone") : undefined);
      // Auto-record purchase history when item is marked as bought
      if (input.bought && ctx.user.familyId) {
        const items = await getShoppingItems(ctx.user.familyId);
        const item = items.find(i => i.id === input.id);
        if (item) {
          recordPurchase({
            familyId: ctx.user.familyId,
            userId: ctx.user.id,
            userName: ctx.user.name || 'Someone',
            name: item.name,
            category: item.category ?? undefined,
            unit: item.unit ?? undefined,
            quantity: item.quantity ?? undefined,
            shoppingItemId: input.id,
            actualPrice: input.actualPrice,
          }).catch(() => {}); // fire-and-forget
        }
      }
      broadcastToFamily(ctx.user.familyId ?? 0, "shopping", ctx.user.id);
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
      if (ctx.user.familyRole !== "housewife") throw new TRPCError({ code: "FORBIDDEN", message: "Only housewife can approve" });
      await approveShoppingItem(input.id);
      if (ctx.user.familyId) {
        broadcastToFamily(ctx.user.familyId, "shopping", ctx.user.id);
        const tokens = await getPushTokensByFamily(ctx.user.familyId);
        sendPushNotifications(tokens, {
          title: '✅ 採購已批准',
          body: input.itemName ? `主婦已批准採購：${input.itemName}` : '主婦已批准你的採購提議',
          data: { type: 'shopping_approved' },
        }).catch(() => {});
      }
      return { success: true };
    }),

  reject: protectedProcedure
    .input(z.object({ id: z.number().int(), itemName: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.familyRole !== "housewife") throw new TRPCError({ code: "FORBIDDEN", message: "Only housewife can reject" });
      await rejectShoppingItem(input.id);
      if (ctx.user.familyId) {
        broadcastToFamily(ctx.user.familyId, "shopping", ctx.user.id);
        const tokens = await getPushTokensByFamily(ctx.user.familyId);
        sendPushNotifications(tokens, {
          title: '❌ 採購未批准',
          body: input.itemName ? `主婦未批准採購：${input.itemName}` : '主婦未批准你的採購提議',
          data: { type: 'shopping_rejected' },
        }).catch(() => {});
      }
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await deleteShoppingItem(input.id);
      if (ctx.user.familyId) broadcastToFamily(ctx.user.familyId, "shopping", ctx.user.id);
      return { success: true };
    }),

  deleteMany: protectedProcedure
    .input(z.object({ ids: z.array(z.number().int()) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.familyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      await deleteShoppingItemsByIds(input.ids, ctx.user.familyId);
      broadcastToFamily(ctx.user.familyId, "shopping", ctx.user.id);
      return { success: true };
    }),

  clearBought: protectedProcedure
    .mutation(async ({ ctx }) => {
      if (!ctx.user.familyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      await clearBoughtItems(ctx.user.familyId);
      broadcastToFamily(ctx.user.familyId, "shopping", ctx.user.id);
      return { success: true };
    }),
});

const mealPlanRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user.familyId) return [];
    return getMealPlans(ctx.user.familyId);
  }),

  listByDateRange: protectedProcedure
    .input(z.object({ startDate: z.string(), endDate: z.string() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user.familyId) return [];
      return getMealPlansByDateRange(ctx.user.familyId, input.startDate, input.endDate);
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
      if (!ctx.user.familyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      const isHelper = ctx.user.familyRole === "helper";
      const status = isHelper ? "pending" : "confirmed";
      await addMealPlan({
        familyId: ctx.user.familyId,
        date: input.date,
        mealType: input.mealType,
        recipeId: input.recipeId,
        recipeName: input.recipeName,
        recipeImage: input.recipeImage,
        status,
        proposedByUserId: ctx.user.id,
        proposedByName: ctx.user.name || (isHelper ? "Helper" : "Madam"),
        note: input.note,
      });
      if (input.autoAddIngredients && input.ingredients && input.ingredients.length > 0) {
        // Housewife's own ingredients go directly to active; helper's proposals need confirmation
        const ingredientStatus = isHelper ? "pending" as const : "active" as const;
        const rows = input.ingredients.map((ing) => ({
          familyId: ctx.user.familyId!,
          name: ing.name,
          quantity: ing.quantity,
          unit: ing.unit,
          status: ingredientStatus,
          proposedByUserId: ctx.user.id,
          proposedByName: ctx.user.name || (isHelper ? "Helper" : "Madam"),
          fromRecipeId: input.recipeId,
          fromRecipeName: input.recipeName,
          plannedDate: input.date,  // Link shopping items to the meal plan date
        }));
        await addShoppingItems(rows);
      }
      broadcastToFamily(ctx.user.familyId, "mealPlan", ctx.user.id);
      // Push notification to family members
      const mealTypeLabels: Record<string, string> = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '小食' };
      const mealLabel = mealTypeLabels[input.mealType] ?? input.mealType;
      const actorName = ctx.user.name || (isHelper ? 'Helper' : 'Madam');
      const pushTokens = await getPushTokensByFamily(ctx.user.familyId);
      if (isHelper) {
        // Notify owner when helper proposes a meal plan
        notifyOwner({
          title: `🍽️ ${actorName} 提議排餐`,
          content: `${actorName} 提議 ${input.date} ${mealLabel}：${input.recipeName}，請確認。`,
        }).catch(() => {});
        sendPushNotifications(pushTokens, {
          title: `🍽️ ${actorName} 提議排餐`,
          body: `${input.date} ${mealLabel}：${input.recipeName}（待確認）`,
          data: { type: 'meal_plan_proposed' },
        }).catch(() => {});
      } else {
        sendPushNotifications(pushTokens, {
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
      if (ctx.user.familyRole !== "housewife") throw new TRPCError({ code: "FORBIDDEN" });
      await updateMealPlanStatus(input.id, "confirmed", ctx.user.id);
      if (ctx.user.familyId) broadcastToFamily(ctx.user.familyId, "mealPlan", ctx.user.id);
      return { success: true };
    }),

  reject: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.familyRole !== "housewife") throw new TRPCError({ code: "FORBIDDEN" });
      await updateMealPlanStatus(input.id, "rejected", ctx.user.id);
      if (ctx.user.familyId) broadcastToFamily(ctx.user.familyId, "mealPlan", ctx.user.id);
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.familyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      // 先查出排餐資料，以便連動刪除購物清單
      const plan = await getMealPlanById(input.id);
      await deleteMealPlan(input.id);
      // 連動刪除由此排餐加入、且尚未購買的購物清單食材
      if (plan?.recipeId && plan?.date) {
        await deleteShoppingItemsByMealPlan(ctx.user.familyId, plan.recipeId, plan.date);
      }
      broadcastToFamily(ctx.user.familyId, "mealPlan", ctx.user.id);
      return { success: true };
    }),
});

const pantryRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user.familyId) return [];
    return getPantryItems(ctx.user.familyId);
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
      if (!ctx.user.familyId) throw new Error('No family');
      await addPantryItem({
        familyId: ctx.user.familyId,
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
      if (!ctx.user.familyId) throw new Error('No family');
      const items = input.map(i => ({
        familyId: ctx.user.familyId!,
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
      if (!ctx.user.familyId) throw new Error('No family');
      const items = input.map(i => ({
        familyId: ctx.user.familyId!,
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
      if (!ctx.user.familyId) return [];
      return getPurchaseHistory(ctx.user.familyId, input?.limit ?? 100);
    }),
  /** Get purchase frequency stats for smart restock suggestions */
  frequency: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user.familyId) return [];
    return getPurchaseFrequency(ctx.user.familyId);
  }),
  /**
   * Batch query: returns last purchase price for a list of item names.
   * Used in MarketPage to show price diff when user inputs a new price.
   */
  lastPrices: protectedProcedure
    .input(z.object({ itemNames: z.array(z.string().min(1)).max(100) }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user.familyId) return {};
      return getLastPurchasePrices(ctx.user.familyId, input.itemNames);
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
      if (!ctx.user.familyId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not in a family' });
      // Update the estimatedPrice on the shopping item
      await updateShoppingItemDetails(input.itemId, { estimatedPrice: input.price });
      // Record to purchase history for future price diff display
      await recordPurchase({
        familyId: ctx.user.familyId,
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
      if (!ctx.user.familyId) return [];
      return getRecipeNotes(ctx.user.familyId, input.recipeId);
    }),
  add: protectedProcedure
    .input(z.object({
      recipeId: z.string(),
      recipeName: z.string().optional(),
      content: z.string().min(1).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.familyId) throw new Error('No family');
      await addRecipeNote({
        familyId: ctx.user.familyId,
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
      if (!ctx.user.familyId) throw new Error('No family');
      await deleteRecipeNote(input.id, ctx.user.id, ctx.user.familyId);
      return { ok: true };
    }),
});

export const appRouter = router({
  system: systemRouter,
  aiRecipe: aiRecipeRouter,
  priceWatch: priceWatchRouter,
  recipes: recipesRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
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

        // Auto-create family kitchen
        try {
          const kitchenName = `${input.name}'s Kitchen`;
          const inviteCode = nanoid(6).toUpperCase();
          const family = await createFamily({ name: kitchenName, inviteCode, ownerId: created.id });
          if (family) {
            await addFamilyMember({ familyId: family.id, userId: created.id, familyRole: "housewife", nickname: input.name });
            await updateUserFamily(created.id, family.id, "housewife");
          }
        } catch (err) {
          console.error("[Auth] Auto-create family failed", err);
        }

        // Create session token (for React Native)
const sessionToken = await sdk.createSessionToken(created.openId, { name: input.name, expiresInMs: ONE_YEAR_MS });
// Also set cookie for web browsers
const cookieOptions = getSessionCookieOptions(ctx.req);
ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
return { success: true, token: sessionToken };


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
