import { getDb } from "../db";
import { chefQueryLog } from "../../drizzle/schema";

export type ChefQueryLogInput = {
  familyId?: number | null;
  userId?: string | null;
  rawText: string;
  slots?: unknown;
  relaxLevel?: number | null;
  candidates?: number | null;
  served: number;
  credits: number;
  llmCalls: number;
  durationMs: number;
  reason?: string | null;
  servedSources?: Record<string, number> | null;
};

/**
 * Best-effort query telemetry. Never throws and never blocks the caller:
 * the router calls this with `void`, and any DB/schema failure is swallowed.
 */
export async function logChefQuery(input: ChefQueryLogInput): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(chefQueryLog).values({
      familyId: input.familyId ?? null,
      userId: input.userId ?? null,
      rawText: String(input.rawText ?? "").slice(0, 2000),
      slots: (input.slots ?? null) as any,
      relaxLevel: input.relaxLevel ?? null,
      candidates: input.candidates ?? null,
      served: input.served,
      credits: input.credits,
      llmCalls: input.llmCalls,
      durationMs: input.durationMs,
      reason: input.reason ?? null,
      servedSources: (input.servedSources ?? null) as any,
    });
  } catch (error) {
    console.warn("[AI Chef] chef_query_log insert failed:", (error as Error)?.message || error);
  }
}
