/**
 * Account deletion orchestration.
 *
 * Money first: cancel every Stripe subscription this user is allowed to
 * cancel, then purge everything in ONE database transaction. If Stripe fails
 * we abort before touching user data so nothing is half-deleted and the client
 * can retry. The store is injected so the whole flow is testable without a
 * database or the live Stripe API.
 */
import { TRPCError } from "@trpc/server";

/** Every retained financial row is moved to this non-personal user id. */
export const DELETED_USER_TOMBSTONE = "deleted-user";

/** Apple receipts are personal payloads; only the accounting fields survive. */
export const REDACTED_IAP_RECEIPT = "[redacted]";

export const ACTIVE_STRIPE_STATUSES = ["active", "trialing", "past_due"] as const;

export type DeletionRequestStatus = "pending" | "completed" | "failed";
export type DeletionStep = "stripe_cancel" | "purge" | "done";

export interface DeletionRequestRow {
  userId: string;
  status: DeletionRequestStatus;
  step: DeletionStep | null;
  lastError: string | null;
  attempts: number;
}

export interface DeletionFamily {
  familyId: number;
  role: string;
  ownerId: string;
  otherMemberCount: number;
}

export interface DeletionStripeSubscription {
  familyId: number;
  userId: string;
  stripeSubscriptionId: string;
  status: string;
}

export type ClaimDeletionRequestResult = {
  kind: "claimed" | "pending" | "completed";
  request: DeletionRequestRow;
};

export interface AccountDeletionStore {
  /** Atomically claim the user's request. A concurrent caller gets `pending`. */
  claimDeletionRequest(userId: string): Promise<ClaimDeletionRequestResult>;
  markDeletionFailed(userId: string, step: DeletionStep, lastError: string): Promise<void>;
  getDeletionContext(userId: string): Promise<{
    families: DeletionFamily[];
    subscriptions: DeletionStripeSubscription[];
  }>;
  /** One transaction: pseudonymise financials, purge personal rows, then family. */
  purgeAccount(params: { userId: string; families: DeletionFamily[] }): Promise<void>;
}

export interface StripeSubscriptionCanceler {
  cancel(subscriptionId: string): Promise<unknown>;
}

export interface DeleteAccountDeps {
  store: AccountDeletionStore;
  stripe: StripeSubscriptionCanceler;
}

export interface DeleteAccountResult {
  success: true;
  alreadyDeleted: boolean;
}

const PENDING_MESSAGE = "帳戶刪除正在處理中，請稍後再試。";
const STRIPE_FAILED_MESSAGE = "未能取消訂閱，帳戶未刪除，請稍後再試。";
const PURGE_FAILED_MESSAGE = "刪除資料時出錯，請稍後再試。";

function retryable(message: string): TRPCError {
  return new TRPCError({ code: "CONFLICT", message });
}

function stripeErrorStatus(error: unknown): number | undefined {
  const value = (error as { statusCode?: unknown; status?: unknown })?.statusCode ??
    (error as { status?: unknown })?.status;
  return typeof value === "number" ? value : undefined;
}

function stripeErrorCode(error: unknown): string | undefined {
  const value = (error as { code?: unknown })?.code;
  return typeof value === "string" ? value : undefined;
}

function stripeErrorType(error: unknown): string | undefined {
  const value = (error as { type?: unknown })?.type;
  return typeof value === "string" ? value : undefined;
}

function stripeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Stripe says "nothing left to cancel" in a few ways (404 / resource_missing,
 * or a message about an already-cancelled subscription). Those mean success.
 */
export function isAlreadyCanceledStripeError(error: unknown): boolean {
  if (stripeErrorCode(error) === "resource_missing") return true;
  if (stripeErrorStatus(error) === 404) return true;
  return /already (been )?cancel|no such subscription|canceled subscription|incomplete_expired/i.test(
    stripeErrorMessage(error)
  );
}

/** 401, timeouts and network failures are the retryable abort cases. */
export function isRetryableStripeError(error: unknown): boolean {
  const status = stripeErrorStatus(error);
  const type = stripeErrorType(error);
  if (status === 401) return true;
  if (type === "StripeAuthenticationError" || type === "StripeConnectionError") return true;
  if (stripeErrorCode(error) === "timeout") return true;
  return /timeout|timed out|network|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(
    stripeErrorMessage(error)
  );
}

function isSoleOwner(family: DeletionFamily): boolean {
  return family.role === "owner" && family.otherMemberCount === 0;
}

function isPayer(family: DeletionFamily, subscriptions: DeletionStripeSubscription[], userId: string): boolean {
  return subscriptions.some((sub) => sub.familyId === family.familyId && sub.userId === userId);
}

/**
 * The only subscriptions we may cancel: the user is the sole owner of that
 * family, or the user pays for that family. A member leaving a family must
 * never cancel the family's subscription.
 */
export function selectSubscriptionsToCancel(params: {
  userId: string;
  families: DeletionFamily[];
  subscriptions: DeletionStripeSubscription[];
}): string[] {
  const activeStatuses = new Set<string>(ACTIVE_STRIPE_STATUSES);
  const ids = new Set<string>();
  for (const family of params.families) {
    if (!isSoleOwner(family) && !isPayer(family, params.subscriptions, params.userId)) continue;
    for (const sub of params.subscriptions) {
      if (sub.familyId !== family.familyId) continue;
      if (!sub.stripeSubscriptionId) continue;
      if (!activeStatuses.has(sub.status)) continue;
      ids.add(sub.stripeSubscriptionId);
    }
  }
  return [...ids];
}

export async function deleteAccount(
  userId: string,
  deps: DeleteAccountDeps
): Promise<DeleteAccountResult> {
  const claim = await deps.store.claimDeletionRequest(userId);
  if (claim.kind === "completed") {
    return { success: true, alreadyDeleted: true };
  }
  if (claim.kind === "pending") {
    throw retryable(claim.request.lastError ?? PENDING_MESSAGE);
  }

  let families: DeletionFamily[];
  let subscriptions: DeletionStripeSubscription[];
  try {
    const context = await deps.store.getDeletionContext(userId);
    families = context.families;
    subscriptions = context.subscriptions;
  } catch (error) {
    const message = stripeErrorMessage(error);
    await deps.store.markDeletionFailed(userId, "stripe_cancel", message);
    console.error("[account-deletion] context lookup failed", message);
    throw retryable(STRIPE_FAILED_MESSAGE);
  }

  const subscriptionIds = selectSubscriptionsToCancel({ userId, families, subscriptions });
  for (const subscriptionId of subscriptionIds) {
    try {
      await deps.stripe.cancel(subscriptionId);
    } catch (error) {
      if (isAlreadyCanceledStripeError(error)) {
        console.warn(`[account-deletion] subscription already inactive id=${subscriptionId}`);
        continue;
      }
      const message = stripeErrorMessage(error);
      await deps.store.markDeletionFailed(userId, "stripe_cancel", message);
      console.error(
        `[account-deletion] stripe cancel aborted id=${subscriptionId} retryable=${isRetryableStripeError(error)} reason=${message}`
      );
      throw retryable(STRIPE_FAILED_MESSAGE);
    }
  }

  try {
    await deps.store.purgeAccount({ userId, families });
  } catch (error) {
    const message = stripeErrorMessage(error);
    await deps.store.markDeletionFailed(userId, "purge", message);
    console.error("[account-deletion] purge failed", message);
    throw retryable(PURGE_FAILED_MESSAGE);
  }

  return { success: true, alreadyDeleted: false };
}
