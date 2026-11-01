import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import type Stripe from "stripe";
import { TRPCError } from "@trpc/server";
import {
  createStripeWebhookHandler,
  type StripeWebhookDeps,
} from "./stripeWebhook";
import {
  expireCheckoutSession,
  syncCheckoutSession,
  syncInvoicePaid,
  syncSubscription,
} from "../services/stripeBilling";

function checkoutEvent(
  session: Partial<Stripe.Checkout.Session>
): Stripe.Event {
  return {
    id: "evt_test_checkout",
    type: "checkout.session.completed",
    created: 1_700_000_000,
    data: { object: session },
  } as unknown as Stripe.Event;
}

function subscriptionEvent(
  sub: Partial<Stripe.Subscription>
): Stripe.Event {
  return {
    id: "evt_test_subscription",
    type: "customer.subscription.updated",
    created: 1_700_000_000,
    data: { object: sub },
  } as unknown as Stripe.Event;
}

function invoiceEvent(invoice: Record<string, unknown>): Stripe.Event {
  return {
    id: "evt_test_invoice",
    type: "invoice.paid",
    created: 1_700_000_000,
    data: { object: invoice },
  } as unknown as Stripe.Event;
}

function fakeRequest(event: Stripe.Event): Request {
  return {
    body: Buffer.from(JSON.stringify(event)),
    headers: { "stripe-signature": "t=1,v1=test" },
  } as unknown as Request;
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
    send(body: unknown) {
      result.body = body;
      return res;
    },
  };
  return { res: res as unknown as Response, result };
}

function captureConsole() {
  const lines: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const record = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "));
  };
  console.log = record;
  console.warn = record;
  console.error = record;
  return {
    lines,
    restore() {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    },
  };
}

function depsFor(
  event: Stripe.Event,
  overrides: Partial<StripeWebhookDeps> = {}
): StripeWebhookDeps {
  return {
    webhookSecret: "whsec_test",
    constructEvent: () => event,
    getFamilyById: async (familyId) => ({ id: familyId }),
    findFamilyIdBySubscriptionId: async () => null,
    syncCheckoutSession,
    syncSubscription,
    syncInvoicePaid,
    expireCheckoutSession,
    ...overrides,
  };
}

test("checkout.session.completed without metadata is skipped with 200", async () => {
  const event = checkoutEvent({
    id: "cs_test_no_metadata",
    metadata: {},
    client_reference_id: null,
    payment_status: "paid",
    subscription: null,
  });
  let lookups = 0;
  const handler = createStripeWebhookHandler(
    depsFor(event, {
      getFamilyById: async (familyId) => {
        lookups += 1;
        return { id: familyId };
      },
    })
  );
  const { res, result } = fakeResponse();
  const logs = captureConsole();
  try {
    await handler(fakeRequest(event), res);
  } finally {
    logs.restore();
  }

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { received: true, skipped: true });
  assert.equal(lookups, 0);
  assert.ok(
    logs.lines.some(
      (line) =>
        line ===
        "[stripe] skipped event=checkout.session.completed id=evt_test_checkout reason=no_family_ref"
    ),
    `expected skip log, got: ${logs.lines.join(" | ")}`
  );
});

test("checkout with familyId but missing family returns 500 without syncing", async () => {
  const event = checkoutEvent({
    id: "cs_test_unknown_family",
    metadata: { familyId: "999999" },
  });
  let syncCalls = 0;
  let upsertCalls = 0;
  const handler = createStripeWebhookHandler(
    depsFor(event, {
      getFamilyById: async () => null,
      syncCheckoutSession: async () => {
        syncCalls += 1;
        upsertCalls += 1;
        return { status: "active", familyId: 999999 };
      },
    })
  );
  const { res, result } = fakeResponse();
  const logs = captureConsole();
  try {
    await handler(fakeRequest(event), res);
  } finally {
    logs.restore();
  }

  assert.equal(result.statusCode, 500);
  assert.deepEqual(result.body, { error: "webhook handler failed" });
  assert.equal(syncCalls, 0);
  assert.equal(upsertCalls, 0);
  assert.ok(
    logs.lines.some(
      (line) =>
        line ===
        "[stripe] retryable event=checkout.session.completed reason=family 999999 not found"
    ),
    `expected retryable log, got: ${logs.lines.join(" | ")}`
  );
});

test("PRECONDITION_FAILED is skipped with 200", async () => {
  const event = checkoutEvent({
    id: "cs_test_precondition",
    metadata: { familyId: "1" },
  });
  const handler = createStripeWebhookHandler(
    depsFor(event, {
      syncCheckoutSession: async () => {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "price not configured",
        });
      },
    })
  );
  const { res, result } = fakeResponse();
  const logs = captureConsole();
  try {
    await handler(fakeRequest(event), res);
  } finally {
    logs.restore();
  }

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { received: true, skipped: true });
  assert.ok(
    logs.lines.some(
      (line) =>
        line ===
        "[stripe] skipped event=checkout.session.completed id=evt_test_checkout reason=precondition"
    ),
    `expected precondition skip, got: ${logs.lines.join(" | ")}`
  );
});

test("unexpected system error returns 500 so Stripe retries", async () => {
  const event = checkoutEvent({
    id: "cs_test_db_down",
    metadata: { familyId: "1" },
  });
  const handler = createStripeWebhookHandler(
    depsFor(event, {
      syncCheckoutSession: async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
      },
    })
  );
  const { res, result } = fakeResponse();
  const logs = captureConsole();
  try {
    await handler(fakeRequest(event), res);
  } finally {
    logs.restore();
  }

  assert.equal(result.statusCode, 500);
  assert.deepEqual(result.body, { error: "webhook handler failed" });
  assert.ok(
    logs.lines.some(
      (line) =>
        line ===
        "[stripe] retryable event=checkout.session.completed reason=connect ECONNREFUSED 127.0.0.1:5432"
    ),
    `expected retryable log, got: ${logs.lines.join(" | ")}`
  );
});

test("invalid signature returns 400", async () => {
  const event = checkoutEvent({ id: "cs_test_signature" });
  const handler = createStripeWebhookHandler(
    depsFor(event, {
      constructEvent: () => {
        throw new Error("No signatures found");
      },
    })
  );
  const { res, result } = fakeResponse();
  const logs = captureConsole();
  try {
    await handler(fakeRequest(event), res);
  } finally {
    logs.restore();
  }

  assert.equal(result.statusCode, 400);
  assert.ok(
    String(result.body).includes("Webhook Error: No signatures found"),
    `expected signature error, got: ${String(result.body)}`
  );
  assert.ok(
    logs.lines.some((line) => line.includes("[stripe] webhook signature failed")),
    `expected signature log, got: ${logs.lines.join(" | ")}`
  );
});

test("successful checkout logs webhook ok", async () => {
  const event = checkoutEvent({
    id: "cs_test_ok",
    metadata: { familyId: "1" },
  });
  const handler = createStripeWebhookHandler(
    depsFor(event, {
      syncCheckoutSession: async () => ({ status: "active", familyId: 1 }),
    })
  );
  const { res, result } = fakeResponse();
  const logs = captureConsole();
  try {
    await handler(fakeRequest(event), res);
  } finally {
    logs.restore();
  }

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { received: true });
  assert.ok(
    logs.lines.some(
      (line) => line === "[stripe] webhook ok event=checkout.session.completed"
    ),
    `expected ok log, got: ${logs.lines.join(" | ")}`
  );
});

test("subscription event falls back to stripe row familyId", async () => {
  const event = subscriptionEvent({ id: "sub_test_1", metadata: {} });
  let syncCalls = 0;
  const handler = createStripeWebhookHandler(
    depsFor(event, {
      findFamilyIdBySubscriptionId: async (subscriptionId) => {
        assert.equal(subscriptionId, "sub_test_1");
        return 7;
      },
      getFamilyById: async (familyId) => {
        assert.equal(familyId, 7);
        return { id: 7 };
      },
      syncSubscription: async () => {
        syncCalls += 1;
        return 7;
      },
    })
  );
  const { res, result } = fakeResponse();
  const logs = captureConsole();
  try {
    await handler(fakeRequest(event), res);
  } finally {
    logs.restore();
  }

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { received: true });
  assert.equal(syncCalls, 1);
  assert.ok(
    logs.lines.some(
      (line) => line === "[stripe] webhook ok event=customer.subscription.updated"
    ),
    `expected ok log, got: ${logs.lines.join(" | ")}`
  );
});

test("subscription event without any family reference is skipped", async () => {
  const event = subscriptionEvent({ id: "sub_test_2", metadata: {} });
  let syncCalls = 0;
  const handler = createStripeWebhookHandler(
    depsFor(event, {
      findFamilyIdBySubscriptionId: async () => null,
      syncSubscription: async () => {
        syncCalls += 1;
        return null;
      },
    })
  );
  const { res, result } = fakeResponse();
  const logs = captureConsole();
  try {
    await handler(fakeRequest(event), res);
  } finally {
    logs.restore();
  }

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { received: true, skipped: true });
  assert.equal(syncCalls, 0);
  assert.ok(
    logs.lines.some(
      (line) =>
        line ===
        "[stripe] skipped event=customer.subscription.updated id=evt_test_subscription reason=no_family_ref"
    ),
    `expected skip log, got: ${logs.lines.join(" | ")}`
  );
});

test("subscription fallback DB error returns 500", async () => {
  const event = subscriptionEvent({ id: "sub_test_db_down", metadata: {} });
  let syncCalls = 0;
  const handler = createStripeWebhookHandler(
    depsFor(event, {
      findFamilyIdBySubscriptionId: async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
      },
      syncSubscription: async () => {
        syncCalls += 1;
        return 7;
      },
    })
  );
  const { res, result } = fakeResponse();
  const logs = captureConsole();
  try {
    await handler(fakeRequest(event), res);
  } finally {
    logs.restore();
  }

  assert.equal(result.statusCode, 500);
  assert.deepEqual(result.body, { error: "webhook handler failed" });
  assert.equal(syncCalls, 0);
  assert.ok(
    logs.lines.some(
      (line) =>
        line ===
        "[stripe] retryable event=customer.subscription.updated reason=connect ECONNREFUSED 127.0.0.1:5432"
    ),
    `expected retryable log, got: ${logs.lines.join(" | ")}`
  );
});

test("invoice event resolves subscription row before delegating", async () => {
  const event = invoiceEvent({ id: "in_test_1", subscription: "sub_test_1" });
  let syncCalls = 0;
  const handler = createStripeWebhookHandler(
    depsFor(event, {
      findFamilyIdBySubscriptionId: async (subscriptionId) => {
        assert.equal(subscriptionId, "sub_test_1");
        return 7;
      },
      getFamilyById: async (familyId) => {
        assert.equal(familyId, 7);
        return { id: 7 };
      },
      syncInvoicePaid: async () => {
        syncCalls += 1;
        return 7;
      },
    })
  );
  const { res, result } = fakeResponse();
  const logs = captureConsole();
  try {
    await handler(fakeRequest(event), res);
  } finally {
    logs.restore();
  }

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { received: true });
  assert.equal(syncCalls, 1);
  assert.ok(
    logs.lines.some((line) => line === "[stripe] webhook ok event=invoice.paid"),
    `expected ok log, got: ${logs.lines.join(" | ")}`
  );
});

test("invoice event without subscription is skipped", async () => {
  const event = invoiceEvent({ id: "in_test_2" });
  let syncCalls = 0;
  const handler = createStripeWebhookHandler(
    depsFor(event, {
      syncInvoicePaid: async () => {
        syncCalls += 1;
        return null;
      },
    })
  );
  const { res, result } = fakeResponse();
  const logs = captureConsole();
  try {
    await handler(fakeRequest(event), res);
  } finally {
    logs.restore();
  }

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { received: true, skipped: true });
  assert.equal(syncCalls, 0);
  assert.ok(
    logs.lines.some(
      (line) =>
        line ===
        "[stripe] skipped event=invoice.paid id=evt_test_invoice reason=no_family_ref"
    ),
    `expected skip log, got: ${logs.lines.join(" | ")}`
  );
});
