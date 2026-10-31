import { and, asc, eq, lt } from "drizzle-orm";
import { getDb } from "../db";
import { buildTranslationPatch } from "../utils/recipeTranslations";
import { customRecipes } from "../../drizzle/schema";

const MAX_ATTEMPTS = 5;
const SWEEP_CONCURRENCY = 3;

export function isPendingForTranslation(status: string | null | undefined, attempts: number): boolean {
  return status === "pending" && attempts < MAX_ATTEMPTS;
}

export function nextTranslationState(attempts: number, success: boolean): { status: "ready" | "pending" | "failed"; attempts: number } {
  if (success) return { status: "ready", attempts: 0 };
  const next = attempts + 1;
  return next >= MAX_ATTEMPTS ? { status: "failed", attempts: next } : { status: "pending", attempts: next };
}

function isRowComplete(row: any): boolean {
  return Boolean(row?.nameEn && row.nameFil && row.nameId && row.stepsEn && row.stepsFil && row.stepsId);
}

async function translateOne(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const [row] = await db.select().from(customRecipes).where(eq(customRecipes.id, id)).limit(1);
  if (!row) return;
  const startedAt = Date.now();
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
}

export async function runTranslationSweep(limit = SWEEP_CONCURRENCY): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const pending = await db.select({ id: customRecipes.id }).from(customRecipes)
    .where(and(eq(customRecipes.translationStatus, "pending"), lt(customRecipes.translationAttempts, MAX_ATTEMPTS)))
    .orderBy(asc(customRecipes.translationUpdatedAt), asc(customRecipes.id))
    .limit(limit);
  if (pending.length === 0) return;
  console.log(`[import] sweep pending=${pending.length}`);
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
