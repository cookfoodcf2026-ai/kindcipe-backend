import {
  countCustomRecipeUsage,
  countImportUsage,
  type QuotaScope,
} from "./recipeQuota";
import type { PlanLimits } from "./entitlementPolicy";
import { getYearMonthKey } from "./monthKey";
import {
  evaluateLimit,
  limitReachedError,
  type LimitFeature,
} from "./limitPolicy";

/** Injectable counters keep the gate testable without a database. */
export interface LimitGateDeps {
  countCustomRecipes?: (scope: QuotaScope, yearMonth: string) => Promise<number>;
  countImports?: (scope: QuotaScope, yearMonth: string) => Promise<number>;
  yearMonth?: () => string;
}

const defaultDeps: Required<LimitGateDeps> = {
  countCustomRecipes: countCustomRecipeUsage,
  countImports: countImportUsage,
  yearMonth: getYearMonthKey,
};

function assertBelowLimit(feature: LimitFeature, used: number, limit: number | null): void {
  const decision = evaluateLimit(feature, used, limit);
  if (!decision.ok) throw limitReachedError(decision);
}

/** Counts this month's create-ledger rows for the plan's scope. */
export async function assertCustomRecipeLimit(
  scope: QuotaScope,
  limits: PlanLimits,
  deps: LimitGateDeps = {}
): Promise<void> {
  if (limits.customRecipes === null) return;
  const yearMonth = (deps.yearMonth ?? defaultDeps.yearMonth)();
  const count = deps.countCustomRecipes ?? defaultDeps.countCustomRecipes;
  assertBelowLimit("custom_recipes", await count(scope, yearMonth), limits.customRecipes);
}

/** Counts this month's never-refunded import ledger for the plan's scope. */
export async function assertImportLimit(
  scope: QuotaScope,
  limits: PlanLimits,
  deps: LimitGateDeps = {}
): Promise<void> {
  const yearMonth = (deps.yearMonth ?? defaultDeps.yearMonth)();
  const count = deps.countImports ?? defaultDeps.countImports;
  assertBelowLimit("imports", await count(scope, yearMonth), limits.imports);
}
