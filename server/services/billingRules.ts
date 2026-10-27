export function isStaleBillingEvent(
  existingEventAt: Date | null | undefined,
  incomingEventAt: Date
): boolean {
  return Boolean(existingEventAt && incomingEventAt < existingEventAt);
}

export function isCanceledTrial(params: {
  trialEnd: Date | null;
  currentPeriodEnd: Date | null;
  now: Date;
}): boolean {
  const { trialEnd, currentPeriodEnd, now } = params;
  return Boolean(
    trialEnd &&
      trialEnd > now &&
      (!currentPeriodEnd ||
        Math.abs(currentPeriodEnd.getTime() - trialEnd.getTime()) < 1000)
  );
}

export function pendingCheckoutMatches(params: {
  pendingPlan: string;
  pendingTier: string;
  pendingTrialEnd: Date | null;
  plan: string;
  tier: string;
  trialEnd: Date | null;
}): boolean {
  return (
    params.pendingPlan === params.plan &&
    params.pendingTier === params.tier &&
    (params.pendingTrialEnd?.getTime() ?? null) ===
      (params.trialEnd?.getTime() ?? null)
  );
}
