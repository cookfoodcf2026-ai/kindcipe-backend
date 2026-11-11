/**
 * Eat-out cancel/restore logic.
 *
 * The router supplies a drizzle transaction through `EatOutSetDeps`; tests
 * supply an in-memory store so the full set -> cancel cycle stays DB-free.
 *
 * Cancelling 「外出」 restores the day's meal plans from the snapshot taken when
 * eat-out was set, and re-points the existing shopping rows at the new plan ids.
 * No shopping rows are created during restore.
 */

/** Meal types removed when a day is marked as eat-out (current behaviour). */
export const EAT_OUT_DELETED_MEAL_TYPES = ["dinner"] as const;

export interface MealPlanSnapshotPlan {
  id: number;
  mealType: string;
  recipeId: string;
  recipeName: string;
  recipeNameEn: string | null;
  recipeNameFil: string | null;
  recipeNameId: string | null;
  recipeImage: string | null;
  status: string;
  proposedByUserId: string | null;
  proposedByName: string | null;
  confirmedByUserId: string | null;
  confirmedAt: string | null;
  note: string | null;
}

export interface EatOutPlanSnapshot {
  version: 1;
  plans: MealPlanSnapshotPlan[];
  shoppingItemIds: number[];
}

export type EatOutPlanRow = Omit<
  Partial<MealPlanSnapshotPlan>,
  "id" | "mealType" | "recipeId" | "recipeName" | "confirmedAt"
> & {
  id: number;
  mealType: string;
  recipeId: string;
  recipeName: string;
  confirmedAt?: Date | string | null;
};

export interface RestoreInsert {
  oldPlanId: number;
  plan: MealPlanSnapshotPlan;
}

export interface RestoreAlias {
  oldPlanId: number;
  targetOldPlanId: number;
}

export interface RestorePlanResult {
  restored: boolean;
  reason: "ok" | "day_has_meals" | "empty_snapshot";
  inserts: RestoreInsert[];
  aliases: RestoreAlias[];
}

function isoOrNull(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

export function toSnapshotPlan(row: EatOutPlanRow): MealPlanSnapshotPlan {
  return {
    id: row.id,
    mealType: row.mealType,
    recipeId: row.recipeId,
    recipeName: row.recipeName,
    recipeNameEn: row.recipeNameEn ?? null,
    recipeNameFil: row.recipeNameFil ?? null,
    recipeNameId: row.recipeNameId ?? null,
    recipeImage: row.recipeImage ?? null,
    status: row.status ?? "confirmed",
    proposedByUserId: row.proposedByUserId ?? null,
    proposedByName: row.proposedByName ?? null,
    confirmedByUserId: row.confirmedByUserId ?? null,
    confirmedAt: isoOrNull(row.confirmedAt),
    note: row.note ?? null,
  };
}

export function buildPlanSnapshot(
  rows: EatOutPlanRow[],
  shoppingItemIds: number[],
): EatOutPlanSnapshot {
  return {
    version: 1,
    plans: rows.map(toSnapshotPlan),
    shoppingItemIds: [...shoppingItemIds],
  };
}

export function parsePlanSnapshot(value: unknown): EatOutPlanSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return null;
  if (!Array.isArray(record.plans) || !Array.isArray(record.shoppingItemIds)) return null;

  const plans: MealPlanSnapshotPlan[] = [];
  for (const raw of record.plans) {
    if (!raw || typeof raw !== "object") return null;
    const plan = raw as Record<string, unknown>;
    if (
      typeof plan.id !== "number" ||
      typeof plan.mealType !== "string" ||
      typeof plan.recipeId !== "string" ||
      typeof plan.recipeName !== "string"
    ) {
      return null;
    }
    plans.push({
      id: plan.id,
      mealType: plan.mealType,
      recipeId: plan.recipeId,
      recipeName: plan.recipeName,
      recipeNameEn: typeof plan.recipeNameEn === "string" ? plan.recipeNameEn : null,
      recipeNameFil: typeof plan.recipeNameFil === "string" ? plan.recipeNameFil : null,
      recipeNameId: typeof plan.recipeNameId === "string" ? plan.recipeNameId : null,
      recipeImage: typeof plan.recipeImage === "string" ? plan.recipeImage : null,
      status: typeof plan.status === "string" ? plan.status : "confirmed",
      proposedByUserId: typeof plan.proposedByUserId === "string" ? plan.proposedByUserId : null,
      proposedByName: typeof plan.proposedByName === "string" ? plan.proposedByName : null,
      confirmedByUserId: typeof plan.confirmedByUserId === "string" ? plan.confirmedByUserId : null,
      confirmedAt: typeof plan.confirmedAt === "string" ? plan.confirmedAt : null,
      note: typeof plan.note === "string" ? plan.note : null,
    });
  }

  const shoppingItemIds: number[] = [];
  for (const id of record.shoppingItemIds) {
    if (typeof id !== "number") return null;
    shoppingItemIds.push(id);
  }

  return { version: 1, plans, shoppingItemIds };
}

/**
 * Decide what to re-insert. Only meal types that are missing from the day are
 * restored; meal types already present (e.g. breakfast/lunch added after the
 * eat-out was set) are never overwritten. Duplicate snapshot rows (same
 * `mealType+recipeId`) are collapsed to one insert; later rows alias to it so
 * their shopping rows still get relinked. Shopping rows belonging to skipped
 * meal types are left untouched.
 */
export function planEatOutRestore(
  snapshot: EatOutPlanSnapshot,
  existingMealTypes: readonly string[],
): RestorePlanResult {
  if (snapshot.plans.length === 0) {
    return { restored: false, reason: "empty_snapshot", inserts: [], aliases: [] };
  }

  const existing = new Set(existingMealTypes);
  const seen = new Map<string, number>();
  const inserts: RestoreInsert[] = [];
  const aliases: RestoreAlias[] = [];

  for (const plan of snapshot.plans) {
    if (existing.has(plan.mealType)) continue;
    const key = `${plan.mealType}\u0000${plan.recipeId}`;
    const target = seen.get(key);
    if (target != null) {
      aliases.push({ oldPlanId: plan.id, targetOldPlanId: target });
      continue;
    }
    seen.set(key, plan.id);
    inserts.push({ oldPlanId: plan.id, plan });
  }

  if (inserts.length === 0) {
    return { restored: false, reason: "day_has_meals", inserts: [], aliases: [] };
  }

  return { restored: true, reason: "ok", inserts, aliases };
}

export interface EatOutFlagRow {
  planSnapshot: unknown;
}

export interface StoredShoppingItem {
  id: number;
  fromMealPlanId: number | null;
}

export interface EatOutSetDeps {
  insertFlag(familyId: number, date: string, userId: string): Promise<void>;
  getFlag(familyId: number, date: string): Promise<EatOutFlagRow | null>;
  deleteFlag(familyId: number, date: string): Promise<void>;
  saveSnapshot(familyId: number, date: string, snapshot: EatOutPlanSnapshot): Promise<void>;
  listMealPlans(
    familyId: number,
    date: string,
    mealTypes: readonly string[],
  ): Promise<EatOutPlanRow[]>;
  deleteMealPlans(familyId: number, date: string, mealTypes: readonly string[]): Promise<void>;
  listShoppingItemIdsForPlans(familyId: number, planIds: number[]): Promise<number[]>;
  listDayMealTypes(familyId: number, date: string): Promise<string[]>;
  insertMealPlans(
    familyId: number,
    date: string,
    plans: MealPlanSnapshotPlan[],
  ): Promise<number[]>;
  listShoppingItems(familyId: number, ids: number[]): Promise<StoredShoppingItem[]>;
  relinkShoppingItems(familyId: number, itemIds: number[], newPlanId: number): Promise<void>;
}

export interface ApplyEatOutInput {
  familyId: number;
  date: string;
  eatOut: boolean;
  userId: string;
}

export interface ApplyEatOutResult {
  success: true;
  restored: boolean;
  reason?: "ok" | "no_flag" | "no_snapshot" | "day_has_meals" | "empty_snapshot";
  restoredPlans?: number;
}

export async function applyEatOutSet(
  deps: EatOutSetDeps,
  input: ApplyEatOutInput,
): Promise<ApplyEatOutResult> {
  const { familyId, date } = input;

  if (input.eatOut) {
    await deps.insertFlag(familyId, date, input.userId);

    const plans = await deps.listMealPlans(familyId, date, EAT_OUT_DELETED_MEAL_TYPES);
    const shoppingItemIds = plans.length > 0
      ? await deps.listShoppingItemIdsForPlans(familyId, plans.map((plan) => plan.id))
      : [];

    // Keep an existing snapshot if a repeated set has nothing left to capture.
    if (plans.length > 0) {
      await deps.saveSnapshot(familyId, date, buildPlanSnapshot(plans, shoppingItemIds));
    }

    await deps.deleteMealPlans(familyId, date, EAT_OUT_DELETED_MEAL_TYPES);
    return { success: true, restored: false };
  }

  const flag = await deps.getFlag(familyId, date);
  await deps.deleteFlag(familyId, date);
  if (!flag) return { success: true, restored: false, reason: "no_flag" };

  const snapshot = parsePlanSnapshot(flag.planSnapshot);
  if (!snapshot) return { success: true, restored: false, reason: "no_snapshot" };

  const existingMealTypes = await deps.listDayMealTypes(familyId, date);
  const restore = planEatOutRestore(snapshot, existingMealTypes);
  if (!restore.restored) {
    return { success: true, restored: false, reason: restore.reason };
  }

  const newIds = await deps.insertMealPlans(
    familyId,
    date,
    restore.inserts.map((insert) => insert.plan),
  );
  if (newIds.length !== restore.inserts.length) {
    throw new Error("eatOut restore: inserted plan id count mismatch");
  }

  const idMap = new Map<number, number>();
  restore.inserts.forEach((insert, index) => {
    idMap.set(insert.oldPlanId, newIds[index]);
  });
  for (const alias of restore.aliases) {
    const target = idMap.get(alias.targetOldPlanId);
    if (target != null) idMap.set(alias.oldPlanId, target);
  }

  if (snapshot.shoppingItemIds.length > 0) {
    const items = await deps.listShoppingItems(familyId, snapshot.shoppingItemIds);
    const groups = new Map<number, number[]>();
    for (const item of items) {
      if (item.fromMealPlanId == null) continue;
      const newPlanId = idMap.get(item.fromMealPlanId);
      if (newPlanId == null) continue;
      const group = groups.get(newPlanId) ?? [];
      group.push(item.id);
      groups.set(newPlanId, group);
    }
    for (const [newPlanId, itemIds] of groups) {
      await deps.relinkShoppingItems(familyId, itemIds, newPlanId);
    }
  }

  return { success: true, restored: true, reason: "ok", restoredPlans: restore.inserts.length };
}
