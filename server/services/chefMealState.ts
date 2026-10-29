import { and, eq, gte } from "drizzle-orm";
import { aiChefMealState } from "../../drizzle/schema";
import { getDb } from "../db";
import type { MealShape } from "./chefPlanner";

export type TurnAttributes = {
  spicy?: boolean;
  doneness?: string;
  [key: string]: unknown;
};

export type LastMiss = {
  label: string;
  kind: string;
  alternatives: string[];
};

export type PendingAsk = {
  key: string;
  askedCount: number;
  maxAskCount: number;
};

export type StoredMealState = {
  shape: MealShape;
  cardNames: string[];
  avoid: string[];
  scenarios: string[];
  attributes: TurnAttributes;
  lastMiss: LastMiss | null;
  pendingAsk: PendingAsk | null;
  updatedAt: Date;
};

export type TurnStatePatch = {
  avoid?: string[];
  scenarios?: string[];
  attributes?: TurnAttributes;
  lastMiss?: LastMiss | null;
  pendingAsk?: PendingAsk | null;
};

const TTL_MS = 10 * 60 * 1000;

function asArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

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
      cardNames: asArray(row.cardNames),
      avoid: asArray(row.avoid),
      scenarios: asArray(row.scenarios),
      attributes: (row.attributes ?? {}) as TurnAttributes,
      lastMiss: (row.lastMiss ?? null) as LastMiss | null,
      pendingAsk: (row.pendingAsk ?? null) as PendingAsk | null,
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
  extra: TurnStatePatch = {},
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    const values = {
      familyId,
      userId: String(userId),
      shape,
      cardNames,
      avoid: extra.avoid ?? [],
      scenarios: extra.scenarios ?? [],
      attributes: extra.attributes ?? {},
      lastMiss: extra.lastMiss ?? null,
      pendingAsk: extra.pendingAsk ?? null,
      updatedAt: new Date(),
    };
    await db
      .insert(aiChefMealState)
      .values(values)
      .onConflictDoUpdate({
        target: [aiChefMealState.familyId, aiChefMealState.userId],
        set: values,
      });
  } catch (error) {
    console.warn("[AI Chef] meal state write failed:", (error as Error)?.message || error);
  }
}
