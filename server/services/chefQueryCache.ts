import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { chefQueryCache } from "../../drizzle/schema";
import { normalizeChefSlots, type ChefSlots, type ChefSlotsCache } from "./chefSlots";

async function read(normalizedText: string): Promise<ChefSlots | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const [row] = await db
      .select({ slots: chefQueryCache.slots })
      .from(chefQueryCache)
      .where(sql`${chefQueryCache.normalizedText} = ${normalizedText}`)
      .limit(1);
    if (!row?.slots) return null;
    void db
      .update(chefQueryCache)
      .set({ hitCount: sql`${chefQueryCache.hitCount} + 1`, lastHitAt: new Date() })
      .where(sql`${chefQueryCache.normalizedText} = ${normalizedText}`)
      .catch(() => {});
    return normalizeChefSlots(row.slots);
  } catch (error) {
    // Table may not be migrated yet (or DB is down). Parsing still works.
    console.warn("[Chef] query cache read failed:", (error as Error)?.message || error);
    return null;
  }
}

async function write(normalizedText: string, slots: ChefSlots): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db
      .insert(chefQueryCache)
      .values({ normalizedText, slots })
      .onConflictDoUpdate({
        target: chefQueryCache.normalizedText,
        set: { slots, updatedAt: new Date() },
      });
  } catch (error) {
    console.warn("[Chef] query cache write failed:", (error as Error)?.message || error);
  }
}

export const dbChefSlotsCache: ChefSlotsCache = { get: read, set: write };
