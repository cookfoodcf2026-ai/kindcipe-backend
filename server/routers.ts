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
import { eatOutRouter } from "./routers/eatOut";
import { subscriptionRouter } from "./routers/subscription";
import { commonIngredientRouter } from "./routers/commonIngredient";
import { protectedProcedure, publicProcedure, adminProcedure, familyWriteProcedure, router } from "./_core/trpc";
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
  unlinkShoppingItemsFromMealPlan,
  approveShoppingItemsByMealPlan,
  getDb,
  getMealPlanById,
  deletePantryItem,
  deleteShoppingItem,
  deleteShoppingItemsByIds,
  getFamilySubscription,
  initFamilyTrial,
  incrementTrialCount,
  getImportUsage,
  countCustomRecipesCreatedThisMonth,
  getAiChatUsage,
  upsertPushToken,
  getPushTokensByFamily,
  getPushTokensByUserIds,
  getPushTokensByUser,
  getFamilyById,
  getFamilyByInviteCode,
  getFamilyMemberByUserId,
  getFamilyMembers,
  getUserFamilies,
  countFamilyMembers,
  setDefaultFamily,
  updateFamilyMemberRole,
  getFamilySettings,
  getMealPlansByDateRange,
  addMealPlanBatch,
  updateMealPlanStatus,
  removeFamilyMember,
  updateFamilySettings,
  renameFamily,
  deleteFamily,
  getFavoriteItems,
  getShoppingItemsWithRecipeInfo,
  getRecipeIngredients,
  getMealPlans,
  addShoppingItemsBatch,
  getPantryItems,
  getShoppingItems,
  rejectShoppingItem,
  toggleFavoriteItem,
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
  incrementRecipePopularity,
  getRemovedFamilyMember,
  addRemovedFamilyMember,
  addRedirectLog,
} from "./db";
import { mealPlans, shoppingItems, weeklyMenu, familyEatOut, removedFamilyMembers, families } from "../drizzle/schema";
import { and, eq, inArray, ne, or, sql } from "drizzle-orm";

const joinAttempts = new Map<string, { count: number; resetAt: number }>();

const familyRouter = router({
  get: protectedProcedure
    .input(z.object({ id: z.number().int().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const familyId = input?.id ?? ctx.activeFamilyId;
      if (!familyId) return null;
      const family = await getFamilyById(familyId);
      if (!family) return null;
      const member = await getFamilyMemberByUserId(familyId, String(ctx.user.id));
      if (!member) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "你唔係呢個廚房嘅成員",
        });
      }
      const members = await getFamilyMembers(familyId);
      const result = {
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
      return result;
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const families = await getUserFamilies(String(ctx.user.id));
    const counts = await countFamilyMembers(families.map((f) => f.family.id));
    return families.map((f) => ({
      id: f.family.id,
      name: f.family.name,
      role: f.member.familyRole,
      isDefault: f.member.isDefault,
      memberCount: counts.get(f.family.id) ?? 0,
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
      const myFamilies = await getUserFamilies(String(ctx.user.id));
      const owned = myFamilies.find((f) => f.member.familyRole === "owner");
      if (owned) {
        await setDefaultFamily(String(ctx.user.id), owned.family.id);
        await addFamilyMember({ familyId: owned.family.id, userId: String(ctx.user.id), familyRole: "owner", nickname: input.nickname || ctx.user.name || "Owner", isDefault: true });
        return { ...owned.family, role: "owner", reused: true as const };
      }

      if (myFamilies.length > 0) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "每個帳號最多建立 1 個廚房，請先離開目前廚房",
        });
      }

      const inviteCode = nanoid(6).toUpperCase();
      const family = await createFamily({ name: input.name, inviteCode, ownerId: String(ctx.user.id) });
      if (!family) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 試用防濫用：每位用戶只送 1 次試用（trialCount 0 → 1）
      const canStartTrial = (ctx.user.trialCount ?? 0) === 0;
      if (canStartTrial) {
        await initFamilyTrial(family.id);
        await incrementTrialCount(String(ctx.user.id));
      }

      await addFamilyMember({ familyId: family.id, userId: String(ctx.user.id), familyRole: "owner", nickname: input.nickname || ctx.user.name || "Owner", isDefault: false });
      await setDefaultFamily(String(ctx.user.id), family.id);
      return { ...family, role: "owner" };
    }),

  join: protectedProcedure
    .input(z.object({
      inviteCode: z.string().min(4).max(16),
      familyRole: z.enum(["helper", "member"]).default("member"),
      nickname: z.string().max(64).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const trimmedCode = input.inviteCode.trim();
      
      // Rate limit: 10 failed attempts per hour per user
      const now = Date.now();
      const attemptKey = String(ctx.user.id);
      const attempts = joinAttempts.get(attemptKey);
      if (attempts && attempts.resetAt > now && attempts.count >= 10) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "嘗試次數過多，請稍後再試" });
      }
      
      const family = await getFamilyByInviteCode(trimmedCode);
      if (!family) {
        const entry = joinAttempts.get(attemptKey) ?? { count: 0, resetAt: now + 60 * 60 * 1000 };
        entry.count = (entry.count || 0) + 1;
        entry.resetAt = now + 60 * 60 * 1000;
        joinAttempts.set(attemptKey, entry);
        throw new TRPCError({ code: "NOT_FOUND", message: "Invalid invite code" });
      }
      
      const existing = await getFamilyMemberByUserId(family.id, String(ctx.user.id));
      if (existing) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Already a member" });
      }

      const myFamilies = await getUserFamilies(String(ctx.user.id));
      if (myFamilies.length > 0) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "每個帳號只可加入 1 個廚房，請先離開目前廚房",
        });
      }

      // Banned check
      const banned = await getRemovedFamilyMember(family.id, String(ctx.user.id));
      if (banned) {
        throw new TRPCError({ code: "FORBIDDEN", message: "你已被移出此廚房，請聯絡廚房主人" });
      }
      
      const sub = await getFamilySubscription(family.id);
      const currentMembers = await getFamilyMembers(family.id);
      
      if (sub && currentMembers.length >= sub.maxMembers) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: sub.isPaid
            ? `This kitchen has reached the maximum of ${sub.maxMembers} members.`
            : "想同家人一齊plan 晚餐，即刻試用 7 日或升級可邀家人",
        });
      }
      
      await addFamilyMember({ familyId: family.id, userId: String(ctx.user.id), familyRole: input.familyRole, nickname: input.nickname || ctx.user.name || (input.familyRole === "helper" ? "Helper" : "Member") });
      
      // Success — reset rate limit counter
      joinAttempts.delete(attemptKey);
      
      return { success: true, family };
    }),

  subscription: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.activeFamilyId) return null;
    return getFamilySubscription(ctx.activeFamilyId);
  }),

  usage: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.activeFamilyId) return null;
    const familyId = ctx.activeFamilyId;
    const sub = await getFamilySubscription(familyId);
    const aiLimit = sub?.aiChatLimit ?? 30;
    return {
      imports: {
        used: await getImportUsage(familyId),
        limit: sub?.maxImportsPerMonth ?? 5,
      },
      customRecipes: {
        used: await countCustomRecipesCreatedThisMonth(familyId),
        limit: sub?.maxCustomRecipesPerMonth ?? null,
      },
      aiChat: {
        used: await getAiChatUsage(familyId),
        limit: aiLimit,
      },
    };
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
      userId: z.union([z.string(), z.number()]),
      role: z.enum(["owner", "admin", "helper", "member"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = String(input.userId);
      if (!ctx.activeFamilyId || input.familyId !== ctx.activeFamilyId) throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized for this family" });
      if (ctx.activeFamilyRole !== "owner") throw new TRPCError({ code: "FORBIDDEN", message: "Only owner can change roles" });
      
      // Prevent changing the last owner's role
      if (input.role !== "owner") {
        const members = await getFamilyMembers(input.familyId);
        const owners = members.filter(m => m.member.familyRole === "owner");
        const targetMember = members.find(m => m.member.userId === userId);
        if (targetMember && targetMember.member.familyRole === "owner" && owners.length <= 1) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Cannot change the last owner's role. Transfer ownership first." });
        }
      }
      
      await updateFamilyMemberRole(input.familyId, userId, input.role);
      return { success: true };
    }),

  removeMember: protectedProcedure
    .input(z.object({ familyId: z.number().int(), userId: z.union([z.string(), z.number()]) }))
    .mutation(async ({ ctx, input }) => {
      const userId = String(input.userId);
      if (!ctx.activeFamilyId || input.familyId !== ctx.activeFamilyId) throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized for this family" });
      if (ctx.activeFamilyRole !== "owner") throw new TRPCError({ code: "FORBIDDEN", message: "Only owner can remove members" });
      
      // Prevent owner from removing themselves
      if (userId === String(ctx.user.id)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Owner cannot remove themselves. Use leave or dissolve instead." });
      }
      
      // Prevent removing the last owner
      const members = await getFamilyMembers(input.familyId);
      const owners = members.filter(m => m.member.familyRole === "owner");
      const targetMember = members.find(m => m.member.userId === userId);
      if (targetMember && targetMember.member.familyRole === "owner" && owners.length <= 1) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot remove the last owner. Transfer ownership first." });
      }
      
      await removeFamilyMember(input.familyId, userId);
      await addRemovedFamilyMember(input.familyId, userId);
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

  regenerateInviteCode: protectedProcedure.mutation(async ({ ctx }) => {
    if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a kitchen" });
    if (ctx.activeFamilyRole !== "owner") throw new TRPCError({ code: "FORBIDDEN", message: "Only owner can regenerate invite code" });
    const newCode = nanoid(6).toUpperCase();
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    await db.update(families).set({ inviteCode: newCode }).where(eq(families.id, ctx.activeFamilyId));
    return { inviteCode: newCode };
  }),

  transferOwnership: protectedProcedure
    .input(z.object({ userId: z.union([z.string(), z.number()]) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a kitchen" });
      if (ctx.activeFamilyRole !== "owner") throw new TRPCError({ code: "FORBIDDEN", message: "Only owner can transfer ownership" });
      const targetId = String(input.userId);
      if (targetId === String(ctx.user.id)) throw new TRPCError({ code: "BAD_REQUEST", message: "Already owner" });
      const target = await getFamilyMemberByUserId(ctx.activeFamilyId, targetId);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Not a member" });
      await updateFamilyMemberRole(ctx.activeFamilyId, String(ctx.user.id), "admin");
      await updateFamilyMemberRole(ctx.activeFamilyId, targetId, "owner");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.update(families).set({ ownerId: targetId }).where(eq(families.id, ctx.activeFamilyId));
      return { success: true };
    }),
});

const shoppingRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.activeFamilyId) return [];
    return getShoppingItems(ctx.activeFamilyId);
  }),

  logRedirect: familyWriteProcedure
    .input(z.object({
      platform: z.string().max(64).nonempty(),
      keyword: z.string().max(128).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await addRedirectLog({
        familyId: ctx.activeFamilyId ?? undefined,
        userId: ctx.user.id,
        platform: input.platform,
        keyword: input.keyword,
      });
      return { success: true };
    }),

  add: familyWriteProcedure
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
      fromMealPlanId: z.number().int().optional(),
      plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      commonIngredientId: z.number().int().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      const familySettings = await getFamilySettings(ctx.activeFamilyId) as { approvalRequired?: boolean };
      const isMemberOrHelper = ctx.activeFamilyRole === "member" || ctx.activeFamilyRole === "helper";
      const needsApproval = isMemberOrHelper && (familySettings.approvalRequired !== false);
      const status = needsApproval ? "pending" : (input.status || "active");
      
      // Sanitize name: trim and truncate to 128 chars
      const sanitizedName = input.name.trim().slice(0, 128);
      
      try {
        await addShoppingItem({
          familyId: ctx.activeFamilyId!,
          name: sanitizedName,
          nameEn: input.nameEn?.slice(0, 128),
          category: input.category?.slice(0, 64),
          quantity: input.quantity?.slice(0, 64),
          unit: input.unit?.slice(0, 32),
          estimatedPrice: input.estimatedPrice,
          status,
          proposedByUserId: needsApproval ? ctx.user.id : undefined,
          proposedByName: needsApproval ? (ctx.user.name || "Member") : undefined,
          fromRecipeId: input.fromRecipeId?.slice(0, 64),
          fromRecipeName: input.fromRecipeName?.slice(0, 128),
          fromMealPlanId: input.fromMealPlanId,
          plannedDate: input.plannedDate,
          commonIngredientId: input.commonIngredientId ?? null,
        });
      } catch (err) {
        console.error("[shopping.add] Failed:", err);
        // If insert fails, try once more with minimal data
        try {
          await addShoppingItem({
            familyId: ctx.activeFamilyId!,
            name: sanitizedName || "Unnamed item",
            status,
          });
        } catch (retryErr) {
          console.error("[shopping.add] Retry also failed:", retryErr);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to add item. Please try again." });
        }
      }
      broadcastToFamily(ctx.activeFamilyId, "shopping", ctx.user.id);
      return { success: true };
    }),

  addBatch: familyWriteProcedure
    .input(z.object({
      items: z.array(z.object({
        name: z.string().min(1).max(128),
        nameEn: z.string().max(128).optional(),
        category: z.string().max(64).optional(),
        quantity: z.string().max(64).optional(),
        unit: z.string().max(32).optional(),
        commonIngredientId: z.number().int().optional(),
        fromRecipeId: z.string().max(64).optional(),
        fromRecipeName: z.string().max(128).optional(),
      })),
      fromRecipeId: z.string().max(64).optional(),
      fromRecipeName: z.string().max(128).optional(),
      fromMealPlanId: z.number().int().optional(),
      plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      const familySettings = await getFamilySettings(ctx.activeFamilyId) as { approvalRequired?: boolean };
      const isMemberOrHelper = ctx.activeFamilyRole === "member" || ctx.activeFamilyRole === "helper";
      const needsApproval = isMemberOrHelper && (familySettings.approvalRequired !== false);
      const status = needsApproval ? "pending" : "active";

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
        await updateShoppingItemDetails(u.id, ctx.activeFamilyId, { quantity: u.quantity });
      }

      if (toInsert.length > 0) {
        const rows = toInsert.map((item) => ({
          familyId: ctx.activeFamilyId!,
          name: item.name.trim().slice(0, 128),
          nameEn: item.nameEn?.slice(0, 128),
          category: item.category?.slice(0, 64),
          quantity: item.quantity?.slice(0, 64),
          unit: item.unit?.slice(0, 32),
          status: status as "pending" | "active",
          proposedByUserId: needsApproval ? ctx.user.id : undefined,
          proposedByName: needsApproval ? (ctx.user.name || "Member") : undefined,
          fromRecipeId: item.fromRecipeId ?? input.fromRecipeId?.slice(0, 64),
          fromRecipeName: item.fromRecipeName ?? input.fromRecipeName?.slice(0, 128),
          fromMealPlanId: input.fromMealPlanId,
          plannedDate: input.plannedDate,
          commonIngredientId: item.commonIngredientId ?? null,
        }));
        await addShoppingItems(rows);
      }

      if (ctx.activeFamilyId) broadcastToFamily(ctx.activeFamilyId, "shopping", ctx.user.id);
      return { success: true, count: toInsert.length + toUpdate.length, merged: toUpdate.length };
    }),

  toggleBought: familyWriteProcedure
    .input(z.object({ id: z.number().int(), bought: z.boolean(), actualPrice: z.number().int().optional() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      const status = input.bought ? "bought" : "active";
      await updateShoppingItemStatus(input.id, ctx.activeFamilyId, status, input.bought ? ctx.user.id : undefined, input.bought ? (ctx.user.name || "Someone") : undefined);
      if (input.bought) {
        const items = await getShoppingItems(ctx.activeFamilyId);
        const item = items.find(i => i.id === input.id);
        if (item) {
          recordPurchase({
            familyId: ctx.activeFamilyId!,
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
      broadcastToFamily(ctx.activeFamilyId, "shopping", ctx.user.id);
      return { success: true };
    }),
  updateItem: familyWriteProcedure
    .input(z.object({
      id: z.number().int(),
      name: z.string().min(1).max(128).optional(),
      quantity: z.string().max(64).optional(),
      unit: z.string().max(32).optional(),
      plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      await updateShoppingItemDetails(input.id, ctx.activeFamilyId, {
        name: input.name,
        quantity: input.quantity,
        unit: input.unit,
        plannedDate: input.plannedDate,
      });
      return { success: true };
    }),

  approve: familyWriteProcedure
    .input(z.object({ id: z.number().int(), itemName: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      if (!ctx.activeFamilyRole || (ctx.activeFamilyRole !== "owner" && ctx.activeFamilyRole !== "admin")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only owner/admin can approve" });
      }
      await approveShoppingItem(input.id, ctx.activeFamilyId);
      broadcastToFamily(ctx.activeFamilyId, "shopping", ctx.user.id);
      const tokens = await getPushTokensByFamily(ctx.activeFamilyId);
      sendPushNotifications(tokens, {
        title: '✅ 採購已批准',
        body: input.itemName ? `Owner已批准採購：${input.itemName}` : 'Owner已批准你的採購提議',
        data: { type: 'shopping_approved' },
      }).catch(() => {});
      return { success: true };
    }),

  reject: familyWriteProcedure
    .input(z.object({ id: z.number().int(), itemName: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      if (!ctx.activeFamilyRole || (ctx.activeFamilyRole !== "owner" && ctx.activeFamilyRole !== "admin")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only owner/admin can reject" });
      }
      await rejectShoppingItem(input.id, ctx.activeFamilyId);
      broadcastToFamily(ctx.activeFamilyId, "shopping", ctx.user.id);
      const tokens = await getPushTokensByFamily(ctx.activeFamilyId);
      sendPushNotifications(tokens, {
        title: '❌ 採購未批准',
        body: input.itemName ? `Owner未批准採購：${input.itemName}` : 'Owner未批准你的採購提議',
        data: { type: 'shopping_rejected' },
      }).catch(() => {});
      return { success: true };
    }),

  delete: familyWriteProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      await deleteShoppingItem(input.id, ctx.activeFamilyId);
      broadcastToFamily(ctx.activeFamilyId, "shopping", ctx.user.id);
      return { success: true };
    }),

  deleteMany: familyWriteProcedure
    .input(z.object({ ids: z.array(z.number().int()) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      await deleteShoppingItemsByIds(input.ids, ctx.activeFamilyId);
      if (ctx.activeFamilyId) broadcastToFamily(ctx.activeFamilyId, "shopping", ctx.user.id);
      return { success: true };
    }),

  approveAll: familyWriteProcedure
    .mutation(async ({ ctx }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      if (!ctx.activeFamilyRole || (ctx.activeFamilyRole !== "owner" && ctx.activeFamilyRole !== "admin")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only owner/admin can approve" });
      }
      const items = await getShoppingItems(ctx.activeFamilyId);
      const pendingIds = items.filter(i => i.status === "pending").map(i => i.id);
      for (const id of pendingIds) {
        await approveShoppingItem(id, ctx.activeFamilyId);
      }
      if (ctx.activeFamilyId) broadcastToFamily(ctx.activeFamilyId, "shopping", ctx.user.id);
      return { success: true, count: pendingIds.length };
    }),

  rejectAll: familyWriteProcedure
    .mutation(async ({ ctx }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      if (!ctx.activeFamilyRole || (ctx.activeFamilyRole !== "owner" && ctx.activeFamilyRole !== "admin")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only owner/admin can reject" });
      }
      const items = await getShoppingItems(ctx.activeFamilyId);
      const pendingIds = items.filter(i => i.status === "pending").map(i => i.id);
      for (const id of pendingIds) {
        await rejectShoppingItem(id, ctx.activeFamilyId);
      }
      if (ctx.activeFamilyId) broadcastToFamily(ctx.activeFamilyId, "shopping", ctx.user.id);
      return { success: true, count: pendingIds.length };
    }),

  clearBought: familyWriteProcedure
    .mutation(async ({ ctx }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      await clearBoughtItems(ctx.activeFamilyId);
      if (ctx.activeFamilyId) broadcastToFamily(ctx.activeFamilyId, "shopping", ctx.user.id);
      return { success: true };
    }),
  
  listWithRecipeInfo: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.activeFamilyId) return [];
    return getShoppingItemsWithRecipeInfo(ctx.activeFamilyId);
  }),
  
  addIngredientsForMealPlans: familyWriteProcedure
    .input(z.object({
      mealPlanIds: z.array(z.number().int()),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      }
      
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      }
      
      const mealPlanRows = await db.select()
        .from(mealPlans)
        .where(
          and(
            eq(mealPlans.familyId, ctx.activeFamilyId),
            inArray(mealPlans.id, input.mealPlanIds)
          )
        );
      
      const familySettings = await getFamilySettings(ctx.activeFamilyId) as { approvalRequired?: boolean };
      const isMember = ctx.activeFamilyRole === 'member';
      const needsApproval = isMember && (familySettings.approvalRequired !== false);
      const status = needsApproval ? 'pending' as const : 'active' as const;
      
      const ingredientsToAdd: Array<{
        familyId: number;
        name: string;
        quantity?: string;
        unit?: string;
        status: 'pending' | 'active';
        proposedByUserId: string;
        proposedByName: string;
        fromRecipeId: string;
        fromRecipeName: string;
        fromMealPlanId: number;
        plannedDate: string;
      }> = [];
      
      for (const mp of mealPlanRows) {
        const recipeId = mp.recipeId;
        const recipeName = mp.recipeName;
        const plannedDate = mp.date;
        
        const ingredients = await getRecipeIngredients(recipeId);
        
        for (const ing of ingredients) {
          ingredientsToAdd.push({
            familyId: ctx.activeFamilyId,
            name: ing.name,
            quantity: ing.quantity,
            unit: ing.unit,
            status,
            proposedByUserId: String(ctx.user.id),
            proposedByName: ctx.user.name || 'Member',
            fromRecipeId: recipeId,
            fromRecipeName: recipeName,
            fromMealPlanId: mp.id,
            plannedDate,
          });
        }
      }
      
      if (ingredientsToAdd.length > 0) {
        await addShoppingItems(ingredientsToAdd);
      }
      
      if (ctx.activeFamilyId) broadcastToFamily(ctx.activeFamilyId, "shopping", ctx.user.id);
      
      return { success: true, count: ingredientsToAdd.length };
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

  add: familyWriteProcedure
    .input(z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]).default("dinner"),
      recipeId: z.string().min(1).max(64),
      recipeName: z.string().min(1).max(128),
      recipeImage: z.string().nullable().optional(),
      note: z.string().max(256).optional(),
      autoAddIngredients: z.boolean().default(true),
      shoppingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      ingredients: z.array(z.object({
        name: z.string(),
        quantity: z.string().optional(),
        unit: z.string().optional(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      
      // Check if today has eat-out set for dinner
      let hasConflict = false;
      let warning: string | undefined;
      
      if (input.mealType === "dinner") {
        const eatOutRows = await db.select()
          .from(familyEatOut)
          .where(
            and(
              eq(familyEatOut.familyId, ctx.activeFamilyId),
              eq(familyEatOut.date, input.date),
            )
          )
          .limit(1);
        
        if (eatOutRows.length > 0) {
          hasConflict = true;
          warning = "今天已設定外出，確定要排餐嗎？";
        }
      }
      
      // Check if same recipe already exists on the same day (different meal type)
      const existingPlans = await db.select()
        .from(mealPlans)
        .where(
          and(
            eq(mealPlans.familyId, ctx.activeFamilyId),
            eq(mealPlans.date, input.date),
            eq(mealPlans.recipeId, input.recipeId)
          )
        );
      
      if (existingPlans.length > 0 && !hasConflict) {
        const mealTypeLabel = (m: string) => m === 'breakfast' ? '早餐' : m === 'lunch' ? '午餐' : m === 'dinner' ? '晚餐' : '小食';
        const currentMealLabel = mealTypeLabel(input.mealType);

        // 同一餐次重複 → 強制 reconfirm（Plan B：預設唔加，確認先加）
        const sameSlotRepeat = existingPlans.filter(
          p => p.mealType === input.mealType
        );
        if (sameSlotRepeat.length > 0) {
          hasConflict = true;
          warning = `呢個食譜已經排咗今日 [${currentMealLabel}]，如果再加會重複，確定要排多一份？`;
        } else {
          // 唔同餐次 → 亦要 reconfirm
          const sameDayDifferentMeal = existingPlans.filter(
            p => p.mealType !== input.mealType
          );
          if (sameDayDifferentMeal.length > 0) {
            hasConflict = true;
            const mealLabels = sameDayDifferentMeal.map(p => mealTypeLabel(p.mealType)).join('、');
            warning = `呢個食譜已經排咗今日 [${mealLabels}]，確定要排 [${currentMealLabel}] 嗎？`;
          }
        }
      }
      
      const familySettings = await getFamilySettings(ctx.activeFamilyId) as { approvalRequired?: boolean };
      const isMember = ctx.activeFamilyRole === "member";
      const needsApproval = isMember && (familySettings.approvalRequired !== false);
      const status = (needsApproval ? "pending" : "confirmed") as "pending" | "confirmed";
      
      // Add meal plan and get the new plan id
      const newPlanId = await addMealPlan({
        familyId: ctx.activeFamilyId!,
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
      
      // Add ingredients with fromMealPlanId linked to the new plan
      if (input.autoAddIngredients && input.ingredients && input.ingredients.length > 0 && newPlanId) {
        const ingredientStatus = needsApproval ? "pending" as const : "active" as const;
        const shoppingDate = input.shoppingDate || input.date;
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
          fromMealPlanId: newPlanId,
          plannedDate: shoppingDate,
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
      // Increment recipe popularity (+5 for meal plan addition - high intent action)
      incrementRecipePopularity(input.recipeId, 5).catch(() => {});
      return { 
        success: true, 
        status, 
        hasConflict, 
        warning, 
        newPlanId,
        existingPlanIds: existingPlans.map(p => p.id),
      };
    }),

  addBatch: familyWriteProcedure
    .input(z.object({
      items: z.array(z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]).default("dinner"),
        recipeId: z.string().min(1).max(64),
        recipeName: z.string().min(1).max(128),
        recipeImage: z.string().nullable().optional(),
        ingredients: z.array(z.object({
          name: z.string(),
          quantity: z.string().optional(),
          unit: z.string().optional(),
        })).optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      const familySettings = await getFamilySettings(ctx.activeFamilyId) as { approvalRequired?: boolean };
      const isMember = ctx.activeFamilyRole === "member";
      const needsApproval = isMember && (familySettings.approvalRequired !== false);
      const status = (needsApproval ? "pending" : "confirmed") as "pending" | "confirmed";
      
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      
      // Track successful and skipped items
      const successfulItems: Array<{
        date: string;
        mealType: string;
        recipeId: string;
        recipeName: string;
        newPlanId?: number;
      }> = [];
      const skippedDays: string[] = [];
      let skippedDueToDuplicate = false;
      
      // Process each item individually to handle conflicts and link ingredients
      for (const item of input.items) {
        // Check for eat-out conflict (dinner only)
        let hasConflict = false;
        if (item.mealType === "dinner") {
          const eatOutRows = await db.select()
            .from(familyEatOut)
            .where(
              and(
                eq(familyEatOut.familyId, ctx.activeFamilyId),
                eq(familyEatOut.date, item.date),
              )
            )
            .limit(1);
          
          if (eatOutRows.length > 0) {
            hasConflict = true;
          }
        }
        
        // Check for duplicate recipe on the same day (keep batch consistent with single add)
        if (!hasConflict) {
          const dupPlans = await db.select()
            .from(mealPlans)
            .where(
              and(
                eq(mealPlans.familyId, ctx.activeFamilyId),
                eq(mealPlans.date, item.date),
                eq(mealPlans.recipeId, item.recipeId),
              )
            )
            .limit(1);
          if (dupPlans.length > 0) {
            hasConflict = true;
            skippedDueToDuplicate = true;
          }
        }
        
        if (hasConflict) {
          skippedDays.push(item.date);
          continue; // Skip this day
        }
        
        // Insert meal plan
        const newPlanId = await addMealPlan({
          familyId: ctx.activeFamilyId!,
          date: item.date,
          mealType: item.mealType,
          recipeId: item.recipeId,
          recipeName: item.recipeName,
          recipeImage: item.recipeImage,
          status,
          proposedByUserId: ctx.user.id,
          proposedByName: ctx.user.name || (ctx.activeFamilyRole === "helper" ? "Helper" : "Member"),
        });
        
        successfulItems.push({
          date: item.date,
          mealType: item.mealType,
          recipeId: item.recipeId,
          recipeName: item.recipeName,
          newPlanId,
        });
        
        // Add ingredients with fromMealPlanId
        if (item.ingredients && item.ingredients.length > 0 && newPlanId) {
          const ingredientStatus = needsApproval ? "pending" as const : "active" as const;
          const rows = item.ingredients.map((ing) => ({
            familyId: ctx.activeFamilyId!,
            name: ing.name,
            quantity: ing.quantity,
            unit: ing.unit,
            status: ingredientStatus,
            proposedByUserId: ctx.user.id,
            proposedByName: ctx.user.name || (needsApproval ? "Member" : "Owner"),
            fromRecipeId: item.recipeId,
            fromRecipeName: item.recipeName,
            fromMealPlanId: newPlanId,
            plannedDate: item.date,
          }));
          await addShoppingItems(rows);
        }
      }
      
      // Broadcast + push notification
      if (ctx.activeFamilyId) broadcastToFamily(ctx.activeFamilyId, "mealPlan", ctx.user.id);
      
      const uniqueDays = new Set(successfulItems.map(i => i.date));
      const uniqueRecipes = new Set(successfulItems.map(i => i.recipeId));
      const actorName = ctx.user.name || 'Member';
      
      if (needsApproval) {
        const adminTokens = await getPushTokensByUserIds(
          (await getFamilyMembers(ctx.activeFamilyId))
            .filter(m => m.member.familyRole === "owner" || m.member.familyRole === "admin")
            .map(m => m.user.id)
        );
        sendPushNotifications(adminTokens, {
          title: `🍽️ ${actorName} 提議 ${uniqueDays.size} 天排餐`,
          body: `${successfulItems.length} 個餐次，${uniqueRecipes.size} 個菜式（待確認）`,
          data: { type: 'meal_plan_batch_proposed' },
        }).catch(() => {});
      } else {
        const allTokens = await getPushTokensByFamily(ctx.activeFamilyId);
        sendPushNotifications(allTokens, {
          title: `📅 已排入 ${uniqueDays.size} 天晚餐`,
          body: `${successfulItems.length} 個餐次，${uniqueRecipes.size} 個菜式`,
          data: { type: 'meal_plan_batch_updated' },
        }).catch(() => {});
      }
      
      // Increment popularity once per unique recipe
      for (const recipeId of uniqueRecipes) {
        incrementRecipePopularity(recipeId, 5).catch(() => {});
      }
      
      return { 
        success: true, 
        count: successfulItems.length,
        skippedCount: skippedDays.length,
        skippedDays,
        items: successfulItems,
        skippedDueToDuplicate,
      };
    }),

  confirm: familyWriteProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      if (!ctx.activeFamilyRole || (ctx.activeFamilyRole !== "owner" && ctx.activeFamilyRole !== "admin")) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await updateMealPlanStatus(input.id, ctx.activeFamilyId, "confirmed", ctx.user.id);
      
      // 自動 approve 該排餐相關的 pending 購物食材
      const plan = await getMealPlanById(input.id, ctx.activeFamilyId);
      if (plan?.recipeId && plan?.date) {
        await approveShoppingItemsByMealPlan(ctx.activeFamilyId, plan.id);
      }
      
      broadcastToFamily(ctx.activeFamilyId, "mealPlan", ctx.user.id);
      return { success: true };
    }),

  reject: familyWriteProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      if (!ctx.activeFamilyRole || (ctx.activeFamilyRole !== "owner" && ctx.activeFamilyRole !== "admin")) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await updateMealPlanStatus(input.id, ctx.activeFamilyId, "rejected", ctx.user.id);
      
      // 自動刪除該排餐相關的 pending 購物食材
      const plan = await getMealPlanById(input.id, ctx.activeFamilyId);
      if (plan?.id) {
        await deleteShoppingItemsByMealPlan(ctx.activeFamilyId, plan.id);
      }
      
      broadcastToFamily(ctx.activeFamilyId, "mealPlan", ctx.user.id);
      return { success: true };
    }),

  updateDate: familyWriteProcedure
    .input(z.object({
      id: z.number().int(),
      newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      moveShoppingItems: z.boolean().default(true),
      shoppingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      const plan = await getMealPlanById(input.id, ctx.activeFamilyId);
      if (!plan) throw new TRPCError({ code: "NOT_FOUND", message: "Meal plan not found" });
      
      if (plan.date === input.newDate) {
        return { success: true, warning: undefined };
      }
      
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      
      const conflict = await db.select()
        .from(mealPlans)
        .where(and(
          eq(mealPlans.familyId, ctx.activeFamilyId),
          eq(mealPlans.date, input.newDate),
          eq(mealPlans.recipeId, plan.recipeId),
          ne(mealPlans.id, input.id),
        ));
      
      let warning: string | undefined;
      if (conflict.length > 0) {
        const mealLabels = conflict.map(p => 
          p.mealType === "breakfast" ? "早餐" : 
          p.mealType === "lunch" ? "午餐" : 
          p.mealType === "dinner" ? "晚餐" : "小食"
        ).join("、");
        warning = `${input.newDate} 已有同一食譜（${mealLabels}），已成功移動`;
      }
      
      await db.update(mealPlans)
        .set({ date: input.newDate })
        .where(and(eq(mealPlans.id, input.id), eq(mealPlans.familyId, ctx.activeFamilyId)));
      
      if (input.moveShoppingItems) {
        const targetShoppingDate = input.shoppingDate || input.newDate;
        if (targetShoppingDate > input.newDate) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "購物日期不能遲過排餐日" });
        }
        await db.update(shoppingItems)
          .set({ plannedDate: targetShoppingDate })
          .where(and(
            eq(shoppingItems.familyId, ctx.activeFamilyId),
            or(
              eq(shoppingItems.fromMealPlanId, input.id),
              and(
                eq(shoppingItems.fromRecipeName, plan.recipeName),
                eq(shoppingItems.plannedDate, plan.date),
              ),
            ),
          ));
      }
      
      if (ctx.activeFamilyId) broadcastToFamily(ctx.activeFamilyId, "mealPlan", ctx.user.id);
      return { success: true, warning };
    }),

  delete: familyWriteProcedure
    .input(z.object({ 
      id: z.number().int(),
      keepRelatedItems: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      const plan = await getMealPlanById(input.id, ctx.activeFamilyId);
      if (!plan) throw new TRPCError({ code: "NOT_FOUND", message: "Meal plan not found" });
      
      if (input.keepRelatedItems) {
        await unlinkShoppingItemsFromMealPlan(ctx.activeFamilyId, plan.id);
      }
      
      await deleteMealPlan(input.id, ctx.activeFamilyId);
      
      if (!input.keepRelatedItems) {
        await deleteShoppingItemsByMealPlan(ctx.activeFamilyId, plan.id);
      }
      broadcastToFamily(ctx.activeFamilyId, "mealPlan", ctx.user.id);
      return { success: true };
    }),
});

const pantryRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.activeFamilyId) return [];
    return getPantryItems(ctx.activeFamilyId);
  }),

  add: familyWriteProcedure
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
        familyId: ctx.activeFamilyId!,
        name: input.name,
        category: input.category ?? null,
        quantity: input.quantity ?? null,
        unit: input.unit ?? null,
        expiryDate: input.expiryDate ?? null,
      });
      return { success: true };
    }),

  /** Batch import bought shopping items into pantry */
  importFromShopping: familyWriteProcedure
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

  delete: familyWriteProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      await deletePantryItem(input.id, ctx.activeFamilyId);
      return { success: true };
    }),

  /** Toggle inStock flag */
  toggleInStock: familyWriteProcedure
    .input(z.object({ id: z.number().int(), inStock: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      await updatePantryItem(input.id, ctx.activeFamilyId, { inStock: input.inStock });
      return { success: true };
    }),

  /** Toggle isLow flag */
  toggleLow: familyWriteProcedure
    .input(z.object({ id: z.number().int(), isLow: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      await updatePantryItem(input.id, ctx.activeFamilyId, { isLow: input.isLow });
      return { success: true };
    }),

  /** Add bought shopping items to pantry (one-click import) */
  addFromShopping: familyWriteProcedure
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
      await updateShoppingItemDetails(input.itemId, ctx.activeFamilyId, { estimatedPrice: input.price });
      // Record to purchase history for future price diff display
      await recordPurchase({
        familyId: ctx.activeFamilyId!,
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
      userId: z.string().optional(),
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
  add: familyWriteProcedure
    .input(z.object({
      recipeId: z.string(),
      recipeName: z.string().optional(),
      content: z.string().min(1).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new Error('No family');
      await addRecipeNote({
        familyId: ctx.activeFamilyId!,
        recipeId: input.recipeId,
        recipeName: input.recipeName,
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        content: input.content,
      });
      return { ok: true };
    }),
  delete: familyWriteProcedure
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

    // ── Admin Email Login ───────────────────────────────────────────────────
    adminLogin: publicProcedure
      .input(z.object({
        email: z.string().email(),
        password: z.string().min(1),
      }))
      .mutation(async ({ ctx, input }) => {
        const user = await getUserByEmail(input.email);
        if (!user || !user.passwordHash || user.role !== "admin") {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "管理員帳號或密碼錯誤" });
        }
        const valid = verifyPassword(input.password, user.passwordHash);
        if (!valid) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "管理員帳號或密碼錯誤" });
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
  eatOut: eatOutRouter,
  recipeNotes: recipeNotesRouter,
  commonIngredient: commonIngredientRouter,
  subscription: subscriptionRouter,
});

export type AppRouter = typeof appRouter;
