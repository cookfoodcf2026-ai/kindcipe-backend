import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { aiPhotoUsage } from "../../drizzle/schema";

export type AiPhotoKind = "analyze" | "generate";

export function hongKongDay(date = new Date()): string {
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function claimAiPhotoUsage(input: {
  userId: string;
  kind: AiPhotoKind;
  day: string;
  limit: number;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const [row] = await db
    .insert(aiPhotoUsage)
    .values({ userId: input.userId, kind: input.kind, day: input.day, count: 1 })
    .onConflictDoUpdate({
      target: [aiPhotoUsage.userId, aiPhotoUsage.kind, aiPhotoUsage.day],
      set: { count: sql`${aiPhotoUsage.count} + 1`, updatedAt: new Date() },
      where: sql`${aiPhotoUsage.count} < ${input.limit}`,
    })
    .returning({ count: aiPhotoUsage.count });
  return Boolean(row);
}

export async function releaseAiPhotoUsage(input: {
  userId: string;
  kind: AiPhotoKind;
  day: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(aiPhotoUsage)
    .set({ count: sql`GREATEST(0, ${aiPhotoUsage.count} - 1)` })
    .where(and(
      eq(aiPhotoUsage.userId, input.userId),
      eq(aiPhotoUsage.kind, input.kind),
      eq(aiPhotoUsage.day, input.day),
    ));
}
