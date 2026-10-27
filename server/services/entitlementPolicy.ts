export const DAY_MS = 24 * 60 * 60 * 1000;
export const MEMBER_GRACE_MS = 3 * DAY_MS;

export type PlanStatus = "free" | "trial" | "active" | "expired";
export type PlanKey = "free" | "trial" | "pro";

export interface PlanLimits {
  aiCredits: number;
  imports: number;
  customRecipes: number | null;
  members: number;
}

export const PLAN_LIMITS: Record<PlanKey, PlanLimits> = {
  free: { aiCredits: 15, imports: 5, customRecipes: 5, members: 2 },
  trial: { aiCredits: 50, imports: 20, customRecipes: null, members: 4 },
  pro: { aiCredits: 250, imports: 100, customRecipes: null, members: 4 },
};

export function isPaidStatus(status: PlanStatus): boolean {
  return status === "trial" || status === "active";
}

export function planKeyForStatus(status: PlanStatus): PlanKey {
  if (status === "active") return "pro";
  if (status === "trial") return "trial";
  return "free";
}

export function limitsForStatus(status: PlanStatus): PlanLimits {
  return PLAN_LIMITS[planKeyForStatus(status)];
}

export function memberGraceEndsAt(params: {
  status: PlanStatus;
  trialEndsAt: Date | null | undefined;
  subscriptionExpiresAt: Date | null | undefined;
  memberCount: number;
}): Date | null {
  if (isPaidStatus(params.status)) return null;
  if (params.memberCount <= PLAN_LIMITS.free.members) return null;
  const expiredAt = params.subscriptionExpiresAt ?? params.trialEndsAt;
  if (!expiredAt) return null;
  return new Date(expiredAt.getTime() + MEMBER_GRACE_MS);
}

export function aiPlanCreditCost(status: PlanStatus): number {
  return isPaidStatus(status) ? 0 : 1;
}
