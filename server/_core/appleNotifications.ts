/**
 * Apple App Store Server Notifications V2 — POST /api/apple/notifications
 *
 * Apple signs the whole notification as a JWS (`signedPayload`). We verify it
 * with the same ES256 + Apple root CA chain check used for signed transactions
 * (see appleIap.ts), then update the family subscription from the event.
 *
 * notificationUUID is stored in `apple_notifications` (unique) so a replayed
 * notification is a no-op. Unknown event types are logged and acknowledged
 * with 200 so Apple does not retry them forever.
 */
import type { Express, Request, Response } from "express";
import type { InsertAppleNotification, InsertIapTransaction } from "../../drizzle/schema";
import { verifyJws } from "./appleIap";
import {
  activateFamilySubscription,
  expireFamilySubscription,
  getAppleNotificationByUuid,
  getIapTransactionByOriginalAndProduct,
  getIapTransactionByOriginalTransactionId,
  insertAppleNotification,
  updateIapTransaction,
} from "../db";
import { type IapRow, resolveIapProduct } from "../services/iapSubscription";

export interface AppleNotificationTransaction {
  transactionId?: string;
  originalTransactionId?: string;
  productId?: string;
  expiresDate?: number;
  revocationDate?: number;
  environment?: string;
  appAccountToken?: string;
  bundleId?: string;
}

export interface AppleNotificationPayload {
  notificationType: string;
  subtype?: string;
  notificationUUID: string;
  signedDate?: number;
  version?: string;
  data?: {
    appAppleId?: number;
    bundleId?: string;
    environment?: string;
    signedTransactionInfo?: string;
    signedRenewalInfo?: string;
    status?: number;
  };
}

export type FamilySubscriptionStatus = "active" | "expired";

export interface NotificationMapping {
  /** New family subscription status, or null when the event is not actionable. */
  familyStatus: FamilySubscriptionStatus | null;
  /** Status persisted on the iap_transactions row. */
  txnStatus: string | null;
}

/**
 * Map an Apple notification to our subscription state.
 *
 * - SUBSCRIBED / DID_RENEW / DID_CHANGE_* keep entitlement active
 * - DID_FAIL_TO_RENEW stays active while Apple retries (incl. grace period)
 * - GRACE_PERIOD_EXPIRED / EXPIRED / REFUND / REVOKE remove entitlement
 * - REFUND_REVERSED restores it
 */
export function mapAppleNotification(
  notificationType: string,
  subtype?: string | null
): NotificationMapping {
  switch (notificationType) {
    case "SUBSCRIBED":
    case "DID_RENEW":
    case "DID_CHANGE_RENEWAL_STATUS":
    case "DID_CHANGE_RENEWAL_PREF":
      return { familyStatus: "active", txnStatus: "active" };
    case "DID_FAIL_TO_RENEW":
      return subtype === "GRACE_PERIOD_EXPIRED"
        ? { familyStatus: "expired", txnStatus: "expired" }
        : { familyStatus: "active", txnStatus: "billing_retry" };
    case "GRACE_PERIOD_EXPIRED":
    case "EXPIRED":
      return { familyStatus: "expired", txnStatus: "expired" };
    case "REFUND":
      return { familyStatus: "expired", txnStatus: "refunded" };
    case "REFUND_REVERSED":
      return { familyStatus: "active", txnStatus: "active" };
    case "REVOKE":
      return { familyStatus: "expired", txnStatus: "revoked" };
    default:
      return { familyStatus: null, txnStatus: null };
  }
}

export interface AppleNotificationDeps {
  verifyJws<T>(jws: string): T;
  getNotificationByUuid(notificationUuid: string): Promise<{ id: number } | null>;
  insertNotification(data: InsertAppleNotification): Promise<void>;
  getIapByOriginalTransactionId(originalTransactionId: string): Promise<IapRow | null>;
  getIapByOriginalAndProduct(
    originalTransactionId: string,
    productId: string
  ): Promise<IapRow | null>;
  updateIap(id: number, patch: Partial<InsertIapTransaction>): Promise<void>;
  activateFamily(familyId: number, plan: "monthly" | "yearly", expiresAt: Date): Promise<void>;
  expireFamily(familyId: number): Promise<void>;
}

function parseMs(value: number | undefined | null): Date | null {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value) : null;
}

export function createAppleNotificationsHandler(deps: AppleNotificationDeps) {
  return async (req: Request, res: Response) => {
    const signedPayload = (req.body as { signedPayload?: unknown } | undefined)?.signedPayload;
    if (typeof signedPayload !== "string" || signedPayload.length === 0) {
      res.status(400).json({ error: "signedPayload required" });
      return;
    }

    let payload: AppleNotificationPayload;
    try {
      payload = deps.verifyJws<AppleNotificationPayload>(signedPayload);
    } catch (err) {
      console.error("[apple] notification signature failed:", (err as Error).message);
      res.status(400).json({ error: "invalid signature" });
      return;
    }

    const notificationUuid = payload.notificationUUID;
    if (!notificationUuid) {
      res.status(400).json({ error: "missing notificationUUID" });
      return;
    }

    try {
      // Replay protection: the first delivery wins, later ones are no-ops.
      const seen = await deps.getNotificationByUuid(notificationUuid);
      if (seen) {
        console.log(`[apple] duplicate notification uuid=${notificationUuid}`);
        res.json({ received: true, duplicate: true });
        return;
      }

      const notificationType = payload.notificationType;
      const subtype = payload.subtype ?? null;
      const mapping = mapAppleNotification(notificationType, subtype);

      let txn: AppleNotificationTransaction | null = null;
      if (payload.data?.signedTransactionInfo) {
        try {
          txn = deps.verifyJws<AppleNotificationTransaction>(
            payload.data.signedTransactionInfo
          );
        } catch (err) {
          console.warn(
            `[apple] signedTransactionInfo rejected uuid=${notificationUuid}:`,
            (err as Error).message
          );
          txn = null;
        }
      }

      const environment = txn?.environment ?? payload.data?.environment ?? null;
      const signedDate = parseMs(payload.signedDate);

      // Unknown notifications are acknowledged (200) after being recorded.
      if (!mapping.familyStatus) {
        console.warn(
          `[apple] unknown notification type=${notificationType} subtype=${subtype ?? "-"} uuid=${notificationUuid}`
        );
        await deps.insertNotification({
          notificationUuid,
          notificationType,
          subtype,
          environment,
          status: null,
          signedDate,
        });
        res.json({ received: true, ignored: true });
        return;
      }

      let iap: IapRow | null = null;
      if (txn?.originalTransactionId) {
        if (txn.productId) {
          iap = await deps.getIapByOriginalAndProduct(txn.originalTransactionId, txn.productId);
        }
        if (!iap) {
          iap = await deps.getIapByOriginalTransactionId(txn.originalTransactionId);
        }
      }

      if (!iap) {
        // The purchase may not be verified yet (or belongs to another server).
        // Record it and acknowledge so Apple does not retry forever.
        console.warn(
          `[apple] no iap transaction uuid=${notificationUuid} original=${txn?.originalTransactionId ?? "?"}`
        );
        await deps.insertNotification({
          notificationUuid,
          notificationType,
          subtype,
          originalTransactionId: txn?.originalTransactionId ?? null,
          transactionId: txn?.transactionId ? `apple_${txn.transactionId}` : null,
          environment,
          status: mapping.familyStatus,
          signedDate,
        });
        res.json({ received: true, skipped: true });
        return;
      }

      const expiresAt = parseMs(txn?.expiresDate) ?? iap.expiresAt;
      const revocationDate = parseMs(txn?.revocationDate) ?? iap.revocationDate;
      const transactionId = txn?.transactionId
        ? `apple_${txn.transactionId}`
        : iap.transactionId;

      await deps.updateIap(iap.id, {
        transactionId,
        originalTransactionId: txn?.originalTransactionId ?? iap.originalTransactionId,
        expiresAt,
        status: mapping.txnStatus ?? iap.status,
        environment,
        revocationDate,
        updatedAt: new Date(),
      });

      if (mapping.familyStatus === "active") {
        const product = resolveIapProduct(txn?.productId ?? iap.productId);
        const plan =
          iap.planType === "yearly" || product?.plan === "yearly" ? "yearly" : "monthly";
        const activeUntil =
          expiresAt ?? new Date(Date.now() + (product?.days ?? 30) * 24 * 60 * 60 * 1000);
        await deps.activateFamily(iap.familyId, plan, activeUntil);
      } else {
        await deps.expireFamily(iap.familyId);
      }

      await deps.insertNotification({
        notificationUuid,
        notificationType,
        subtype,
        familyId: iap.familyId,
        originalTransactionId: txn?.originalTransactionId ?? iap.originalTransactionId,
        transactionId,
        environment,
        status: mapping.familyStatus,
        signedDate,
      });

      console.log(
        `[apple] notification ok type=${notificationType} uuid=${notificationUuid} status=${mapping.familyStatus}`
      );
      res.json({ received: true });
    } catch (err) {
      console.error(
        `[apple] notification failed uuid=${notificationUuid} reason=${(err as Error).message}`
      );
      res.status(500).json({ error: "notification handler failed" });
    }
  };
}

export function registerAppleNotifications(app: Express) {
  app.post(
    "/api/apple/notifications",
    createAppleNotificationsHandler({
      verifyJws,
      getNotificationByUuid: getAppleNotificationByUuid,
      insertNotification: insertAppleNotification,
      getIapByOriginalTransactionId: getIapTransactionByOriginalTransactionId,
      getIapByOriginalAndProduct: getIapTransactionByOriginalAndProduct,
      updateIap: updateIapTransaction,
      activateFamily: activateFamilySubscription,
      expireFamily: expireFamilySubscription,
    })
  );
}
