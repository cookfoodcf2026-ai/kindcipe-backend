/**
 * Read-time shopping identity repair.
 *
 * The shopping list can be old and dirty: `from_meal_plan_id` may point at a
 * plan whose recipe ref is legacy/invalid, or `from_recipe_id` may itself be a
 * legacy colon ref. This mapper repairs the response without writing to the DB.
 *
 * Cache:
 * - request-scoped Map: one lookup per unique meal plan id
 * - cross-request LRU + TTL (max 60s), key `familyId:mealPlanId`
 */
import { formatRecipeRef, parseRecipeRef } from "./recipeRef";

export interface NormalizerPlanLookup {
  getMealPlanRows(
    familyId: number,
    planIds: number[],
  ): Promise<Map<number, { recipeId: string | null; date: string | null }>>;
}

export interface NormalizerCacheEntry {
  value: string | null;
  expiresAt: number;
}

export interface NormalizerCache {
  get(key: string): NormalizerCacheEntry | undefined;
  set(key: string, value: string | null, expiresAt: number): void;
  delete(key: string): void;
  clear(): void;
}

export class LruTtlCache implements NormalizerCache {
  private map = new Map<string, NormalizerCacheEntry>();
  private readonly max: number;
  private readonly now: () => number;

  constructor(options: { max?: number; now?: () => number } = {}) {
    this.max = Math.max(1, options.max ?? 500);
    this.now = options.now ?? Date.now;
  }

  get(key: string): NormalizerCacheEntry | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh recency.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry;
  }

  set(key: string, value: string | null, expiresAt: number): void {
    this.map.delete(key);
    if (this.map.size >= this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt });
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

export interface ShoppingNormalizerDeps {
  lookup: NormalizerPlanLookup;
  cache?: NormalizerCache;
  ttlMs?: number;
  now?: () => number;
  metric?: (name: string, tags?: Record<string, unknown>) => void;
}

export interface ShoppableRow {
  fromMealPlanId?: number | null;
  fromRecipeId?: string | null;
}

export interface ShoppingNormalizer {
  normalizeRows<T extends ShoppableRow>(familyId: number, rows: T[]): Promise<Array<T & { fromRecipeId: string | null }>>;
  invalidate(familyId: number, mealPlanId: number): void;
  invalidateFamily(familyId: number): void;
}

const MAX_TTL_MS = 60_000;

export function createShoppingNormalizer(deps: ShoppingNormalizerDeps): ShoppingNormalizer {
  const cache = deps.cache ?? new LruTtlCache();
  const ttlMs = Math.min(Math.max(0, deps.ttlMs ?? MAX_TTL_MS), MAX_TTL_MS);
  const now = deps.now ?? Date.now;
  const familyPlanKeys = new Map<number, Set<number>>();

  const keyFor = (familyId: number, planId: number) => `${familyId}:${planId}`;

  const remember = (familyId: number, planId: number) => {
    let set = familyPlanKeys.get(familyId);
    if (!set) {
      set = new Set();
      familyPlanKeys.set(familyId, set);
    }
    set.add(planId);
  };

  return {
    async normalizeRows<T extends ShoppableRow>(
      familyId: number,
      rows: T[],
    ): Promise<Array<T & { fromRecipeId: string | null }>> {
      const requestMap = new Map<number, string | null>();
      const missing: number[] = [];
      const seen = new Set<number>();

      for (const row of rows) {
        const planId = row.fromMealPlanId;
        if (planId == null || seen.has(planId)) continue;
        seen.add(planId);
        const cached = cache.get(keyFor(familyId, planId));
        if (cached) {
          requestMap.set(planId, cached.value);
        } else {
          missing.push(planId);
        }
      }

      if (missing.length > 0) {
        const planRows = await deps.lookup.getMealPlanRows(familyId, missing);
        for (const planId of missing) {
          const value = planRows.get(planId)?.recipeId ?? null;
          requestMap.set(planId, value);
          cache.set(keyFor(familyId, planId), value, now() + ttlMs);
          remember(familyId, planId);
        }
      }

      return rows.map((row) => {
        const planId = row.fromMealPlanId;
        const planRecipe = planId != null ? requestMap.get(planId) ?? null : null;

        let ref = planRecipe ? parseRecipeRef(planRecipe) : null;
        if (!ref && row.fromRecipeId) ref = parseRecipeRef(row.fromRecipeId);

        const fromRecipeId = ref ? formatRecipeRef(ref) : null;
        if (!fromRecipeId) deps.metric?.("orphan_read");
        return { ...row, fromRecipeId };
      });
    },

    invalidate(familyId: number, mealPlanId: number): void {
      cache.delete(keyFor(familyId, mealPlanId));
    },

    invalidateFamily(familyId: number): void {
      const keys = familyPlanKeys.get(familyId);
      if (!keys) return;
      for (const planId of keys) cache.delete(keyFor(familyId, planId));
      keys.clear();
    },
  };
}
