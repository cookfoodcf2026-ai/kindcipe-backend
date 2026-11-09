import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import type { InsertAppleNotification, InsertIapTransaction } from "../../drizzle/schema";
import {
  createAppleNotificationsHandler,
  mapAppleNotification,
  type AppleNotificationDeps,
  type AppleNotificationPayload,
  type AppleNotificationTransaction,
} from "./appleNotifications";
import type { IapRow } from "../services/iapSubscription";

const IAP_ROW: IapRow = {
  id: 1,
  familyId: 42,
  userId: "user-42",
  productId: "kindcipe_pro_monthly",
  planType: "monthly",
  transactionId: "apple_T1",
  originalTransactionId: "O1",
  expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  status: "active",
  revocationDate: null,
  appAccountToken: null,
};

const TXN: AppleNotificationTransaction = {
  transactionId: "T1",
  originalTransactionId: "O1",
  productId: "kindcipe_pro_monthly",
  expiresDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
  environment: "Production",
};

function payload(type: string, uuid: string, subtype?: string): AppleNotificationPayload {
  return {
    notificationType: type,
    subtype,
    notificationUUID: uuid,
    signedDate: Date.now(),
    data: { environment: "Production", signedTransactionInfo: "txn" },
  };
}

function fakeRequest(body: unknown): Request {
  return { body } as unknown as Request;
}

function fakeResponse() {
  const result = { statusCode: 200, body: undefined as unknown };
  const res = {
    status(code: number) {
      result.statusCode = code;
      return res;
    },
    json(body: unknown) {
      result.body = body;
      return res;
    },
  };
  return { res: res as unknown as Response, result };
}

function captureConsole() {
  const lines: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  const record = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "));
  };
  console.log = record;
  console.warn = record;
  console.error = record;
  return {
    lines,
    restore() {
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
    },
  };
}

interface Harness {
  deps: AppleNotificationDeps;
  activated: Array<{ familyId: number; plan: string; expiresAt: Date }>;
  expired: number[];
  updated: Array<{ id: number; patch: Partial<InsertIapTransaction> }>;
  notifications: InsertAppleNotification[];
}

function harness(options: {
  payload: AppleNotificationPayload;
  existingNotifications?: InsertAppleNotification[];
  iap?: IapRow | null;
}): Harness {
  const activated: Harness["activated"] = [];
  const expired: Harness["expired"] = [];
  const updated: Harness["updated"] = [];
  const notifications: InsertAppleNotification[] = [...(options.existingNotifications ?? [])];

  const deps: AppleNotificationDeps = {
    verifyJws: <T,>(jws: string): T => {
      if (jws === "txn") return TXN as unknown as T;
      return options.payload as unknown as T;
    },
    getNotificationByUuid: async (uuid) =>
      notifications.find((n) => n.notificationUuid === uuid) ? { id: 1 } : null,
    insertNotification: async (data) => {
      notifications.push(data);
    },
    getIapByOriginalTransactionId: async () => options.iap === undefined ? IAP_ROW : options.iap,
    getIapByOriginalAndProduct: async () => options.iap === undefined ? IAP_ROW : options.iap,
    updateIap: async (id, patch) => {
      updated.push({ id, patch });
    },
    activateFamily: async (familyId, plan, expiresAt) => {
      activated.push({ familyId, plan, expiresAt });
    },
    expireFamily: async (familyId) => {
      expired.push(familyId);
    },
  };

  return { deps, activated, expired, updated, notifications };
}

const FAMILY_STATUS_CASES: Array<[string, string | undefined, "active" | "expired"]> = [
  ["SUBSCRIBED", undefined, "active"],
  ["DID_RENEW", undefined, "active"],
  ["DID_CHANGE_RENEWAL_STATUS", undefined, "active"],
  ["DID_CHANGE_RENEWAL_PREF", undefined, "active"],
  ["DID_FAIL_TO_RENEW", undefined, "active"],
  ["DID_FAIL_TO_RENEW", "GRACE_PERIOD_EXPIRED", "expired"],
  ["GRACE_PERIOD_EXPIRED", undefined, "expired"],
  ["EXPIRED", undefined, "expired"],
  ["REFUND", undefined, "expired"],
  ["REFUND_REVERSED", undefined, "active"],
  ["REVOKE", undefined, "expired"],
];

test("each notification type maps to the right family status", () => {
  for (const [type, subtype, expected] of FAMILY_STATUS_CASES) {
    assert.equal(
      mapAppleNotification(type, subtype).familyStatus,
      expected,
      `${type}${subtype ? `/${subtype}` : ""}`
    );
  }
});

test("each notification type applies the right family action", async () => {
  for (const [type, subtype, expected] of FAMILY_STATUS_CASES) {
    const uuid = `uuid-${type}-${subtype ?? "none"}`;
    const h = harness({ payload: payload(type, uuid, subtype) });
    const handler = createAppleNotificationsHandler(h.deps);
    const { res, result } = fakeResponse();
    const logs = captureConsole();
    try {
      await handler(fakeRequest({ signedPayload: "outer" }), res);
    } finally {
      logs.restore();
    }

    assert.equal(result.statusCode, 200, `${type} must return 200`);
    assert.deepEqual(result.body, { received: true }, `${type} ack`);
    if (expected === "active") {
      assert.equal(h.activated.length, 1, `${type} activates`);
      assert.equal(h.activated[0].familyId, 42);
      assert.equal(h.expired.length, 0, `${type} does not expire`);
    } else {
      assert.deepEqual(h.expired, [42], `${type} expires`);
      assert.equal(h.activated.length, 0, `${type} does not activate`);
    }
    assert.equal(h.updated.length, 1, `${type} persists the txn`);
    assert.equal(h.notifications.length, 1, `${type} records the uuid`);
  }
});

test("replayed notificationUUID is a no-op", async () => {
  const uuid = "uuid-replay";
  const payloadData = payload("DID_RENEW", uuid);
  const existing: InsertAppleNotification = {
    notificationUuid: uuid,
    notificationType: "DID_RENEW",
    status: "active",
  };
  const h = harness({ payload: payloadData, existingNotifications: [existing] });
  const handler = createAppleNotificationsHandler(h.deps);
  const { res, result } = fakeResponse();
  const logs = captureConsole();
  try {
    await handler(fakeRequest({ signedPayload: "outer" }), res);
  } finally {
    logs.restore();
  }

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { received: true, duplicate: true });
  assert.equal(h.activated.length, 0, "no re-activation");
  assert.equal(h.expired.length, 0, "no expiry");
  assert.equal(h.updated.length, 0, "no row update");
  assert.equal(h.notifications.length, 1, "no second row");
});

test("unknown notification type is logged and acknowledged with 200", async () => {
  const h = harness({ payload: payload("SOMETHING_NEW", "uuid-unknown") });
  const handler = createAppleNotificationsHandler(h.deps);
  const { res, result } = fakeResponse();
  const logs = captureConsole();
  try {
    await handler(fakeRequest({ signedPayload: "outer" }), res);
  } finally {
    logs.restore();
  }

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { received: true, ignored: true });
  assert.equal(h.activated.length, 0);
  assert.equal(h.expired.length, 0);
  assert.ok(
    logs.lines.some((line) => line.includes("unknown notification type=SOMETHING_NEW")),
    `expected unknown-type log, got: ${logs.lines.join(" | ")}`
  );
});

test("invalid signature returns 400", async () => {
  const h = harness({ payload: payload("DID_RENEW", "uuid-bad-sig") });
  h.deps.verifyJws = () => {
    throw new Error("JWS signature verification failed");
  };
  const handler = createAppleNotificationsHandler(h.deps);
  const { res, result } = fakeResponse();
  const logs = captureConsole();
  try {
    await handler(fakeRequest({ signedPayload: "outer" }), res);
  } finally {
    logs.restore();
  }

  assert.equal(result.statusCode, 400);
  assert.deepEqual(result.body, { error: "invalid signature" });
  assert.equal(h.notifications.length, 0, "unverified payload is never stored");
});

test("missing signedPayload returns 400", async () => {
  const h = harness({ payload: payload("DID_RENEW", "uuid-missing") });
  const handler = createAppleNotificationsHandler(h.deps);
  const { res, result } = fakeResponse();
  await handler(fakeRequest({}), res);
  assert.equal(result.statusCode, 400);
});

test("notification for an unknown transaction is acknowledged, not retried", async () => {
  const h = harness({ payload: payload("DID_RENEW", "uuid-orphan"), iap: null });
  const handler = createAppleNotificationsHandler(h.deps);
  const { res, result } = fakeResponse();
  const logs = captureConsole();
  try {
    await handler(fakeRequest({ signedPayload: "outer" }), res);
  } finally {
    logs.restore();
  }

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { received: true, skipped: true });
  assert.equal(h.notifications.length, 1, "records the uuid for replay protection");
  assert.equal(h.updated.length, 0);
});
