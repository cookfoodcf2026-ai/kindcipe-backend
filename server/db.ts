import { and, desc, eq, gte, lte, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  InsertUser,
  commonIngredients,
  customRecipes,
  familyEatOut,
  familyMembers,
  families,
  favoriteItems,
  importUsage,
  mealPlans,
  officialRecipes,
  pantryItems,
  purchaseHistory,
  pushTokens,
  recipeEvents,
  removedFamilyMembers,
  shoppingItems,
  users,
  weeklyMenu,
  iapTransactions,
  aiChatUsage,
  passwordResetTokens,
  type InsertCommonIngredient,
  type InsertFamily,
  type InsertFamilyMember,
  type InsertFavoriteItem,
  type InsertMealPlan,
  type InsertPantryItem,
  type InsertRecipeEvent,
  type InsertRedirectLog,
  type InsertShoppingItem,
  type InsertIapTransaction,
  type InsertPasswordResetToken,
  redirectLogs,
  recipeNotes,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _pgClient: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      if (!_pgClient) {
        // 使用連接池優化（max: 10 個連接，減少連接建立延遲）
        _pgClient = postgres(process.env.DATABASE_URL, {
          max: 10,
          idle_timeout: 20,
          connect_timeout: 5,
        });
      }
      _db = drizzle(_pgClient);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Users ────────────────────────────────────────────────────────────────────
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.passwordVersion !== undefined) { values.passwordVersion = user.passwordVersion; updateSet.passwordVersion = user.passwordVersion; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (user.openId === ENV.ownerOpenId) { values.role = "admin"; updateSet.role = "admin"; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onConflictDoUpdate({ target: users.openId, set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

// ─── Password Reset Tokens ───────────────────────────────────────────────────
function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createPasswordResetToken(params: {
  userId: string;
  email: string;
  expiresAt: Date;
}): Promise<{ token: string; tokenHash: string }> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashResetToken(token);

  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, params.userId));
  const values: InsertPasswordResetToken = {
    userId: params.userId,
    email: params.email.toLowerCase(),
    tokenHash,
    expiresAt: params.expiresAt,
  };
  await db.insert(passwordResetTokens).values(values);
  return { token, tokenHash };
}

export async function getPasswordResetTokenByToken(token: string) {
  const db = await getDb();
  if (!db) return null;
  const tokenHash = hashResetToken(token);
  const rows = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, tokenHash)).limit(1);
  return rows[0] ?? null;
}

export async function consumePasswordResetToken(tokenHash: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.tokenHash, tokenHash));
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(id: string | number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq((users.id as any), String(id))).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Family Members (multi-kitchen helpers) ──────────────────────────────────

export async function getUserFamilies(userId: string | number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ family: families, member: familyMembers })
    .from(familyMembers)
    .innerJoin(families, eq(familyMembers.familyId, families.id))
    .where(eq(familyMembers.userId, String(userId)));
}

export async function countFamilyMembers(familyIds: number[]) {
  const db = await getDb();
  if (!db || familyIds.length === 0) return new Map<number, number>();
  const rows = await db
    .select({ familyId: familyMembers.familyId, count: sql<number>`count(*)::int` })
    .from(familyMembers)
    .where(inArray(familyMembers.familyId, familyIds))
    .groupBy(familyMembers.familyId);
  return new Map(rows.map((r) => [r.familyId, r.count]));
}

export async function getUserDefaultFamily(userId: string | number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select({ family: families, member: familyMembers })
    .from(familyMembers)
    .innerJoin(families, eq(familyMembers.familyId, families.id))
    .where(and(eq(familyMembers.userId, String(userId)), eq(familyMembers.isDefault, true)))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/**
 * Set the user's default family atomically.
 * Single UPDATE statement: isDefault = (family_id = target) — kills the
 * clear-then-set interleave window where two concurrent calls could leave
 * a user with 0 or 2 defaults.
 */
export async function setDefaultFamily(userId: string | number, familyId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(familyMembers)
    .set({ isDefault: sql`${familyMembers.familyId} = ${familyId}` })
    .where(eq(familyMembers.userId, String(userId)));
}

export async function updateFamilyMemberRole(familyId: number, userId: string | number, role: "owner" | "admin" | "helper" | "member") {
  const db = await getDb();
  if (!db) return;
  await db.update(familyMembers).set({ familyRole: role })
    .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, String(userId))));
}

export async function removeFamilyMember(familyId: number, userId: string | number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(familyMembers)
    .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, String(userId))));
}

export async function getFamilyAdmins(familyId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(familyMembers)
    .where(and(
      eq(familyMembers.familyId, familyId),
      inArray(familyMembers.familyRole, ["owner", "admin"])
    ));
}

export async function getFamilySettings(familyId: number) {
  const family = await getFamilyById(familyId);
  return family?.settings ?? { approvalRequired: false };
}

export async function updateFamilySettings(familyId: number, settings: Record<string, unknown>) {
  const db = await getDb();
  if (!db) return;
  await db.update(families).set({ settings }).where(eq(families.id, familyId));
}

export async function renameFamily(familyId: number, newName: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(families).set({ name: newName }).where(eq(families.id, familyId));
}

export async function deleteFamily(familyId: number) {
  const db = await getDb();
  if (!db) return;
  await db.transaction(async (tx) => {
    await tx.delete(shoppingItems).where(eq(shoppingItems.familyId, familyId));
    await tx.delete(pantryItems).where(eq(pantryItems.familyId, familyId));
    await tx.delete(mealPlans).where(eq(mealPlans.familyId, familyId));
    await tx.delete(purchaseHistory).where(eq(purchaseHistory.familyId, familyId));
    await tx.delete(pushTokens).where(eq(pushTokens.familyId, familyId));
    await tx.delete(customRecipes).where(eq(customRecipes.familyId, familyId));
    await tx.delete(recipeNotes).where(eq(recipeNotes.familyId, familyId));
    await tx.delete(familyEatOut).where(eq(familyEatOut.familyId, familyId));
    await tx.delete(removedFamilyMembers).where(eq(removedFamilyMembers.familyId, familyId));
    await tx.delete(recipeEvents).where(eq(recipeEvents.familyId, familyId));
    await tx.delete(favoriteItems).where(eq(favoriteItems.familyId, familyId));
    await tx.delete(importUsage).where(eq(importUsage.familyId, familyId));
    await tx.delete(aiChatUsage).where(eq(aiChatUsage.familyId, familyId));
    await tx.delete(familyMembers).where(eq(familyMembers.familyId, familyId));
    await tx.delete(families).where(eq(families.id, familyId));
  });
}

// ─── Families ─────────────────────────────────────────────────────────────────
export async function createFamily(data: InsertFamily) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(families).values(data);
  const result = await db.select().from(families).where(eq(families.inviteCode, data.inviteCode)).limit(1);
  return result[0];
}

export async function getFamilyById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(families).where(eq(families.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getFamilyByInviteCode(code: string) {
  const db = await getDb();
  if (!db) return undefined;
  const trimmedCode = code.trim().toUpperCase();
  if (!trimmedCode) return undefined;
  const result = await db.select().from(families).where(eq(families.inviteCode, trimmedCode)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Family Members ───────────────────────────────────────────────────────────

/**
 * Count how many kitchens a user created (ownerId).
 */
export async function countKitchensByOwner(userId: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select({ count: sql<number>`count(*)::int` }).from(families).where(eq(families.ownerId, userId));
  return rows[0]?.count ?? 0;
}

/**
 * Increment the user's trial usage counter (1 trial per user anti-abuse).
 */
export async function incrementTrialCount(userId: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ trialCount: sql`${users.trialCount} + 1` }).where(eq(users.id, userId));
}

export async function addFamilyMember(data: InsertFamilyMember) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(familyMembers).values(data)
    .onConflictDoNothing({ target: [familyMembers.familyId, familyMembers.userId] });
}

export async function addRemovedFamilyMember(familyId: number, userId: string) {
  const db = await getDb();
  if (!db) return;
  await db.insert(removedFamilyMembers).values({ familyId, userId })
    .onConflictDoNothing({ target: [removedFamilyMembers.familyId, removedFamilyMembers.userId] });
}

export async function getRemovedFamilyMember(familyId: number, userId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(removedFamilyMembers)
    .where(and(eq(removedFamilyMembers.familyId, familyId), eq(removedFamilyMembers.userId, userId)))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getFamilyMembers(familyId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ member: familyMembers, user: users })
    .from(familyMembers)
    .innerJoin(users, eq(familyMembers.userId, sql`${users.id}::text`))
    .where(eq(familyMembers.familyId, familyId));
}

export async function getFamilyMemberByUserId(familyId: number, userId: string | number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(familyMembers)
    .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, String(userId))))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Shopping Items ───────────────────────────────────────────────────────────
export async function getShoppingItems(familyId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(shoppingItems).where(eq(shoppingItems.familyId, familyId));
}

export async function addShoppingItem(data: InsertShoppingItem) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(shoppingItems).values(data);
}

export async function addShoppingItems(items: InsertShoppingItem[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (items.length === 0) return;
  await db.insert(shoppingItems).values(items);
}

export async function updateShoppingItemStatus(
  id: number,
  familyId: number,
  status: "pending" | "active" | "bought",
  boughtByUserId?: string,
  boughtByName?: string
) {
  const db = await getDb();
  if (!db) return;
  await db.update(shoppingItems).set({
    status,
    boughtByUserId: boughtByUserId ?? null,
    boughtByName: boughtByName ?? null,
    boughtAt: status === "bought" ? new Date() : null,
  }).where(and(eq(shoppingItems.id, id), eq(shoppingItems.familyId, familyId)));
}

export async function updateShoppingItemDetails(
  id: number,
  familyId: number,
  updates: { name?: string; quantity?: string; unit?: string; estimatedPrice?: number; plannedDate?: string }
) {
  const db = await getDb();
  if (!db) return;
  const set: Record<string, unknown> = {};
  if (updates.name !== undefined) set.name = updates.name;
  if (updates.quantity !== undefined) set.quantity = updates.quantity;
  if (updates.unit !== undefined) set.unit = updates.unit;
  if (updates.estimatedPrice !== undefined) set.estimatedPrice = updates.estimatedPrice;
  if (updates.plannedDate !== undefined) set.plannedDate = updates.plannedDate;
  if (Object.keys(set).length === 0) return;
  await db.update(shoppingItems).set(set).where(and(eq(shoppingItems.id, id), eq(shoppingItems.familyId, familyId)));
}
export async function approveShoppingItem(id: number, familyId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(shoppingItems).set({ status: "active" }).where(and(eq(shoppingItems.id, id), eq(shoppingItems.familyId, familyId)));
}

export async function rejectShoppingItem(id: number, familyId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(shoppingItems).where(and(eq(shoppingItems.id, id), eq(shoppingItems.familyId, familyId)));
}

export async function deleteShoppingItem(id: number, familyId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(shoppingItems).where(and(eq(shoppingItems.id, id), eq(shoppingItems.familyId, familyId)));
}

/**
 * Solo 用戶專用：更新購物車物品狀態（不需要 familyId）
 */
export async function updateShoppingItemStatusSolo(
  id: number,
  userId: string,
  status: "pending" | "active" | "bought",
  boughtByName?: string
) {
  const db = await getDb();
  if (!db) return;
  await db.update(shoppingItems).set({
    status,
    boughtByUserId: boughtByName ? userId : null,
    boughtByName: boughtByName ?? null,
    boughtAt: status === "bought" ? new Date() : null,
  }).where(and(
    eq(shoppingItems.id, id),
    eq(shoppingItems.proposedByUserId, userId)
  ));
}

/**
 * Solo 用戶專用：更新購物車物品詳情（不需要 familyId）
 */
export async function updateShoppingItemDetailsSolo(
  id: number,
  userId: string,
  updates: { name?: string; quantity?: string; unit?: string; estimatedPrice?: number; plannedDate?: string }
) {
  const db = await getDb();
  if (!db) return;
  const set: Record<string, unknown> = {};
  if (updates.name !== undefined) set.name = updates.name;
  if (updates.quantity !== undefined) set.quantity = updates.quantity;
  if (updates.unit !== undefined) set.unit = updates.unit;
  if (updates.estimatedPrice !== undefined) set.estimatedPrice = updates.estimatedPrice;
  if (updates.plannedDate !== undefined) set.plannedDate = updates.plannedDate;
  if (Object.keys(set).length === 0) return;
  await db.update(shoppingItems).set(set).where(and(
    eq(shoppingItems.id, id),
    eq(shoppingItems.proposedByUserId, userId)
  ));
}

/**
 * Solo 用戶專用：獲取購物車物品（不需要 familyId）
 */
export async function getShoppingItemsSolo(userId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(shoppingItems)
    .where(eq(shoppingItems.proposedByUserId, userId))
    .orderBy(desc(shoppingItems.createdAt));
}

export async function clearBoughtItems(familyId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(shoppingItems).where(
    and(eq(shoppingItems.familyId, familyId), eq(shoppingItems.status, "bought"))
  );
}

export async function deleteShoppingItemsByIds(ids: number[], familyId: number) {
  const db = await getDb();
  if (!db) return;
  if (ids.length === 0) return;
  await db.delete(shoppingItems).where(
    and(inArray(shoppingItems.id, ids), eq(shoppingItems.familyId, familyId))
  );
}

// ─── Meal Plans ───────────────────────────────────────────────────────────────
export async function getMealPlans(familyId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(mealPlans).where(eq(mealPlans.familyId, familyId));
}

export async function getMealPlansByDateRange(familyId: number, startDate: string, endDate: string) {
  const db = await getDb();
  if (!db) return [];
  
  const plans = await db.select({
    id: mealPlans.id,
    familyId: mealPlans.familyId,
    date: mealPlans.date,
    mealType: mealPlans.mealType,
    recipeId: mealPlans.recipeId,
    recipeName: mealPlans.recipeName,
    recipeImage: mealPlans.recipeImage,
    status: mealPlans.status,
    proposedByUserId: mealPlans.proposedByUserId,
    proposedByName: mealPlans.proposedByName,
    note: mealPlans.note,
    createdAt: mealPlans.createdAt,
    updatedAt: mealPlans.updatedAt,
    hasShoppingItem: sql<boolean>`EXISTS(
      SELECT 1 FROM shopping_items 
      WHERE shopping_items.from_meal_plan_id = meal_plans.id
    )`
  }).from(mealPlans).where(
    and(
      eq(mealPlans.familyId, familyId),
      gte(mealPlans.date, startDate),
      lte(mealPlans.date, endDate)
    )
  ).orderBy(mealPlans.date, mealPlans.mealType);
  
  return plans;
}

export async function addMealPlan(data: InsertMealPlan) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(mealPlans).values(data).returning({ id: mealPlans.id });
  return result[0]?.id ?? undefined;
}

export async function addMealPlanBatch(data: InsertMealPlan[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (data.length === 0) return;
  await db.insert(mealPlans).values(data);
}

export async function addShoppingItemsBatch(items: InsertShoppingItem[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (items.length === 0) return;
  await db.insert(shoppingItems).values(items);
}

export async function getPendingMealPlans() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(mealPlans)
    .where(eq(mealPlans.status, "pending"));
}

export async function getPendingMealPlansCount(familyId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(mealPlans)
    .where(and(eq(mealPlans.familyId, familyId), eq(mealPlans.status, "pending")));
  return result[0]?.count ?? 0;
}

export async function updateMealPlanStatus(
  id: number,
  familyId: number,
  status: "pending" | "confirmed" | "rejected",
  confirmedByUserId?: string
) {
  const db = await getDb();
  if (!db) return;
  await db.update(mealPlans).set({
    status,
    confirmedByUserId: confirmedByUserId ?? null,
    confirmedAt: status === "confirmed" ? new Date() : null,
  }).where(and(eq(mealPlans.id, id), eq(mealPlans.familyId, familyId)));
}

export async function getMealPlanById(id: number, familyId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(mealPlans).where(and(eq(mealPlans.id, id), eq(mealPlans.familyId, familyId))).limit(1);
  return rows[0] ?? null;
}

export async function deleteMealPlan(id: number, familyId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(mealPlans).where(and(eq(mealPlans.id, id), eq(mealPlans.familyId, familyId)));
}

// 將購物清單項目同 meal plan 斷開 link（唔刪除）
export async function unlinkShoppingItemsFromMealPlan(
  familyId: number,
  mealPlanId: number
) {
  const db = await getDb();
  if (!db) return;
  await db.update(shoppingItems)
    .set({ fromMealPlanId: null })
    .where(and(
      eq(shoppingItems.familyId, familyId),
      eq(shoppingItems.fromMealPlanId, mealPlanId)
    ));
}

// 刪除由某排餐（mealPlanId）加入、且尚未購買的購物清單項目
export async function deleteShoppingItemsByMealPlan(
  familyId: number,
  mealPlanId: number
) {
  const db = await getDb();
  if (!db) return;
  await db.delete(shoppingItems).where(
    and(
      eq(shoppingItems.familyId, familyId),
      eq(shoppingItems.fromMealPlanId, mealPlanId),
      inArray(shoppingItems.status, ["active", "pending"])
    )
  );
}

// 將某排餐相關的 pending 購物食材自動改為 active
export async function approveShoppingItemsByMealPlan(
  familyId: number,
  mealPlanId: number
) {
  const db = await getDb();
  if (!db) return;
  await db.update(shoppingItems).set({ status: "active" }).where(
    and(
      eq(shoppingItems.familyId, familyId),
      eq(shoppingItems.fromMealPlanId, mealPlanId),
      eq(shoppingItems.status, "pending")
    )
  );
}

// 獲取購物清單項目，按食譜分組，並包含所有相關排餐資訊
export async function getShoppingItemsWithRecipeInfo(familyId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const shoppingRows = await db.select()
    .from(shoppingItems)
    .where(eq(shoppingItems.familyId, familyId))
    .orderBy(shoppingItems.status, shoppingItems.name);
  
  const recipeMap = new Map<string, {
    recipeId: string;
    recipeName: string;
    mealPlans: Array<{
      date: string;
      mealType: string;
      mealPlanId: number;
      hasShoppingItem: boolean;
    }>;
    shoppingItems: any[];
  }>();
  
  for (const item of shoppingRows) {
    if (!item.fromRecipeId) continue;
    
    const key = item.fromRecipeId;
    if (!recipeMap.has(key)) {
      recipeMap.set(key, {
        recipeId: item.fromRecipeId,
        recipeName: item.fromRecipeName || '',
        mealPlans: [],
        shoppingItems: [],
      });
    }
    
    const recipe = recipeMap.get(key)!;
    recipe.shoppingItems.push(item);
  }
  
  for (const [key, recipe] of recipeMap) {
    const mealPlanRows = await db.select()
      .from(mealPlans)
      .where(
        and(
          eq(mealPlans.familyId, familyId),
          eq(mealPlans.recipeId, recipe.recipeId)
        )
      );

    for (const mp of mealPlanRows) {
      const hasShoppingItem = recipe.shoppingItems.some(
        si => si.fromMealPlanId === mp.id
      );
      
      recipe.mealPlans.push({
        date: mp.date,
        mealType: mp.mealType,
        mealPlanId: mp.id,
        hasShoppingItem,
      });
    }
    
    recipe.mealPlans.sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      
      const mealOrder: Record<string, number> = { breakfast: 1, lunch: 2, dinner: 3, snack: 4 };
      return mealOrder[a.mealType] - mealOrder[b.mealType];
    });
  }
  
  return Array.from(recipeMap.values());
}

// 獲取食譜嘅食材列表
export async function getRecipeIngredients(recipeId: string) {
  const db = await getDb();
  if (!db) return [];
  
  // 嘗試從 official_recipes 獲取
  let recipeData: any = null;
  
  const officialRecipe = await db.select()
    .from(officialRecipes)
    .where(eq(officialRecipes.id, parseInt(recipeId.replace('official_', ''))))
    .limit(1);
  
  if (officialRecipe.length > 0) {
    recipeData = officialRecipe[0];
  } else {
    // 嘗試從 custom_recipes 獲取
    const customRecipe = await db.select()
      .from(customRecipes)
      .where(eq(customRecipes.id, parseInt(recipeId.replace('user_', ''))))
      .limit(1);
    
    if (customRecipe.length > 0) {
      recipeData = customRecipe[0];
    }
  }
  
  if (!recipeData || !recipeData.ingredients) {
    return [];
  }
  
  try {
    const ingredients = JSON.parse(recipeData.ingredients);
    if (Array.isArray(ingredients)) {
      return ingredients.map((ing: any) => ({
        name: ing.name || ing,
        quantity: ing.quantity || '',
        unit: ing.unit || '',
      }));
    }
  } catch (e) {
    console.error("[getRecipeIngredients] Failed to parse ingredients:", e);
  }
  
  return [];
}

// ─── Pantry Items ─────────────────────────────────────────────────────────────
export async function getPantryItems(familyId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(pantryItems).where(eq(pantryItems.familyId, familyId));
}

export async function addPantryItem(item: InsertPantryItem) {
  const db = await getDb();
  if (!db) return;
  await db.insert(pantryItems).values(item);
}

export async function addPantryItems(items: InsertPantryItem[]) {
  if (!items.length) return;
  const db = await getDb();
  if (!db) return;
  await db.insert(pantryItems).values(items);
}

export async function deletePantryItem(id: number, familyId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(pantryItems).where(and(eq(pantryItems.id, id), eq(pantryItems.familyId, familyId)));
}

export async function updatePantryItem(id: number, familyId: number, updates: { isLow?: boolean; inStock?: boolean; quantity?: string }) {
  const db = await getDb();
  if (!db) return;
  await db.update(pantryItems).set(updates).where(and(eq(pantryItems.id, id), eq(pantryItems.familyId, familyId)));
}

// ─── Favorite Items ───────────────────────────────────────────────────────────
export async function getFavoriteItems(userId: string) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(favoriteItems)
    .where(eq(favoriteItems.userId, userId))
    .orderBy(favoriteItems.sortOrder, favoriteItems.createdAt);
}

/** Toggle: add if not exists, remove if exists. Returns { isFavorited: boolean } */
export async function toggleFavoriteItem(
  userId: string,
  item: { name: string; category?: string | null; unit?: string | null }
): Promise<{ isFavorited: boolean }> {
  const db = await getDb();
  if (!db) return { isFavorited: false };
  const existing = await db
    .select()
    .from(favoriteItems)
    .where(and(eq(favoriteItems.userId, userId), eq(favoriteItems.name, item.name)))
    .limit(1);
  if (existing.length > 0) {
    await db.delete(favoriteItems).where(eq(favoriteItems.id, existing[0].id));
    return { isFavorited: false };
  }
  // Find max sortOrder for this user
  const all = await db.select({ s: favoriteItems.sortOrder }).from(favoriteItems).where(eq(favoriteItems.userId, userId));
  const maxSort = all.reduce((m, r) => Math.max(m, r.s ?? 0), 0);
  const newItem: InsertFavoriteItem = {
    userId,
    name: item.name,
    category: item.category ?? null,
    unit: item.unit ?? null,
    sortOrder: maxSort + 1,
  };
  await db.insert(favoriteItems).values(newItem);
  return { isFavorited: true };
}

// ─── Custom Recipes ───────────────────────────────────────────────────────────
export async function getCustomRecipes(familyId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(customRecipes).where(eq(customRecipes.familyId, familyId));
}

/**
 * Count custom recipes created by a family in the current calendar month.
 */
export async function countCustomRecipesCreatedThisMonth(familyId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const ym = new Date().toISOString().slice(0, 7); // "2026-08"
  const rows = await db.select({ count: sql<number>`count(*)::int` })
    .from(customRecipes)
    .where(and(eq(customRecipes.familyId, familyId), sql`to_char(${customRecipes.createdAt}, 'YYYY-MM') = ${ym}`));
  return rows[0]?.count ?? 0;
}

// ─── Recipe Events (analytics / ranking) ─────────────────────────────────────

/** Record a single recipe interaction event (fire-and-forget, never throws). */
export async function insertRecipeEvent(data: InsertRecipeEvent): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(recipeEvents).values(data);
  } catch (err) {
    // Non-critical: silently swallow errors so UI is never blocked
    console.warn('[RecipeEvents] insert failed:', err);
  }
}

/**
 * Return top N recipes by weighted score over the last `days` days.
 * Score = view*1 + plan*5 + save*3 + cook*4
 * Returns array of { recipeId, recipeName, score, planCount, viewCount }
 */
export async function getTrendingRecipes(days = 7, limit = 20) {
  try {
    const db = await getDb();
    if (!db) return [];
    const since = new Date();
    since.setDate(since.getDate() - days);
    const rows = await db
      .select({
        recipeId: recipeEvents.recipeId,
        recipeName: recipeEvents.recipeName,
        eventType: recipeEvents.eventType,
      })
      .from(recipeEvents)
      .where(gte(recipeEvents.createdAt, since));

    // Aggregate in JS (simpler than raw SQL for cross-db compat)
    const map = new Map<string, { recipeName: string; view: number; plan: number; save: number; cook: number }>();
    for (const row of rows) {
      const entry = map.get(row.recipeId) ?? { recipeName: row.recipeName, view: 0, plan: 0, save: 0, cook: 0 };
      entry[row.eventType as 'view' | 'plan' | 'save' | 'cook']++;
      map.set(row.recipeId, entry);
    }
    const results = Array.from(map.entries()).map(([recipeId, e]) => ({
      recipeId,
      recipeName: e.recipeName,
      score: e.view * 1 + e.plan * 5 + e.save * 3 + e.cook * 4,
      planCount: e.plan,
      viewCount: e.view,
    }));
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  } catch (err) {
    console.warn('[RecipeEvents] getTrending failed:', err);
    return [];
  }
}

// ─── Purchase History ─────────────────────────────────────────────────────────
export async function recordPurchase(data: {
  familyId: number;
  userId: string;
  userName?: string;
  name: string;
  category?: string;
  unit?: string;
  quantity?: string;
  shoppingItemId?: number;
  actualPrice?: number;
}): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(purchaseHistory).values({
      familyId: data.familyId,
      userId: data.userId,
      userName: data.userName ?? null,
      name: data.name,
      category: data.category ?? null,
      unit: data.unit ?? null,
      quantity: data.quantity ?? null,
      shoppingItemId: data.shoppingItemId ?? null,
      actualPrice: data.actualPrice ?? null,
    });
    // Also update lastPrice on the shoppingItem if actualPrice provided
    if (data.shoppingItemId && data.actualPrice) {
      await db.update(shoppingItems)
        .set({ lastPrice: data.actualPrice })
        .where(eq(shoppingItems.id, data.shoppingItemId));
    }
  } catch (err) {
    console.warn('[PurchaseHistory] insert failed:', err);
  }
}

export async function getPurchaseHistory(familyId: number, limit = 200) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(purchaseHistory)
    .where(eq(purchaseHistory.familyId, familyId))
    .orderBy(desc(purchaseHistory.boughtAt))
    .limit(limit);
}

/**
 * Update an existing purchase history record (price/quantity).
 */
export async function updatePurchaseHistory(
  id: number,
  data: { actualPrice?: number; quantity?: string }
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(purchaseHistory)
    .set({
      actualPrice: data.actualPrice ?? null,
      quantity: data.quantity ?? null,
    })
    .where(eq(purchaseHistory.id, id));
}

/**
 * Returns the last actual purchase price for a single item name within a family.
 * Used to show price diff when user inputs a new price.
 */
export async function getLastPurchasePrice(
  familyId: number,
  itemName: string
): Promise<{ price: number; boughtAt: Date } | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ actualPrice: purchaseHistory.actualPrice, boughtAt: purchaseHistory.boughtAt })
    .from(purchaseHistory)
    .where(
      and(
        eq(purchaseHistory.familyId, familyId),
        eq(purchaseHistory.name, itemName)
      )
    )
    .orderBy(desc(purchaseHistory.boughtAt))
    .limit(1);
  if (rows.length === 0 || rows[0].actualPrice === null) return null;
  return { price: rows[0].actualPrice, boughtAt: rows[0].boughtAt };
}

/**
 * Batch version: returns last purchase price for multiple item names.
 * Returns a map of itemName -> { price, boughtAt }
 */
export async function getLastPurchasePrices(
  familyId: number,
  itemNames: string[]
): Promise<Record<string, { price: number; boughtAt: Date }>> {
  if (itemNames.length === 0) return {};
  const db = await getDb();
  if (!db) return {};
  const rows = await db
    .select({ name: purchaseHistory.name, actualPrice: purchaseHistory.actualPrice, boughtAt: purchaseHistory.boughtAt })
    .from(purchaseHistory)
    .where(
      and(
        eq(purchaseHistory.familyId, familyId),
        inArray(purchaseHistory.name, itemNames)
      )
    )
    .orderBy(desc(purchaseHistory.boughtAt));

  // Keep only the most recent entry per item name
  const result: Record<string, { price: number; boughtAt: Date }> = {};
  for (const row of rows) {
    if (!result[row.name] && row.actualPrice !== null) {
      result[row.name] = { price: row.actualPrice, boughtAt: row.boughtAt };
    }
  }
  return result;
}

/** Returns items grouped by name with purchase count and last bought date */
export async function getPurchaseFrequency(familyId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(purchaseHistory)
    .where(eq(purchaseHistory.familyId, familyId))
    .orderBy(desc(purchaseHistory.boughtAt));

  // Aggregate in JS: group by name
  const map = new Map<string, {
    name: string;
    category: string | null;
    unit: string | null;
    count: number;
    lastBoughtAt: Date;
    firstBoughtAt: Date;
  }>();

  for (const row of rows) {
    const key = row.name;
    const existing = map.get(key);
    if (existing) {
      existing.count++;
      if (row.boughtAt < existing.firstBoughtAt) existing.firstBoughtAt = row.boughtAt;
    } else {
      map.set(key, {
        name: row.name,
        category: row.category,
        unit: row.unit,
        count: 1,
        lastBoughtAt: row.boughtAt,
        firstBoughtAt: row.boughtAt,
      });
    }
  }

  return Array.from(map.values())
    .sort((a, b) => b.count - a.count);
}

export async function insertCustomRecipe(data: {
  familyId: number;
  createdByUserId: string;
  name: string;
  description?: string;
  image?: string;
  thumbnailUrl?: string;
  cookTime?: number;
  servings?: number;
  difficulty?: string;
  recipeCategory?: string;
  ingredients?: string;
  steps?: string;
  tags?: string;
  sourceType?: "instagram" | "youtube" | "xiaohongshu" | "threads" | "manual";
  sourceUrl?: string;
  sourceUrlHash?: string;
  sourceAuthor?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const [row] = await db.insert(customRecipes).values({
    ...data,
    visibility: "private",
  }).returning();
  return row;
}

export async function updateCustomRecipeById(
  id: number,
  familyId: number,
  data: Partial<{
    name: string;
    description: string;
    image: string;
    cookTime: number;
    servings: number;
    difficulty: string;
    recipeCategory: string;
    ingredients: string;
    steps: string;
    tags: string;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(customRecipes).set(data).where(
    and(eq(customRecipes.id, id), eq(customRecipes.familyId, familyId))
  );
  const [row] = await db.select().from(customRecipes).where(eq(customRecipes.id, id));
  return row;
}

export async function deleteCustomRecipeById(id: number, familyId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(customRecipes).where(
    and(eq(customRecipes.id, id), eq(customRecipes.familyId, familyId))
  );
}

// ─── Recipe Notes ─────────────────────────────────────────────────────────────
export async function getRecipeNotes(familyId: number, recipeId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(recipeNotes)
    .where(and(eq(recipeNotes.familyId, familyId), eq(recipeNotes.recipeId, recipeId)))
    .orderBy(recipeNotes.createdAt);
}

export async function addRecipeNote(data: {
  familyId: number;
  recipeId: string;
  recipeName?: string;
  userId: string;
  userName?: string;
  content: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(recipeNotes).values({
    familyId: data.familyId,
    recipeId: data.recipeId,
    recipeName: data.recipeName ?? null,
    userId: data.userId,
    userName: data.userName ?? null,
    content: data.content,
  });
}

export async function deleteRecipeNote(id: number, userId: string, familyId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(recipeNotes).where(
    and(
      eq(recipeNotes.id, id),
      eq(recipeNotes.familyId, familyId),
      eq(recipeNotes.userId, userId)
    )
  );
}

// ─── Subscription helpers ─────────────────────────────────────────────────────

/**
 * Get the effective subscription status of a family.
 * Automatically transitions "trial" → "free" if trial has expired.
 */
export async function getFamilySubscription(familyId: number) {
  const family = await getFamilyById(familyId);
  if (!family) return null;

  let status = family.subscriptionStatus;
  const now = new Date();

  // Auto-expire trial
  if (status === "trial" && family.trialEndsAt && family.trialEndsAt < now) {
    status = "free";
    const db = await getDb();
    if (db) {
      await db.update(families)
        .set({ subscriptionStatus: "free", maxMembers: 1 })
        .where(eq(families.id, familyId));
    }
  }

  // Auto-expire paid subscription
  if (status === "active" && family.subscriptionExpiresAt && family.subscriptionExpiresAt < now) {
    status = "expired";
    const db = await getDb();
    if (db) {
      await db.update(families)
        .set({ subscriptionStatus: "expired", maxMembers: 1 })
        .where(eq(families.id, familyId));
    }
  }

  const isPaid = status === "active" || status === "trial";
  const memberCount = (await countFamilyMembers([familyId])).get(familyId) ?? 0;
  return {
    status,
    isPaid,
    maxMembers: isPaid ? 6 : 1,
    maxImportsPerMonth: isPaid ? 200 : 5,
    maxCustomRecipesPerMonth: isPaid ? null : 20,
    aiChatLimit: isPaid ? 200 : 30,
    sharedLocked: !isPaid && memberCount > 1,
    trialEndsAt: family.trialEndsAt,
    subscriptionExpiresAt: family.subscriptionExpiresAt,
    subscriptionPlan: family.subscriptionPlan,
  };
}

/**
 * Set trial end date when a family is first created (trialStartedAt + 7 days).
 */
export async function initFamilyTrial(familyId: number) {
  const db = await getDb();
  if (!db) return;
  const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.update(families)
    .set({ trialEndsAt, subscriptionStatus: "trial", maxMembers: 6 })
    .where(eq(families.id, familyId));
}

/**
 * Activate (or renew) a family's paid subscription. Never deletes anything.
 */
export async function activateFamilySubscription(familyId: number, plan: "monthly" | "yearly", expiresAt: Date) {
  const db = await getDb();
  if (!db) return;
  await db.update(families)
    .set({
      subscriptionStatus: "active",
      subscriptionPlan: plan,
      subscriptionExpiresAt: expiresAt,
      maxMembers: 6,
    })
    .where(eq(families.id, familyId));
}

/**
 * Record an IAP transaction (idempotent by transactionId).
 */
export async function getIapTransactionByTransactionId(transactionId: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(iapTransactions)
    .where(eq(iapTransactions.transactionId, transactionId))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertIapTransaction(data: InsertIapTransaction) {
  const db = await getDb();
  if (!db) return;
  await db.insert(iapTransactions).values(data).onConflictDoNothing({ target: [iapTransactions.transactionId] });
}

// ─── Import Usage helpers ─────────────────────────────────────────────────────

export interface FamilyUsageHistoryRow {
  yearMonth: string;
  imports: number;
  aiChat: number;
}

export interface FamilyUsageHistoryMemberRow {
  userId: string;
  name: string;
  familyRole: string;
  imports: number;
  aiChat: number;
}

export interface FamilyUsageHistoryMonthRow extends FamilyUsageHistoryRow {
  members: FamilyUsageHistoryMemberRow[];
}

function getYearMonthKey(date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function getRecentYearMonths(months: number): string[] {
  const safeMonths = Math.max(1, Math.floor(months));
  const now = new Date();
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const result: string[] = [];

  for (let i = safeMonths - 1; i >= 0; i--) {
    const date = new Date(base);
    date.setUTCMonth(date.getUTCMonth() - i);
    result.push(getYearMonthKey(date));
  }

  return result;
}

/**
 * Get current month's import count for a family.
 */
export async function getImportUsage(familyId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const yearMonth = getYearMonthKey();
  const rows = await db.select({ count: importUsage.count })
    .from(importUsage)
    .where(and(eq(importUsage.familyId, familyId), eq(importUsage.yearMonth, yearMonth)));
  return rows.reduce((sum, row) => sum + (row.count ?? 0), 0);
}

/**
 * Increment import count for a family. Returns new count.
 */
export async function incrementImportUsage(userId: string, familyId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const yearMonth = getYearMonthKey();
  await db.insert(importUsage)
    .values({ userId, familyId, yearMonth, count: 1 })
    .onConflictDoUpdate({ target: [importUsage.familyId, importUsage.yearMonth, importUsage.userId], set: { count: sql`${importUsage.count} + 1` } });
  // Re-fetch the updated count
  const result = await db.select({ count: importUsage.count }).from(importUsage)
    .where(and(eq(importUsage.familyId, familyId), eq(importUsage.yearMonth, yearMonth), eq(importUsage.userId, userId)))
    .limit(1);
  return result[0]?.count ?? 1;
}

// ─── AI Chat Usage (per-kitchen monthly quota) ────────────────────────────────

export async function getAiChatUsage(familyId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const yearMonth = getYearMonthKey();
  const rows = await db.select({ count: aiChatUsage.count })
    .from(aiChatUsage)
    .where(and(eq(aiChatUsage.familyId, familyId), eq(aiChatUsage.yearMonth, yearMonth)));
  return rows.reduce((sum, row) => sum + (row.count ?? 0), 0);
}

export async function incrementAiChatUsage(familyId: number, userId: string, turns: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const yearMonth = getYearMonthKey();
  await db.insert(aiChatUsage)
    .values({ familyId, userId, yearMonth, count: turns })
    .onConflictDoUpdate({
      target: [aiChatUsage.familyId, aiChatUsage.yearMonth, aiChatUsage.userId],
      set: { count: sql`${aiChatUsage.count} + ${turns}` },
    });
  const rows = await db.select().from(aiChatUsage)
    .where(and(eq(aiChatUsage.familyId, familyId), eq(aiChatUsage.yearMonth, yearMonth), eq(aiChatUsage.userId, userId)))
    .limit(1);
  return rows[0]?.count ?? turns;
}

export async function getFamilyUsageHistory(familyId: number, months = 6): Promise<FamilyUsageHistoryRow[]> {
  const db = await getDb();
  if (!db) return [];

  const yearMonths = getRecentYearMonths(months);
  const [importRows, aiRows] = await Promise.all([
    db.select({ yearMonth: importUsage.yearMonth, count: importUsage.count })
      .from(importUsage)
      .where(and(eq(importUsage.familyId, familyId), inArray(importUsage.yearMonth, yearMonths))),
    db.select({ yearMonth: aiChatUsage.yearMonth, count: aiChatUsage.count })
      .from(aiChatUsage)
      .where(and(eq(aiChatUsage.familyId, familyId), inArray(aiChatUsage.yearMonth, yearMonths))),
  ]);

  const importMap = new Map(importRows.map((row) => [row.yearMonth, row.count]));
  const aiMap = new Map(aiRows.map((row) => [row.yearMonth, row.count]));

  return yearMonths.map((yearMonth) => ({
    yearMonth,
    imports: importMap.get(yearMonth) ?? 0,
    aiChat: aiMap.get(yearMonth) ?? 0,
  }));
}

export async function getFamilyUsageHistoryWithMembers(familyId: number, months = 6): Promise<FamilyUsageHistoryMonthRow[]> {
  const db = await getDb();
  if (!db) return [];

  const yearMonths = getRecentYearMonths(months);
  const members = await getFamilyMembers(familyId);
  const [importRows, aiRows] = await Promise.all([
    db.select({ yearMonth: importUsage.yearMonth, userId: importUsage.userId, count: importUsage.count })
      .from(importUsage)
      .where(and(eq(importUsage.familyId, familyId), inArray(importUsage.yearMonth, yearMonths))),
    db.select({ yearMonth: aiChatUsage.yearMonth, userId: aiChatUsage.userId, count: aiChatUsage.count })
      .from(aiChatUsage)
      .where(and(eq(aiChatUsage.familyId, familyId), inArray(aiChatUsage.yearMonth, yearMonths))),
  ]);

  const importMap = new Map<string, Map<string, number>>();
  for (const row of importRows) {
    const monthMap = importMap.get(row.yearMonth) ?? new Map<string, number>();
    monthMap.set(row.userId, (monthMap.get(row.userId) ?? 0) + (row.count ?? 0));
    importMap.set(row.yearMonth, monthMap);
  }

  const aiMap = new Map<string, Map<string, number>>();
  for (const row of aiRows) {
    const monthMap = aiMap.get(row.yearMonth) ?? new Map<string, number>();
    monthMap.set(row.userId, (monthMap.get(row.userId) ?? 0) + (row.count ?? 0));
    aiMap.set(row.yearMonth, monthMap);
  }

  return yearMonths.map((yearMonth) => {
    const monthImports = importMap.get(yearMonth) ?? new Map<string, number>();
    const monthAi = aiMap.get(yearMonth) ?? new Map<string, number>();
    const memberRows = members.map(({ member, user }) => ({
      userId: user.id,
      name: user.name || member.nickname || "Member",
      familyRole: member.familyRole,
      imports: monthImports.get(user.id) ?? 0,
      aiChat: monthAi.get(user.id) ?? 0,
    }));

    return {
      yearMonth,
      imports: memberRows.reduce((sum, row) => sum + row.imports, 0),
      aiChat: memberRows.reduce((sum, row) => sum + row.aiChat, 0),
      members: memberRows,
    };
  });
}

export interface FamilyUsageMemberRow {
  userId: string;
  name: string;
  familyRole: string;
  imports: number;
  aiChat: number;
}

export async function getFamilyUsageByMember(familyId: number): Promise<FamilyUsageMemberRow[]> {
  const db = await getDb();
  if (!db) return [];

  const yearMonth = getYearMonthKey();
  const [members, importRows, aiRows] = await Promise.all([
    getFamilyMembers(familyId),
    db.select({ userId: importUsage.userId, count: importUsage.count })
      .from(importUsage)
      .where(and(eq(importUsage.familyId, familyId), eq(importUsage.yearMonth, yearMonth))),
    db.select({ userId: aiChatUsage.userId, count: aiChatUsage.count })
      .from(aiChatUsage)
      .where(and(eq(aiChatUsage.familyId, familyId), eq(aiChatUsage.yearMonth, yearMonth))),
  ]);

  const importMap = new Map<string, number>();
  for (const row of importRows) {
    importMap.set(row.userId, (importMap.get(row.userId) ?? 0) + (row.count ?? 0));
  }

  const aiMap = new Map<string, number>();
  for (const row of aiRows) {
    aiMap.set(row.userId, (aiMap.get(row.userId) ?? 0) + (row.count ?? 0));
  }

  return members.map(({ member, user }) => ({
    userId: user.id,
    name: user.name || member.nickname || "Member",
    familyRole: member.familyRole,
    imports: importMap.get(user.id) ?? 0,
    aiChat: aiMap.get(user.id) ?? 0,
  }));
}

// ─── Push Token helpers ───────────────────────────────────────────────────────

export async function upsertPushToken(userId: string, familyId: number | null, token: string, platform?: string) {
  const db = await getDb();
  if (!db) return;
  // Check if token already exists
  const existing = await db.select().from(pushTokens)
    .where(eq(pushTokens.token, token)).limit(1);
  if (existing.length > 0) {
    await db.update(pushTokens)
      .set({ userId, familyId: familyId ?? null, platform: platform ?? null })
      .where(eq(pushTokens.token, token));
  } else {
    await db.insert(pushTokens).values({
      userId,
      familyId: familyId ?? null,
      token,
      platform: platform ?? null,
    });
  }
}

export async function getPushTokensByUserIds(userIds: string[]): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  if (userIds.length === 0) return [];
  const result = await db.select({ token: pushTokens.token })
    .from(pushTokens)
    .where(inArray(pushTokens.userId, userIds));
  return result.map((r) => r.token);
}

export async function getPushTokensByFamily(familyId: number): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const result = await db.select({ token: pushTokens.token })
    .from(pushTokens)
    .where(eq(pushTokens.familyId, familyId));
  return result.map((r) => r.token);
}

export async function getPushTokensByUser(userId: string): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const result = await db.select({ token: pushTokens.token })
    .from(pushTokens)
    .where(eq(pushTokens.userId, userId));
  return result.map((r) => r.token);
}

// ─── Email Auth Helpers ───────────────────────────────────────────────────────
import crypto from "crypto";

/** Hash a password using PBKDF2 (Node.js built-in, no extra packages needed) */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

/** Verify a password against a stored hash */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const verify = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(verify, "hex"));
}

/** Get user by email (for login) */
export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  return result[0] ?? null;
}

/** Create a new user with email + password */
export async function createEmailUser(params: {
  email: string;
  password: string;
  name: string;
}): Promise<{ id: string; openId: string } | null> {
  const db = await getDb();
  if (!db) return null;
  const openId = `email_${crypto.randomBytes(16).toString("hex")}`;
  const passwordHash = hashPassword(params.password);
  await db.insert(users).values({
    openId,
    email: params.email.toLowerCase(),
    name: params.name,
    passwordHash,
    emailVerified: false,
    loginMethod: "email",
    passwordVersion: 0,
    lastSignedIn: new Date(),
  });
  const created = await getUserByEmail(params.email);
  if (!created) return null;
  return { id: created.id, openId: created.openId };
}

/** Update user's passwordHash */
export async function updateUserPassword(userId: string, newPassword: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const passwordHash = hashPassword(newPassword);
  await db.update(users).set({
    passwordHash,
    passwordVersion: sql`${users.passwordVersion} + 1`,
  }).where(eq(users.id, userId));
}

/** Update user's last signed in timestamp */
export async function touchUserSignIn(userId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, userId));
}

// ─── Common Ingredients ──────────────────────────────────────────────────────

/** Return all active common ingredients */
export async function getCommonIngredients() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(commonIngredients)
    .where(eq(commonIngredients.isActive, true))
    .orderBy(commonIngredients.sortOrder, commonIngredients.nameYue);
}

/** Search common ingredients across all language fields using ILIKE */
export async function searchCommonIngredients(query: string, limit = 10) {
  const db = await getDb();
  if (!db) return [];
  const q = `%${query}%`;
  return db
    .select()
    .from(commonIngredients)
    .where(
      and(
        eq(commonIngredients.isActive, true),
        sql`${commonIngredients.nameYue} ILIKE ${q} OR ${commonIngredients.nameZh} ILIKE ${q} OR ${commonIngredients.nameEn} ILIKE ${q} OR COALESCE(${commonIngredients.nameFil}, '') ILIKE ${q} OR COALESCE(${commonIngredients.nameId}, '') ILIKE ${q}`
      )
    )
    .orderBy(commonIngredients.sortOrder, commonIngredients.nameYue)
    .limit(limit);
}

/** Insert common ingredients (idempotent: skip if nameYue already exists) */
export async function insertCommonIngredients(items: InsertCommonIngredient[]): Promise<number> {
  if (items.length === 0) return 0;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  let inserted = 0;
  for (const item of items) {
    try {
      await db
        .insert(commonIngredients)
        .values(item)
        .onConflictDoNothing({ target: commonIngredients.nameYue });
      inserted++;
    } catch {
      // Skip duplicates
    }
  }
  return inserted;
}

// ─── Recipe Popularity ───────────────────────────────────────────────────────

/** Increment recipe popularity score */
export async function incrementRecipePopularity(recipeId: string, increment = 1): Promise<void> {
  const db = await getDb();
  if (!db) return;
  
  // Parse recipe ID prefix to determine table
  if (recipeId.startsWith("official_")) {
    const id = parseInt(recipeId.replace("official_", ""), 10);
    await db
      .update(officialRecipes)
      .set({ popularity: sql`${officialRecipes.popularity} + ${increment}` })
      .where(eq(officialRecipes.id, id));
  } else if (recipeId.startsWith("user_")) {
    const id = parseInt(recipeId.replace("user_", ""), 10);
    await db
      .update(customRecipes)
      .set({ popularity: sql`${customRecipes.popularity} + ${increment}` })
      .where(eq(customRecipes.id, id));
  }
}

/** Set recipe popularity score (for seeding) */
export async function setRecipePopularity(recipeId: string, score: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  
  if (recipeId.startsWith("official_")) {
    const id = parseInt(recipeId.replace("official_", ""), 10);
    await db.update(officialRecipes).set({ popularity: score }).where(eq(officialRecipes.id, id));
  } else if (recipeId.startsWith("user_")) {
    const id = parseInt(recipeId.replace("user_", ""), 10);
    await db.update(customRecipes).set({ popularity: score }).where(eq(customRecipes.id, id));
  }
}

export async function addRedirectLog(data: InsertRedirectLog) {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(redirectLogs).values(data);
  } catch (err) {
    console.warn("[RedirectLog] insert failed:", err);
  }
}
