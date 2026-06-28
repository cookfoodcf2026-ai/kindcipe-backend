import { and, desc, eq, gte, lte, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  InsertUser,
  commonIngredients,
  customRecipes,
  familyMembers,
  families,
  favoriteItems,
  importUsage,
  mealPlans,
  pantryItems,
  purchaseHistory,
  pushTokens,
  recipeEvents,
  shoppingItems,
  users,
  type InsertCommonIngredient,
  type InsertFamily,
  type InsertFamilyMember,
  type InsertFavoriteItem,
  type InsertMealPlan,
  type InsertPantryItem,
  type InsertRecipeEvent,
  type InsertShoppingItem,
  recipeNotes,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _pgClient: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _pgClient = postgres(process.env.DATABASE_URL);
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

export async function setDefaultFamily(userId: string | number, familyId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(familyMembers).set({ isDefault: false }).where(eq(familyMembers.userId, String(userId)));
  await db.update(familyMembers).set({ isDefault: true })
    .where(and(eq(familyMembers.userId, String(userId)), eq(familyMembers.familyId, familyId)));
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
  return family?.settings ?? { approvalRequired: true };
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
  await db.delete(shoppingItems).where(eq(shoppingItems.familyId, familyId));
  await db.delete(pantryItems).where(eq(pantryItems.familyId, familyId));
  await db.delete(mealPlans).where(eq(mealPlans.familyId, familyId));
  await db.delete(purchaseHistory).where(eq(purchaseHistory.familyId, familyId));
  await db.delete(pushTokens).where(eq(pushTokens.familyId, familyId));
  await db.delete(familyMembers).where(eq(familyMembers.familyId, familyId));
  await db.delete(families).where(eq(families.id, familyId));
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
export async function addFamilyMember(data: InsertFamilyMember) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(familyMembers).values(data);
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
  boughtByUserId?: number,
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
  updates: { name?: string; quantity?: string; unit?: string; estimatedPrice?: number }
) {
  const db = await getDb();
  if (!db) return;
  const set: Record<string, unknown> = {};
  if (updates.name !== undefined) set.name = updates.name;
  if (updates.quantity !== undefined) set.quantity = updates.quantity;
  if (updates.unit !== undefined) set.unit = updates.unit;
  if (updates.estimatedPrice !== undefined) set.estimatedPrice = updates.estimatedPrice;
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
  return db.select().from(mealPlans).where(
    and(
      eq(mealPlans.familyId, familyId),
      gte(mealPlans.date, startDate),
      lte(mealPlans.date, endDate)
    )
  );
}

export async function addMealPlan(data: InsertMealPlan) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(mealPlans).values(data);
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
  confirmedByUserId?: number
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

// 刪除由某排餐（recipeId + date + familyId）加入、且尚未購買的購物清單項目
export async function deleteShoppingItemsByMealPlan(
  familyId: number,
  recipeId: string,
  plannedDate: string
) {
  const db = await getDb();
  if (!db) return;
  await db.delete(shoppingItems).where(
    and(
      eq(shoppingItems.familyId, familyId),
      eq(shoppingItems.fromRecipeId, recipeId),
      eq(shoppingItems.plannedDate, plannedDate),
      // 只刪除未購買的（active / pending），已買的保留作記錄
      inArray(shoppingItems.status, ["active", "pending"])
    )
  );
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
export async function getFavoriteItems(userId: number) {
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
  userId: number,
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
  userId: number;
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
  userId: number;
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

export async function deleteRecipeNote(id: number, userId: number, familyId: number) {
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
        .set({ subscriptionStatus: "free", maxMembers: 2 })
        .where(eq(families.id, familyId));
    }
  }

  // Auto-expire paid subscription
  if (status === "active" && family.subscriptionExpiresAt && family.subscriptionExpiresAt < now) {
    status = "expired";
    const db = await getDb();
    if (db) {
      await db.update(families)
        .set({ subscriptionStatus: "expired", maxMembers: 2 })
        .where(eq(families.id, familyId));
    }
  }

  const isPaid = status === "active" || status === "trial";
  return {
    status,
    isPaid,
    maxMembers: isPaid ? 6 : 2,
    maxImportsPerMonth: isPaid ? Infinity : 5,
    maxCustomRecipes: isPaid ? Infinity : 15,
    trialEndsAt: family.trialEndsAt,
    subscriptionExpiresAt: family.subscriptionExpiresAt,
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

// ─── Import Usage helpers ─────────────────────────────────────────────────────

/**
 * Get current month's import count for a user.
 */
export async function getImportUsage(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const yearMonth = new Date().toISOString().slice(0, 7); // "2025-06"
  const result = await db.select().from(importUsage)
    .where(and(eq(importUsage.userId, userId), eq(importUsage.yearMonth, yearMonth)))
    .limit(1);
  return result[0]?.count ?? 0;
}

/**
 * Increment import count for a user. Returns new count.
 */
export async function incrementImportUsage(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const yearMonth = new Date().toISOString().slice(0, 7);
  await db.insert(importUsage)
    .values({ userId, yearMonth, count: 1 })
    .onConflictDoUpdate({ target: [importUsage.userId, importUsage.yearMonth], set: { count: sql`${importUsage.count} + 1` } });
  // Re-fetch the updated count
  const result = await db.select().from(importUsage)
    .where(and(eq(importUsage.userId, userId), eq(importUsage.yearMonth, yearMonth)))
    .limit(1);
  return result[0]?.count ?? 1;
}

// ─── Push Token helpers ───────────────────────────────────────────────────────

export async function upsertPushToken(userId: number, familyId: number | null, token: string, platform?: string) {
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

export async function getPushTokensByUserIds(userIds: number[]): Promise<string[]> {
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

export async function getPushTokensByUser(userId: number): Promise<string[]> {
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
}): Promise<{ id: number; openId: string } | null> {
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
    lastSignedIn: new Date(),
  });
  const created = await getUserByEmail(params.email);
  if (!created) return null;
  return { id: created.id, openId: created.openId };
}

/** Update user's passwordHash */
export async function updateUserPassword(userId: number, newPassword: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const passwordHash = hashPassword(newPassword);
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
}

/** Update user's last signed in timestamp */
export async function touchUserSignIn(userId: number): Promise<void> {
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
