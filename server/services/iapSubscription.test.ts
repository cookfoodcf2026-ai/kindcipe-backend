import assert from "node:assert/strict";
import test from "node:test";
import type { InsertIapTransaction } from "../../drizzle/schema";
import {
  IapError,
  type IapRow,
  type IapStore,
  resolveIapProduct,
  verifyIapPurchase,
  type VerifyIapParams,
} from "./iapSubscription";

function makeRow(overrides: Partial<IapRow> = {}): IapRow {
  return {
    id: 1,
    familyId: 1,
    userId: "user-1",
    productId: "kindcipe_pro_monthly",
    planType: "monthly",
    transactionId: "apple_T1",
    originalTransactionId: "O1",
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    status: "active",
    revocationDate: null,
    appAccountToken: null,
    ...overrides,
  };
}

function params(overrides: Partial<VerifyIapParams> = {}): VerifyIapParams {
  return {
    familyId: 1,
    userId: "user-1",
    appAccountToken: null,
    verified: {
      transactionId: "T1",
      originalTransactionId: "O1",
      productId: "kindcipe_pro_monthly",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      revocationDate: null,
      environment: "Production",
      appAccountToken: null,
      transactionDate: new Date(),
      receipt: "signed-receipt",
      purchaseToken: null,
    },
    ...overrides,
  };
}

class MemoryStore implements IapStore {
  rows: IapRow[] = [];
  stripeActive = false;
  activateCalls: Array<{ familyId: number; plan: string; expiresAt: Date }> = [];
  private nextId = 1;

  async hasActiveStripeSubscription() {
    return this.stripeActive;
  }
  async getByTransactionId(transactionId: string) {
    return this.rows.find((r) => r.transactionId === transactionId) ?? null;
  }
  async getByOriginalAndProduct(originalTransactionId: string, productId: string) {
    return (
      this.rows.find(
        (r) => r.originalTransactionId === originalTransactionId && r.productId === productId
      ) ?? null
    );
  }
  async getByAppAccountToken(appAccountToken: string) {
    return this.rows.find((r) => r.appAccountToken === appAccountToken) ?? null;
  }
  async insert(data: InsertIapTransaction) {
    this.rows.push(
      makeRow({
        id: this.nextId++,
        familyId: data.familyId,
        userId: String(data.userId),
        productId: data.productId,
        planType: data.planType ?? "monthly",
        transactionId: data.transactionId,
        originalTransactionId: data.originalTransactionId ?? null,
        expiresAt: (data.expiresAt as Date | null) ?? null,
        status: data.status ?? "active",
        revocationDate: (data.revocationDate as Date | null) ?? null,
        appAccountToken: data.appAccountToken ?? null,
      })
    );
  }
  async update(id: number, patch: Partial<InsertIapTransaction>) {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return;
    Object.assign(row, patch);
  }
  async activateFamily(familyId: number, plan: "monthly" | "yearly", expiresAt: Date) {
    this.activateCalls.push({ familyId, plan, expiresAt });
  }
}

test("duplicate verify does not extend twice", async () => {
  const store = new MemoryStore();
  const p = params();

  const first = await verifyIapPurchase(store, p);
  const second = await verifyIapPurchase(store, p);

  assert.equal(first.duplicate, false);
  assert.equal(first.status, "active");
  assert.equal(second.duplicate, true);
  assert.equal(second.status, "active");
  assert.equal(store.rows.length, 1, "one transaction row");
  assert.equal(store.activateCalls.length, 1, "family activated exactly once");
});

test("expired duplicate returns expired", async () => {
  const store = new MemoryStore();
  store.rows.push(
    makeRow({
      transactionId: "apple_T1",
      expiresAt: new Date(Date.now() - 60_000),
    })
  );

  const result = await verifyIapPurchase(store, params());

  assert.equal(result.duplicate, true);
  assert.equal(result.status, "expired");
  assert.equal(store.activateCalls.length, 0, "must not re-extend an expired duplicate");
});

test("mismatched appAccountToken rejected", async () => {
  const store = new MemoryStore();
  store.rows.push(
    makeRow({
      familyId: 999,
      userId: "someone-else",
      transactionId: "apple_OTHER",
      appAccountToken: "token-abc",
    })
  );

  await assert.rejects(
    () => verifyIapPurchase(store, params({ appAccountToken: "token-abc" })),
    (err: unknown) => err instanceof IapError && err.code === "APP_ACCOUNT_TOKEN_MISMATCH"
  );
  assert.equal(store.rows.length, 1, "no row inserted");
});

test("unknown appAccountToken that does not match the active family/user is rejected", async () => {
  const store = new MemoryStore();

  await assert.rejects(
    () => verifyIapPurchase(store, params({ appAccountToken: "unrelated-token" })),
    (err: unknown) => err instanceof IapError && err.code === "APP_ACCOUNT_TOKEN_MISMATCH"
  );
  assert.equal(store.rows.length, 0);
});

test("appAccountToken equal to the active user id is accepted and stored", async () => {
  const store = new MemoryStore();
  const result = await verifyIapPurchase(
    store,
    params({ userId: "user-1", appAccountToken: "user-1" })
  );

  assert.equal(result.status, "active");
  assert.equal(store.rows[0].appAccountToken, "user-1");
});

test("Stripe-active family rejected", async () => {
  const store = new MemoryStore();
  store.stripeActive = true;

  await assert.rejects(
    () => verifyIapPurchase(store, params()),
    (err: unknown) => err instanceof IapError && err.code === "ALREADY_SUBSCRIBED"
  );
  assert.equal(store.rows.length, 0);
  assert.equal(store.activateCalls.length, 0);
});

test("legacy product ids resolve to the same plans", () => {
  assert.equal(resolveIapProduct("kindcipe_monthly_30")?.productId, "kindcipe_pro_monthly");
  assert.equal(resolveIapProduct("kindcipe_monthly_30")?.plan, "monthly");
  assert.equal(resolveIapProduct("kindcipe_yearly_288")?.productId, "kindcipe_pro_yearly");
  assert.equal(resolveIapProduct("kindcipe_yearly_288")?.days, 365);
  assert.equal(resolveIapProduct("unknown_product"), null);
});

test("renewal rotates the chain row instead of inserting a second row", async () => {
  const store = new MemoryStore();
  await verifyIapPurchase(store, params());

  const renewal = params({
    verified: {
      ...params().verified,
      transactionId: "T2",
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    },
  });
  const result = await verifyIapPurchase(store, renewal);

  assert.equal(result.duplicate, false);
  assert.equal(store.rows.length, 1, "unique (originalTransactionId, productId) keeps one row");
  assert.equal(store.rows[0].transactionId, "apple_T2");
  assert.equal(store.activateCalls.length, 2, "renewal extends the subscription");
});

test("revoked purchase is stored as expired and does not activate", async () => {
  const store = new MemoryStore();
  const result = await verifyIapPurchase(
    store,
    params({
      verified: {
        ...params().verified,
        revocationDate: new Date(),
      },
    })
  );

  assert.equal(result.status, "expired");
  assert.equal(store.rows[0].status, "expired");
  assert.equal(store.activateCalls.length, 0);
});
