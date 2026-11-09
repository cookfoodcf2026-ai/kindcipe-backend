/**
 * Apple IAP subscription verification — pure business logic with an injected
 * store so it can be unit-tested without a database.
 *
 * iOS v1 sells two auto-renewable subscriptions:
 *   kindcipe_pro_monthly  HK$40 / 30 days
 *   kindcipe_pro_yearly   HK$399 / 365 days
 *
 * The two pre-launch ids stay as legacy aliases so a stale client cannot break.
 */
import type { InsertIapTransaction } from "../../drizzle/schema";

export interface IapProduct {
  productId: "kindcipe_pro_monthly" | "kindcipe_pro_yearly";
  plan: "monthly" | "yearly";
  days: number;
}

export const VALID_PRODUCTS: Record<string, IapProduct> = {
  kindcipe_pro_monthly: { productId: "kindcipe_pro_monthly", plan: "monthly", days: 30 },
  kindcipe_pro_yearly: { productId: "kindcipe_pro_yearly", plan: "yearly", days: 365 },
};

export const LEGACY_PRODUCT_ALIASES: Record<string, string> = {
  kindcipe_monthly_30: "kindcipe_pro_monthly",
  kindcipe_yearly_288: "kindcipe_pro_yearly",
};

/** Resolve a product id (new or legacy alias) to its canonical product. */
export function resolveIapProduct(productId: string): IapProduct | null {
  const canonical = LEGACY_PRODUCT_ALIASES[productId] ?? productId;
  return VALID_PRODUCTS[canonical] ?? null;
}

export type IapErrorCode =
  | "INVALID_PRODUCT"
  | "APP_ACCOUNT_TOKEN_MISMATCH"
  | "ALREADY_SUBSCRIBED";

export class IapError extends Error {
  readonly code: IapErrorCode;

  constructor(code: IapErrorCode, message: string) {
    super(message);
    this.name = "IapError";
    this.code = code;
  }
}

export interface IapRow {
  id: number;
  familyId: number;
  userId: string;
  productId: string;
  planType: string;
  transactionId: string;
  originalTransactionId: string | null;
  expiresAt: Date | null;
  status: string;
  revocationDate: Date | null;
  appAccountToken: string | null;
}

export interface IapStore {
  hasActiveStripeSubscription(familyId: number): Promise<boolean>;
  getByTransactionId(transactionId: string): Promise<IapRow | null>;
  getByOriginalAndProduct(
    originalTransactionId: string,
    productId: string
  ): Promise<IapRow | null>;
  getByAppAccountToken(appAccountToken: string): Promise<IapRow | null>;
  insert(data: InsertIapTransaction): Promise<void>;
  update(id: number, patch: Partial<InsertIapTransaction>): Promise<void>;
  activateFamily(familyId: number, plan: "monthly" | "yearly", expiresAt: Date): Promise<void>;
}

export interface VerifiedIapPurchase {
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  expiresAt: Date | null;
  revocationDate: Date | null;
  environment: string | null;
  appAccountToken: string | null;
  transactionDate: Date;
  receipt: string;
  purchaseToken: string | null;
}

export interface VerifyIapParams {
  familyId: number;
  userId: string;
  /** Token supplied by the client (may also come from the signed transaction). */
  appAccountToken?: string | null;
  verified: VerifiedIapPurchase;
}

export interface VerifyIapResult {
  status: "active" | "expired";
  plan: "monthly" | "yearly";
  expiresAt: string | null;
  duplicate: boolean;
}

function normalizeToken(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function duplicateResult(row: IapRow, now: Date): VerifyIapResult {
  const plan = row.planType === "yearly" ? "yearly" : "monthly";
  const revoked =
    row.revocationDate != null ||
    row.status === "expired" ||
    row.status === "revoked" ||
    row.status === "refunded";
  const pastExpiry = row.expiresAt != null && row.expiresAt.getTime() <= now.getTime();
  return {
    status: revoked || pastExpiry ? "expired" : "active",
    plan,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    duplicate: true,
  };
}

/**
 * Verify + persist an IAP purchase.
 *
 * Idempotent by transactionId: replaying the same signed transaction never
 * extends the subscription twice. Renewals carry a new transactionId but share
 * originalTransactionId + productId, so the existing row is rotated rather than
 * inserted (matching the unique index on that pair).
 */
export async function verifyIapPurchase(
  store: IapStore,
  params: VerifyIapParams
): Promise<VerifyIapResult> {
  const { familyId, userId, verified } = params;
  const product = resolveIapProduct(verified.productId);
  if (!product) {
    throw new IapError("INVALID_PRODUCT", "未知產品 ID");
  }

  const now = new Date();
  const clientToken = normalizeToken(params.appAccountToken);
  const signedToken = normalizeToken(verified.appAccountToken);
  if (clientToken && signedToken && clientToken !== signedToken) {
    throw new IapError("APP_ACCOUNT_TOKEN_MISMATCH", "appAccountToken 不符");
  }
  const appAccountToken = clientToken ?? signedToken;

  // Bind the purchase to one family/user. A token already used by another
  // kitchen means the receipt is being replayed across accounts; an unknown
  // token that does not identify the active family/user is rejected too.
  if (appAccountToken) {
    const bound = await store.getByAppAccountToken(appAccountToken);
    if (bound) {
      if (bound.familyId !== familyId || String(bound.userId) !== String(userId)) {
        throw new IapError("APP_ACCOUNT_TOKEN_MISMATCH", "appAccountToken 已綁定其他廚房");
      }
    } else if (
      appAccountToken !== String(familyId) &&
      appAccountToken !== String(userId)
    ) {
      throw new IapError("APP_ACCOUNT_TOKEN_MISMATCH", "appAccountToken 與目前廚房不符");
    }
  }

  const transactionId = `apple_${verified.transactionId}`;

  // Same transaction replayed → return the real state, never a blind "active".
  const duplicate = await store.getByTransactionId(transactionId);
  if (duplicate) {
    return duplicateResult(duplicate, now);
  }

  // Never double-charge a family that already pays through Stripe.
  if (await store.hasActiveStripeSubscription(familyId)) {
    throw new IapError("ALREADY_SUBSCRIBED", "廚房已有生效中的網頁訂閱");
  }

  const expiresAt = verified.revocationDate
    ? null
    : verified.expiresAt ?? new Date(now.getTime() + product.days * 24 * 60 * 60 * 1000);
  const status =
    verified.revocationDate || (expiresAt != null && expiresAt.getTime() <= now.getTime())
      ? "expired"
      : "active";

  const patch: Partial<InsertIapTransaction> = {
    familyId,
    userId: String(userId),
    productId: product.productId,
    planType: product.plan,
    receipt: verified.receipt,
    purchaseToken: verified.purchaseToken,
    transactionId,
    originalTransactionId: verified.originalTransactionId,
    transactionDate: verified.transactionDate,
    expiresAt,
    status,
    environment: verified.environment,
    revocationDate: verified.revocationDate,
    appAccountToken,
    updatedAt: now,
  };

  // Renewal / replay of the same chain: rotate the existing row so the unique
  // (originalTransactionId, productId) index never blocks a genuine renewal.
  const chain = verified.originalTransactionId
    ? await store.getByOriginalAndProduct(verified.originalTransactionId, product.productId)
    : null;

  if (chain) {
    await store.update(chain.id, patch);
  } else {
    await store.insert(patch as InsertIapTransaction);
  }

  if (status === "active") {
    await store.activateFamily(familyId, product.plan, expiresAt as Date);
  }

  return {
    status,
    plan: product.plan,
    expiresAt: expiresAt?.toISOString() ?? null,
    duplicate: false,
  };
}
