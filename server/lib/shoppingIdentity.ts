/**
 * Shopping identity logic for `shopping.add` / `shopping.addBatch`.
 *
 * All functions take an injected lookup/log/metric dependency so the whole
 * flow can be tested without a database.
 */
import { TRPCError } from "@trpc/server";
import { formatRecipeRef, parseRecipeRef, type RecipeRef } from "./recipeRef";

export interface MealPlanLookupRow {
  recipeId: string | null;
  date: string | null;
}

export interface ShoppingIdentityDeps {
  getMealPlanRows(
    familyId: number,
    planIds: number[],
  ): Promise<Map<number, MealPlanLookupRow>>;
  log?: (event: string, data?: Record<string, unknown>) => void;
  metric?: (name: string, tags?: Record<string, unknown>) => void;
}

export type LinkReason =
  | "plan_hit"
  | "lookup_miss"
  | "invalid_plan_ref"
  | "ref_conflict"
  | "caller_ref"
  | "invalid_ref"
  | "none";

export interface ResolvedShoppingLink {
  fromRecipeId: string | null;
  fromMealPlanId: number | null;
  canonical: boolean;
  reason: LinkReason;
}

export interface BatchShoppingItemInput {
  name: string;
  unit?: string | null;
  quantity?: string | null;
  plannedDate?: string | null;
  fromRecipeId?: string | null;
  fromMealPlanId?: number | null;
}

export interface ExistingShoppingItem {
  id: number;
  name: string;
  unit?: string | null;
  quantity?: string | null;
  plannedDate?: string | null;
  fromRecipeId?: string | null;
  fromMealPlanId?: number | null;
}

export interface PlannedShoppingInsert {
  index: number;
  name: string;
  unit: string | null;
  quantity: string | null;
  plannedDate: string | null;
  fromRecipeId: string | null;
  fromMealPlanId: number | null;
}

export interface PlannedShoppingUpdate {
  index: number;
  id: number;
  quantity: string;
  fromRecipeId: string | null;
  fromMealPlanId: number | null;
}

export interface BatchItemReport {
  index: number;
  ok: boolean;
  skipped: boolean;
  reason?: LinkReason | "invalid_name";
  action: "insert" | "merge";
  fromRecipeId: string | null;
  fromMealPlanId: number | null;
}

export interface PlannedShoppingBatch {
  inserts: PlannedShoppingInsert[];
  updates: PlannedShoppingUpdate[];
  reports: BatchItemReport[];
}

interface CallerRef {
  value: string | null;
  ref: RecipeRef | null;
  invalid: boolean;
}

function normalizeCaller(raw: string | null | undefined): CallerRef {
  if (raw == null || raw === "") return { value: null, ref: null, invalid: false };
  const ref = parseRecipeRef(raw, { strict: true });
  if (ref) return { value: formatRecipeRef(ref), ref, invalid: false };
  return { value: null, ref: null, invalid: true };
}

/** Existing rows may be dirty; never carry a non-canonical ref into an update. */
function canonicalRefOrNull(raw: string | null | undefined): string | null {
  if (raw == null || raw === "") return null;
  const ref = parseRecipeRef(raw, { strict: true });
  return ref ? formatRecipeRef(ref) : null;
}

function resolveWithRows(
  input: { fromMealPlanId?: number | null; fromRecipeId?: string | null },
  rows: Map<number, MealPlanLookupRow>,
  deps: ShoppingIdentityDeps,
): ResolvedShoppingLink {
  const caller = normalizeCaller(input.fromRecipeId);
  const planId = input.fromMealPlanId ?? null;

  const recordWrite = (link: ResolvedShoppingLink) => {
    if (planId != null || (input.fromRecipeId != null && input.fromRecipeId !== "")) {
      deps.metric?.("shopping_identity_expected");
      deps.metric?.(link.canonical ? "shopping_identity_canonical_written" : "shopping_identity_orphan_written");
    }
    return link;
  };

  const reject = (reason: string): ResolvedShoppingLink => {
    deps.log?.("shopping_invalid_ref", {
      planId,
      fromRecipeId: input.fromRecipeId ?? null,
      reason,
    });
    deps.metric?.("shopping_invalid_ref");
    return {
      fromRecipeId: null,
      fromMealPlanId: planId,
      canonical: false,
      reason: "invalid_ref",
    };
  };

  if (planId != null) {
    const row = rows.get(planId);
    if (!row) {
      deps.log?.("shopping_meal_plan_miss", { planId });
      deps.metric?.("shopping_meal_plan_miss");
      if (!caller.ref) return reject("lookup_miss_no_canonical_ref");
      return recordWrite({
        fromRecipeId: caller.value,
        fromMealPlanId: planId,
        canonical: true,
        reason: "lookup_miss",
      });
    }

    const planRef = parseRecipeRef(row.recipeId, { strict: true });
    if (!planRef) {
      if (caller.invalid) return reject("invalid_plan_invalid_caller");
      if (!caller.ref) return reject("invalid_plan_no_canonical_ref");
      deps.log?.("invalid_plan_ref", { planId, recipeId: row.recipeId });
      deps.metric?.("invalid_plan_ref");
      return recordWrite({
        fromRecipeId: caller.value,
        fromMealPlanId: planId,
        canonical: true,
        reason: "invalid_plan_ref",
      });
    }

    const canonical = formatRecipeRef(planRef);
    let reason: LinkReason = "plan_hit";
    if (caller.ref && formatRecipeRef(caller.ref) !== canonical) {
      deps.log?.("ref_conflict", {
        planId,
        callerRef: formatRecipeRef(caller.ref),
        planRef: canonical,
      });
      deps.metric?.("ref_conflict");
      reason = "ref_conflict";
    }
    return recordWrite({
      fromRecipeId: canonical,
      fromMealPlanId: planId,
      canonical: true,
      reason,
    });
  }

  if (caller.invalid) return reject("no_plan_invalid_caller");

  return recordWrite({
    fromRecipeId: caller.value,
    fromMealPlanId: null,
    canonical: caller.ref !== null,
    reason: caller.ref ? "caller_ref" : "none",
  });
}

export async function resolveShoppingAddLink(
  input: {
    familyId: number;
    fromMealPlanId?: number | null;
    fromRecipeId?: string | null;
    plannedDate?: string | null;
  },
  deps: ShoppingIdentityDeps,
): Promise<ResolvedShoppingLink> {
  const planIds = input.fromMealPlanId != null ? [input.fromMealPlanId] : [];
  const rows = planIds.length > 0 ? await deps.getMealPlanRows(input.familyId, planIds) : new Map();
  const link = resolveWithRows(input, rows, deps);
  if (link.reason === "invalid_ref") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `invalid_recipe_ref: ${input.fromRecipeId ?? "null"}`,
    });
  }
  const planDate = input.fromMealPlanId != null
    ? rows.get(input.fromMealPlanId)?.date
    : null;
  if (input.plannedDate == null && planDate != null) {
    deps.metric?.("shopping_planned_date_fallback", { familyId: input.familyId, count: 1 });
  }
  return link;
}

function mergeQty(existing: string | null | undefined, adding: string | null | undefined): string {
  const a = parseFloat(existing ?? "");
  const b = parseFloat(adding ?? "");
  if (!isNaN(a) && !isNaN(b)) return String(parseFloat((a + b).toFixed(2)));
  return existing || adding || "";
}

function mergeLink<T extends string | number>(
  existing: T | null,
  incoming: T | null,
  field: "fromRecipeId" | "fromMealPlanId",
  deps: ShoppingIdentityDeps,
): T | null {
  if (existing == null) return incoming;
  if (incoming == null) return existing;
  if (existing === incoming) return existing;
  deps.log?.("shopping_link_conflict", { field, existing, incoming });
  deps.metric?.("ref_conflict");
  return existing;
}

function sourceOf(entry: { fromRecipeId: string | null; fromMealPlanId: number | null }): string {
  if (entry.fromRecipeId) return `r:${entry.fromRecipeId}`;
  if (entry.fromMealPlanId != null) return `p:${entry.fromMealPlanId}`;
  return "none";
}

function sameNameUnitDate(
  a: { name: string; unit: string | null; plannedDate: string | null },
  b: { name: string; unit: string | null; plannedDate: string | null },
): boolean {
  return (
    a.name.trim() === b.name.trim() &&
    (a.unit ?? "").trim() === (b.unit ?? "").trim() &&
    (a.plannedDate ?? "") === (b.plannedDate ?? "")
  );
}

interface WorkingEntry {
  kind: "existing" | "insert";
  index: number;
  id?: number;
  name: string;
  unit: string | null;
  quantity: string | null;
  plannedDate: string | null;
  fromRecipeId: string | null;
  fromMealPlanId: number | null;
  dirty: boolean;
}

export async function planShoppingBatch(
  input: {
    familyId: number;
    items: BatchShoppingItemInput[];
    fallbackPlannedDate?: string | null;
    fallbackFromRecipeId?: string | null;
    fallbackFromMealPlanId?: number | null;
    existing: ExistingShoppingItem[];
  },
  deps: ShoppingIdentityDeps,
): Promise<PlannedShoppingBatch> {
  const effectivePlanIds = new Set<number>();
  for (const item of input.items) {
    const planId = item.fromMealPlanId ?? input.fallbackFromMealPlanId ?? null;
    if (planId != null) effectivePlanIds.add(planId);
  }
  const rows = effectivePlanIds.size > 0
    ? await deps.getMealPlanRows(input.familyId, [...effectivePlanIds])
    : new Map<number, MealPlanLookupRow>();

  const working: WorkingEntry[] = input.existing.map((row) => ({
    kind: "existing",
    index: -1,
    id: row.id,
    name: row.name,
    unit: row.unit ?? null,
    quantity: row.quantity ?? null,
    plannedDate: row.plannedDate ?? null,
    fromRecipeId: canonicalRefOrNull(row.fromRecipeId),
    fromMealPlanId: row.fromMealPlanId ?? null,
    dirty: false,
  }));

  const reports: BatchItemReport[] = [];
  let plannedDateFallbackCount = 0;

  for (let index = 0; index < input.items.length; index++) {
    const item = input.items[index];
    const name = (item.name ?? "").trim();
    const planId = item.fromMealPlanId ?? input.fallbackFromMealPlanId ?? null;

    if (!name) {
      reports.push({
        index,
        ok: false,
        skipped: true,
        reason: "invalid_name",
        action: "insert",
        fromRecipeId: null,
        fromMealPlanId: planId,
      });
      continue;
    }

    const link = resolveWithRows(
      {
        fromMealPlanId: planId,
        fromRecipeId: item.fromRecipeId ?? input.fallbackFromRecipeId ?? null,
      },
      rows,
      deps,
    );
    if (link.reason === "invalid_ref") {
      reports.push({
        index,
        ok: false,
        skipped: true,
        reason: "invalid_ref",
        action: "insert",
        fromRecipeId: null,
        fromMealPlanId: planId,
      });
      continue;
    }
    const plannedDate = item.plannedDate
      ?? rows.get(planId ?? -1)?.date
      ?? input.fallbackPlannedDate
      ?? null;

    if (
      item.plannedDate == null &&
      input.fallbackPlannedDate == null &&
      planId != null &&
      rows.get(planId)?.date != null
    ) {
      plannedDateFallbackCount++;
    }

    const incoming: WorkingEntry = {
      kind: "insert",
      index,
      name,
      unit: item.unit ?? null,
      quantity: item.quantity ?? null,
      plannedDate,
      fromRecipeId: link.fromRecipeId,
      fromMealPlanId: link.fromMealPlanId,
      dirty: false,
    };

    const candidates = working.filter((entry) => sameNameUnitDate(entry, incoming));
    const incomingSource = sourceOf(incoming);
    let match = candidates.find((entry) => sourceOf(entry) === incomingSource);
    if (!match) {
      match = incomingSource !== "none"
        ? candidates.find((entry) => sourceOf(entry) === "none")
        : candidates.find((entry) => sourceOf(entry) !== "none");
    }

    if (match) {
      match.quantity = mergeQty(match.quantity, incoming.quantity);
      match.fromRecipeId = mergeLink(match.fromRecipeId, incoming.fromRecipeId, "fromRecipeId", deps);
      match.fromMealPlanId = mergeLink(match.fromMealPlanId, incoming.fromMealPlanId, "fromMealPlanId", deps);
      match.dirty = true;
      reports.push({
        index,
        ok: true,
        skipped: false,
        reason: link.reason,
        action: "merge",
        fromRecipeId: match.fromRecipeId,
        fromMealPlanId: match.fromMealPlanId,
      });
      continue;
    }

    working.push(incoming);
    reports.push({
      index,
      ok: true,
      skipped: false,
      reason: link.reason,
      action: "insert",
      fromRecipeId: incoming.fromRecipeId,
      fromMealPlanId: incoming.fromMealPlanId,
    });
  }

  const inserts: PlannedShoppingInsert[] = [];
  const updates: PlannedShoppingUpdate[] = [];
  for (const entry of working) {
    if (entry.kind === "insert") {
      inserts.push({
        index: entry.index,
        name: entry.name,
        unit: entry.unit,
        quantity: entry.quantity,
        plannedDate: entry.plannedDate,
        fromRecipeId: entry.fromRecipeId,
        fromMealPlanId: entry.fromMealPlanId,
      });
    } else if (entry.dirty && entry.id != null) {
      updates.push({
        index: entry.index,
        id: entry.id,
        quantity: entry.quantity ?? "",
        fromRecipeId: entry.fromRecipeId,
        fromMealPlanId: entry.fromMealPlanId,
      });
    }
  }

  if (plannedDateFallbackCount > 0) {
    deps.metric?.("shopping_planned_date_fallback", {
      familyId: input.familyId,
      count: plannedDateFallbackCount,
    });
  }

  return { inserts, updates, reports };
}

/**
 * First insert is attempted with the full payload. The single retry keeps the
 * links too; if it also fails we surface a typed failure instead of silently
 * storing a link-less row.
 */
export async function persistShoppingItemWithRetry<T extends {
  fromRecipeId?: string | null;
  fromMealPlanId?: number | null;
}>(
  payload: T,
  insert: (row: T) => Promise<void>,
): Promise<void> {
  try {
    await insert(payload);
    return;
  } catch {
    try {
      await insert(payload);
      return;
    } catch {
      const fromRecipeId = payload.fromRecipeId ?? null;
      const fromMealPlanId = payload.fromMealPlanId ?? null;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `SHOPPING_LINK_PERSIST_FAILED fromRecipeId=${fromRecipeId} fromMealPlanId=${fromMealPlanId}`,
      });
    }
  }
}
