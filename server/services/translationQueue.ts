import { randomUUID } from "node:crypto";
import { and, asc, eq, lt } from "drizzle-orm";
import { startLlmMeter } from "../_core/llm";
import { getDb } from "../db";
import { buildTranslationPatch, isRowComplete, translationSourceFlags } from "../utils/recipeTranslations";
import { customRecipes } from "../../drizzle/schema";

const MAX_ATTEMPTS = 5;
const SWEEP_CONCURRENCY = 3;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_JOBS = 10;

let sweeping = false;
let windowStart = 0;
let windowCount = 0;

export function tryBeginSweep(): boolean {
  if (sweeping) return false;
  sweeping = true;
  return true;
}

export function endSweep(): void {
  sweeping = false;
}

export function translationMeterContext(familyId: number, userId: string): { familyId: number; userId: string; route: "recipe_translate"; requestId: string } {
  return { familyId, userId, route: "recipe_translate", requestId: randomUUID() };
}

export async function runMeteredTranslation<T>(familyId: number, userId: string, fn: () => Promise<T>): Promise<T> {
  const meter = startLlmMeter(translationMeterContext(familyId, userId));
  try {
    return await fn();
  } finally {
    const micros = Math.max(0, Math.round(meter.costUsd * 1_000_000));
    console.log(`[import] translate cost_micros=${micros} route=recipe_translate`);
  }
}

async function acquireTranslationSlot(): Promise<void> {
  const now = Date.now();
  if (now - windowStart >= RATE_WINDOW_MS) {
    windowStart = now;
    windowCount = 0;
  }
  while (windowCount >= RATE_MAX_JOBS) {
    const wait = RATE_WINDOW_MS - (Date.now() - windowStart);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const reset = Date.now();
    if (reset - windowStart >= RATE_WINDOW_MS) { windowStart = reset; windowCount = 0; }
  }
  windowCount += 1;
}

export function isPendingForTranslation(status: string | null | undefined, attempts: number): boolean {
  return status === "pending" && attempts < MAX_ATTEMPTS;
}

export function nextTranslationState(attempts: number, success: boolean): { status: "ready" | "pending" | "failed"; attempts: number } {
  if (success) return { status: "ready", attempts: 0 };
  const next = attempts + 1;
  return next >= MAX_ATTEMPTS ? { status: "failed", attempts: next } : { status: "pending", attempts: next };
}

async function translateOne(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const [row] = await db.select().from(customRecipes).where(eq(customRecipes.id, id)).limit(1);
  if (!row) return;
  if (isRowComplete(row)) {
    const flags = translationSourceFlags(row as any);
    await db.update(customRecipes).set({ translationStatus: "ready", translationAttempts: 0, translationUpdatedAt: new Date() }).where(eq(customRecipes.id, id));
    console.log(`[import] translate=noop id=${id} reason=${!flags.hasSteps ? "no_source_content" : "already_complete"}`);
    return;
  }
  await acquireTranslationSlot();
  const startedAt = Date.now();
  await runMeteredTranslation(row.familyId, row.createdByUserId, async () => {
    try {
      const patch = await buildTranslationPatch(row as any);
      if (Object.keys(patch).length > 0) {
        await db.update(customRecipes).set(patch as any).where(eq(customRecipes.id, id));
      }
      const [after] = await db.select().from(customRecipes).where(eq(customRecipes.id, id)).limit(1);
      if (isRowComplete(after)) {
        await db.update(customRecipes).set({ translationStatus: "ready", translationAttempts: 0, translationUpdatedAt: new Date() }).where(eq(customRecipes.id, id));
        console.log(`[import] translate=${Date.now() - startedAt} id=${id} status=ready`);
      } else {
        const next = nextTranslationState(after?.translationAttempts ?? 0, false);
        await db.update(customRecipes).set({ translationStatus: next.status, translationAttempts: next.attempts, translationUpdatedAt: new Date() }).where(eq(customRecipes.id, id));
        console.warn(`[import] translate=incomplete id=${id} attempts=${next.attempts} status=${next.status}`);
      }
    } catch (error) {
      const [rowNow] = await db.select({ attempts: customRecipes.translationAttempts }).from(customRecipes).where(eq(customRecipes.id, id)).limit(1);
      const next = nextTranslationState(rowNow?.attempts ?? 0, false);
      await db.update(customRecipes).set({ translationStatus: next.status, translationAttempts: next.attempts, translationUpdatedAt: new Date() }).where(eq(customRecipes.id, id));
      console.warn(`[import] translate=failed id=${id} attempts=${next.attempts} status=${next.status} error=${(error as Error)?.message ?? error}`);
    }
  });
}

export async function runTranslationSweep(limit = SWEEP_CONCURRENCY): Promise<void> {
  if (!tryBeginSweep()) {
    console.log("[import] sweep skip reason=inflight");
    return;
  }
  try {
    const db = await getDb();
    if (!db) return;
    const pending = await db.select({ id: customRecipes.id }).from(customRecipes)
      .where(and(eq(customRecipes.translationStatus, "pending"), lt(customRecipes.translationAttempts, MAX_ATTEMPTS)))
      .orderBy(asc(customRecipes.translationUpdatedAt), asc(customRecipes.id))
      .limit(limit);
    if (pending.length === 0) return;
    console.log(`[import] sweep start pending=${pending.length}`);
    const workers: Promise<void>[] = [];
    let cursor = 0;
    for (let i = 0; i < Math.min(limit, pending.length); i++) {
      workers.push((async () => {
        while (cursor < pending.length) {
          const item = pending[cursor++];
          await translateOne(item.id);
        }
      })());
    }
    await Promise.all(workers);
  } finally {
    endSweep();
  }
}

export function enqueueRecipeTranslation(id: number, familyId: number): void {
  console.log(`[import] translate=deferred id=${id} familyId=${familyId}`);
  void runTranslationSweep(1);
}

export function startTranslationSweep(intervalMs = 5 * 60 * 1000): () => void {
  void runTranslationSweep();
  const timer = setInterval(() => { void runTranslationSweep(); }, intervalMs);
  return () => clearInterval(timer);
}
