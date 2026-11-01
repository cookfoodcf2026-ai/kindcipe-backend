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
  const handler = createStripeWebhookHandler(depsFor(event));
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
        line.includes(
          "[stripe] skipped event=checkout.session.completed id=evt_test_checkout"
        ) && line.includes("缺少家庭資訊")
    ),
    `expected skip log, got: ${logs.lines.join(" | ")}`
  );
});

test("unknown family (NOT_FOUND) is skipped with 200", async () => {
  const event = checkoutEvent({
    id: "cs_test_unknown_family",
    metadata: { familyId: "999999" },
  });
  const handler = createStripeWebhookHandler(
    depsFor(event, {
      syncCheckoutSession: async () => {
        throw new TRPCError({ code: "NOT_FOUND", message: "家庭不存在" });
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
  assert.ok(
    logs.lines.some(
      (line) => line.includes("[stripe] skipped") && line.includes("家庭不存在")
    ),
    `expected skip log, got: ${logs.lines.join(" | ")}`
  );
});

test("unexpected system error still returns 500 so Stripe retries", async () => {
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
        line.includes("[stripe] webhook handling failed") &&
        line.includes("ECONNREFUSED")
    ),
    `expected failure log, got: ${logs.lines.join(" | ")}`
  );
});

test("successful event logs webhook ok", async () => {
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
