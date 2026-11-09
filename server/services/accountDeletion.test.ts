import assert from "node:assert/strict";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import {
  DELETED_USER_TOMBSTONE,
  REDACTED_IAP_RECEIPT,
  deleteAccount,
  isAlreadyCanceledStripeError,
  selectSubscriptionsToCancel,
  type AccountDeletionStore,
  type ClaimDeletionRequestResult,
  type DeletionFamily,
  type DeletionRequestRow,
  type DeletionStep,
  type DeletionStripeSubscription,
} from "./accountDeletion";

type PersonalRow = { userId: string; value?: string };
type FinancialRow = Record<string, unknown> & { userId?: string };

class MemoryStore implements AccountDeletionStore {
  request: DeletionRequestRow | null = null;
  families: DeletionFamily[] = [];
  subscriptions: DeletionStripeSubscription[] = [];
  personalRows: Record<string, PersonalRow[]> = {
    ai_chat_sessions: [],
    user_recipe_collections: [],
    weekly_menu: [],
    usage_events: [],
    billing_reminders: [],
    chef_query_log: [],
    ai_chef_family_safety: [],
    ai_chef_meal_state: [],
    ai_photo_usage: [],
    family_usage_monthly: [],
    users: [],
  };
  stripeRows: FinancialRow[] = [];
  iapRows: FinancialRow[] = [];
  earlybirdRows: FinancialRow[] = [];
  appleRows: FinancialRow[] = [];
  r2Queue: string[] = [];
  purgeCalls = 0;
  failedSteps: DeletionStep[] = [];

  async claimDeletionRequest(userId: string): Promise<ClaimDeletionRequestResult> {
    if (!this.request) {
      this.request = { userId, status: "pending", step: "stripe_cancel", lastError: null, attempts: 1 };
      return { kind: "claimed", request: { ...this.request } };
    }
    if (this.request.status === "completed") {
      return { kind: "completed", request: { ...this.request } };
    }
    if (this.request.status === "pending") {
      return { kind: "pending", request: { ...this.request } };
    }
    this.request = {
      ...this.request,
      status: "pending",
      step: "stripe_cancel",
      lastError: null,
      attempts: this.request.attempts + 1,
    };
    return { kind: "claimed", request: { ...this.request } };
  }

  async markDeletionFailed(userId: string, step: DeletionStep, lastError: string): Promise<void> {
    assert.equal(userId, this.request?.userId);
    this.request = {
      userId,
      status: "failed",
      step,
      lastError,
      attempts: this.request?.attempts ?? 1,
    };
    this.failedSteps.push(step);
  }

  async getDeletionContext() {
    return {
      families: this.families.map((family) => ({ ...family })),
      subscriptions: this.subscriptions.map((sub) => ({ ...sub })),
    };
  }

  async purgeAccount(params: { userId: string; families: DeletionFamily[] }): Promise<void> {
    this.purgeCalls += 1;
    const userId = params.userId;
    for (const row of this.stripeRows) {
      if (row.userId === userId) {
        row.userId = DELETED_USER_TOMBSTONE;
        row.stripeCustomerId = null;
      }
    }
    for (const row of this.iapRows) {
      if (row.userId === userId) {
        row.userId = DELETED_USER_TOMBSTONE;
        row.receipt = REDACTED_IAP_RECEIPT;
        row.purchaseToken = null;
        row.appAccountToken = null;
      }
    }
    for (const row of this.earlybirdRows) {
      if (row.userId === userId) row.userId = DELETED_USER_TOMBSTONE;
    }
    for (const rows of Object.values(this.personalRows)) {
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (rows[i].userId === userId) rows.splice(i, 1);
      }
    }
    const dissolved = params.families.filter(
      (family) => family.role === "owner" && family.otherMemberCount === 0
    );
    for (const family of dissolved) {
      this.r2Queue.push(`recipe-screenshots/f${family.familyId}/`);
    }
    this.request = {
      userId,
      status: "completed",
      step: "done",
      lastError: null,
      attempts: this.request?.attempts ?? 1,
    };
  }
}

class FakeStripe {
  calls: string[] = [];
  failWith: unknown = null;

  async cancel(subscriptionId: string) {
    this.calls.push(subscriptionId);
    if (this.failWith) throw this.failWith;
    return {};
  }
}

function deps(store: MemoryStore, stripe: FakeStripe) {
  return { store, stripe };
}

function seedSoleOwner(store: MemoryStore, overrides: Partial<DeletionFamily> = {}) {
  store.families = [{ familyId: 7, role: "owner", ownerId: "user-1", otherMemberCount: 0, ...overrides }];
}

function seedActiveSubscription(store: MemoryStore, overrides: Partial<DeletionStripeSubscription> = {}) {
  store.subscriptions = [
    {
      familyId: 7,
      userId: "user-1",
      stripeSubscriptionId: "sub_123",
      status: "active",
      ...overrides,
    },
  ];
}

function seedPersonalRows(store: MemoryStore) {
  store.personalRows.ai_chat_sessions.push({ userId: "user-1", value: "chat" });
  store.personalRows.user_recipe_collections.push({ userId: "user-1" });
  store.personalRows.weekly_menu.push({ userId: "user-1" });
  store.personalRows.usage_events.push({ userId: "user-1" });
  store.personalRows.billing_reminders.push({ userId: "user-1" });
  store.personalRows.chef_query_log.push({ userId: "user-1", value: "raw query" });
  store.personalRows.ai_chef_family_safety.push({ userId: "user-1" });
  store.personalRows.ai_chef_meal_state.push({ userId: "user-1" });
  store.personalRows.ai_photo_usage.push({ userId: "user-1" });
  store.personalRows.family_usage_monthly.push({ userId: "user-1" });
  store.personalRows.users.push({ userId: "user-1", value: "email@example.com" });
}

function seedFinancialRows(store: MemoryStore) {
  store.stripeRows.push({
    id: 1,
    userId: "user-1",
    stripeCustomerId: "cus_personal",
    stripeSubscriptionId: "sub_123",
    productId: "kindcipe_stripe_regular_monthly",
    status: "active",
  });
  store.iapRows.push({
    id: 2,
    userId: "user-1",
    transactionId: "apple_T1",
    originalTransactionId: "O1",
    productId: "kindcipe_pro_monthly",
    receipt: "personal-signed-receipt",
    purchaseToken: "personal-token",
    appAccountToken: "personal-account-token",
    transactionDate: new Date("2026-01-01"),
  });
  store.earlybirdRows.push({
    id: 3,
    userId: "user-1",
    familyId: 7,
    stripeSubscriptionId: "sub_123",
    status: "paid",
    paidAt: new Date("2026-01-01"),
  });
  store.appleRows.push({
    id: 4,
    familyId: 7,
    notificationUuid: "uuid-1",
    transactionId: "apple_T1",
    originalTransactionId: "O1",
    signedDate: new Date("2026-01-01"),
  });
}

test("cancel succeeds then the user data is purged exactly once", async () => {
  const store = new MemoryStore();
  const stripe = new FakeStripe();
  seedSoleOwner(store);
  seedActiveSubscription(store);
  seedPersonalRows(store);
  seedFinancialRows(store);

  const result = await deleteAccount("user-1", deps(store, stripe));

  assert.deepEqual(result, { success: true, alreadyDeleted: false });
  assert.deepEqual(stripe.calls, ["sub_123"]);
  assert.equal(store.purgeCalls, 1);
  for (const [table, rows] of Object.entries(store.personalRows)) {
    assert.equal(rows.length, 0, `${table} must be empty`);
  }
  assert.deepEqual(store.r2Queue, ["recipe-screenshots/f7/"]);
  assert.equal(store.request?.status, "completed");
});

test("Stripe 401 aborts before any user data is touched", async () => {
  const store = new MemoryStore();
  const stripe = new FakeStripe();
  stripe.failWith = Object.assign(new Error("Unauthorized"), {
    statusCode: 401,
    type: "StripeAuthenticationError",
  });
  seedSoleOwner(store);
  seedActiveSubscription(store);
  seedPersonalRows(store);
  seedFinancialRows(store);

  await assert.rejects(
    () => deleteAccount("user-1", deps(store, stripe)),
    (error: unknown) =>
      error instanceof TRPCError &&
      error.code === "CONFLICT" &&
      error.message.includes("未能取消訂閱")
  );

  assert.deepEqual(stripe.calls, ["sub_123"]);
  assert.equal(store.purgeCalls, 0);
  for (const [table, rows] of Object.entries(store.personalRows)) {
    assert.equal(rows.length, 1, `${table} must be untouched`);
  }
  assert.equal(store.stripeRows[0].userId, "user-1");
  assert.equal(store.iapRows[0].receipt, "personal-signed-receipt");
  assert.equal(store.request?.status, "failed");
  assert.equal(store.request?.step, "stripe_cancel");
  assert.ok(store.request?.lastError);
});

test("already-cancelled subscriptions are success and need no Stripe call", async () => {
  const store = new MemoryStore();
  const stripe = new FakeStripe();
  seedSoleOwner(store);
  seedActiveSubscription(store, { status: "canceled" });
  seedPersonalRows(store);

  const result = await deleteAccount("user-1", deps(store, stripe));

  assert.equal(result.success, true);
  assert.deepEqual(stripe.calls, []);
  assert.equal(store.purgeCalls, 1);
});

test("Stripe treating a subscription as already gone is also success", async () => {
  const store = new MemoryStore();
  const stripe = new FakeStripe();
  stripe.failWith = Object.assign(new Error("No such subscription: sub_123"), {
    statusCode: 404,
    code: "resource_missing",
  });
  seedSoleOwner(store);
  seedActiveSubscription(store);
  seedPersonalRows(store);

  const result = await deleteAccount("user-1", deps(store, stripe));

  assert.equal(result.success, true);
  assert.deepEqual(stripe.calls, ["sub_123"]);
  assert.equal(store.purgeCalls, 1);
  assert.equal(isAlreadyCanceledStripeError(stripe.failWith), true);
});

test("a member deleting their account never cancels the family subscription", async () => {
  const store = new MemoryStore();
  const stripe = new FakeStripe();
  store.families = [{ familyId: 7, role: "member", ownerId: "owner-1", otherMemberCount: 2 }];
  store.subscriptions = [
    {
      familyId: 7,
      userId: "owner-1",
      stripeSubscriptionId: "sub_family",
      status: "active",
    },
  ];
  seedPersonalRows(store);

  const result = await deleteAccount("user-1", deps(store, stripe));

  assert.equal(result.success, true);
  assert.deepEqual(stripe.calls, [], "member must not cancel the owner's subscription");
  assert.equal(store.purgeCalls, 1);
});

test("a non-owner payer may cancel that family's subscription", async () => {
  const store = new MemoryStore();
  const stripe = new FakeStripe();
  store.families = [{ familyId: 7, role: "member", ownerId: "owner-1", otherMemberCount: 2 }];
  store.subscriptions = [
    {
      familyId: 7,
      userId: "user-1",
      stripeSubscriptionId: "sub_paid_by_leaver",
      status: "past_due",
    },
  ];

  await deleteAccount("user-1", deps(store, stripe));

  assert.deepEqual(stripe.calls, ["sub_paid_by_leaver"]);
});

test("a duplicate call while pending returns the same stored error", async () => {
  const store = new MemoryStore();
  const stripe = new FakeStripe();
  store.request = {
    userId: "user-1",
    status: "pending",
    step: "stripe_cancel",
    lastError: "未能取消訂閱，帳戶未刪除，請稍後再試。",
    attempts: 1,
  };

  await assert.rejects(
    () => deleteAccount("user-1", deps(store, stripe)),
    (error: unknown) =>
      error instanceof TRPCError &&
      error.code === "CONFLICT" &&
      error.message === "未能取消訂閱，帳戶未刪除，請稍後再試。"
  );
  assert.deepEqual(stripe.calls, []);
  assert.equal(store.purgeCalls, 0);
});

test("financial rows survive with no personal identifiers", async () => {
  const store = new MemoryStore();
  const stripe = new FakeStripe();
  seedSoleOwner(store);
  seedActiveSubscription(store);
  seedPersonalRows(store);
  seedFinancialRows(store);

  await deleteAccount("user-1", deps(store, stripe));

  assert.equal(store.stripeRows.length, 1);
  assert.equal(store.stripeRows[0].userId, DELETED_USER_TOMBSTONE);
  assert.equal(store.stripeRows[0].stripeCustomerId, null);
  assert.equal(store.stripeRows[0].stripeSubscriptionId, "sub_123");
  assert.equal(store.stripeRows[0].productId, "kindcipe_stripe_regular_monthly");

  assert.equal(store.iapRows.length, 1);
  assert.equal(store.iapRows[0].userId, DELETED_USER_TOMBSTONE);
  assert.equal(store.iapRows[0].receipt, REDACTED_IAP_RECEIPT);
  assert.equal(store.iapRows[0].purchaseToken, null);
  assert.equal(store.iapRows[0].appAccountToken, null);
  assert.equal(store.iapRows[0].transactionId, "apple_T1");
  assert.equal(store.iapRows[0].originalTransactionId, "O1");

  assert.equal(store.earlybirdRows.length, 1);
  assert.equal(store.earlybirdRows[0].userId, DELETED_USER_TOMBSTONE);
  assert.equal(store.earlybirdRows[0].status, "paid");

  assert.equal(store.appleRows.length, 1);
  assert.equal(store.appleRows[0].transactionId, "apple_T1");
  assert.equal(store.appleRows[0].familyId, 7);
});

test("a second call after completion is a no-op", async () => {
  const store = new MemoryStore();
  const stripe = new FakeStripe();
  store.request = {
    userId: "user-1",
    status: "completed",
    step: "done",
    lastError: null,
    attempts: 1,
  };

  const result = await deleteAccount("user-1", deps(store, stripe));

  assert.deepEqual(result, { success: true, alreadyDeleted: true });
  assert.deepEqual(stripe.calls, []);
  assert.equal(store.purgeCalls, 0);
});

test("selection only includes active rows the user may cancel", () => {
  const families: DeletionFamily[] = [
    { familyId: 1, role: "owner", ownerId: "user-1", otherMemberCount: 0 },
    { familyId: 2, role: "owner", ownerId: "user-1", otherMemberCount: 1 },
    { familyId: 3, role: "member", ownerId: "other", otherMemberCount: 1 },
    { familyId: 4, role: "member", ownerId: "other", otherMemberCount: 1 },
  ];
  const subscriptions: DeletionStripeSubscription[] = [
    { familyId: 1, userId: "user-1", stripeSubscriptionId: "sole_owner", status: "active" },
    { familyId: 2, userId: "other", stripeSubscriptionId: "owner_not_payer", status: "active" },
    { familyId: 3, userId: "other", stripeSubscriptionId: "member_not_payer", status: "active" },
    { familyId: 4, userId: "user-1", stripeSubscriptionId: "member_payer", status: "trialing" },
    { familyId: 4, userId: "user-1", stripeSubscriptionId: "member_payer", status: "past_due" },
    { familyId: 4, userId: "user-1", stripeSubscriptionId: "already_canceled", status: "canceled" },
  ];

  assert.deepEqual(
    selectSubscriptionsToCancel({ userId: "user-1", families, subscriptions }).sort(),
    ["member_payer", "sole_owner"]
  );
});

test("a concurrent second call does not start a parallel cancellation", async () => {
  const store = new MemoryStore();
  const stripe = new FakeStripe();
  seedSoleOwner(store);
  seedActiveSubscription(store);
  seedPersonalRows(store);

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const cancel = stripe.cancel.bind(stripe);
  stripe.cancel = async (subscriptionId: string) => {
    await cancel(subscriptionId);
    await gate;
    return {};
  };

  const first = deleteAccount("user-1", deps(store, stripe));
  while (stripe.calls.length === 0) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  await assert.rejects(
    () => deleteAccount("user-1", deps(store, stripe)),
    (error: unknown) =>
      error instanceof TRPCError &&
      error.code === "CONFLICT" &&
      error.message === "帳戶刪除正在處理中，請稍後再試。"
  );
  assert.deepEqual(stripe.calls, ["sub_123"], "second call must not cancel again");

  release();
  const result = await first;
  assert.equal(result.success, true);
  assert.equal(store.purgeCalls, 1);
});
