import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { buildTranslationPatch } from "../utils/recipeTranslations";
import { customRecipes } from "../../drizzle/schema";

type Job = { id: number; retries: number };

const queue: Job[] = [];
let draining = false;

function push(id: number, retries: number): void {
  queue.push({ id, retries });
  void drain();
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const job = queue.shift()!;
      try {
        await translateOne(job.id);
      } catch (error) {
        if (job.retries < 2) {
          setTimeout(() => push(job.id, job.retries + 1), 1000 * (job.retries + 1));
        } else {
          console.warn(`[import] translate=failed id=${job.id} error=${(error as Error)?.message ?? error}`);
        }
      }
    }
  } finally {
    draining = false;
  }
}

async function translateOne(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const [row] = await db.select().from(customRecipes).where(eq(customRecipes.id, id)).limit(1);
  if (!row) return;
  const startedAt = Date.now();
  const patch = await buildTranslationPatch(row as any);
  if (Object.keys(patch).length > 0) {
    await db.update(customRecipes).set(patch as any).where(eq(customRecipes.id, id));
  }
  console.log(`[import] translate=${Date.now() - startedAt} id=${id} patched=${Object.keys(patch).length}`);
}

export function enqueueRecipeTranslation(id: number, familyId: number): void {
  console.log(`[import] translate=deferred id=${id} familyId=${familyId}`);
  push(id, 0);
}
