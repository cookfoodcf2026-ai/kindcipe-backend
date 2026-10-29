import { and, eq, gte } from "drizzle-orm";
import { aiChefMealState } from "../../drizzle/schema";
import { getDb } from "../db";
import type { MealShape } from "./chefPlanner";

export type StoredMealState = {
  shape: MealShape;
  cardNames: string[];
  updatedAt: Date;
};

const TTL_MS = 10 * 60 * 1000;

export async function getLastMealState(
  familyId: number,
  userId: string | number,
  ttlMs = TTL_MS,
): Promise<StoredMealState | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const cutoff = new Date(Date.now() - ttlMs);
    const [row] = await db
      .select()
      .from(aiChefMealState)
      .where(and(
        eq(aiChefMealState.familyId, familyId),
        eq(aiChefMealState.userId, String(userId)),
        gte(aiChefMealState.updatedAt, cutoff),
      ))
      .limit(1);
    if (!row) return null;
    return {
      shape: row.shape as MealShape,
      cardNames: Array.isArray(row.cardNames) ? row.cardNames : [],
      updatedAt: row.updatedAt,
    };
  } catch (error) {
    console.warn("[AI Chef] meal state read failed:", (error as Error)?.message || error);
    return null;
  }
}

export async function saveLastMealState(
  familyId: number,
  userId: string | number,
  shape: MealShape,
  cardNames: string[] = [],
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db
      .insert(aiChefMealState)
      .values({
        familyId,
        userId: String(userId),
        shape,
        cardNames,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [aiChefMealState.familyId, aiChefMealState.userId],
        set: {
          shape,
          cardNames,
          updatedAt: new Date(),
        },
      });
  } catch (error) {
    console.warn("[AI Chef] meal state write failed:", (error as Error)?.message || error);
  }
}
