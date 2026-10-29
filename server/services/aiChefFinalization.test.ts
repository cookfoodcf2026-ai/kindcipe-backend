import assert from "node:assert/strict";
import test from "node:test";
import { finalizeChefRequest } from "./aiChefFinalization";
import type { ChefReply } from "./chefResponse";

const reply: ChefReply = {
  requestId: "req",
  status: "cards",
  recipes: [],
  replyText: "",
  requested: { total: 1, roles: ["any"] },
  served: 0,
  missingRoles: [],
  sources: { library: 0, ai: 0 },
  quickReplies: [],
};

function deps(overrides: Partial<Parameters<typeof finalizeChefRequest>[0]> = {}) {
  const calls: string[] = [];
  return {
    calls,
    value: {
      truthful: true,
      shouldCharge: true,
      requestedCredits: 1,
      reservationId: 10,
      buildContract: () => reply,
      validate: () => [],
      buildLegacy: async () => ({ content: "legacy", recipes: [] }),
      applyContract: (legacy: Record<string, unknown>) => ({ ...legacy, status: "cards" }),
      commitUsage: async () => { calls.push("commit"); },
      refundUsage: async () => { calls.push("refund"); },
      saveIdempotency: async () => { calls.push("save"); },
      releaseIdempotency: async () => { calls.push("release"); },
      ...overrides,
    },
  };
}

test("validate failure refunds and never commits", async () => {
  const d = deps({ validate: () => ["bad"] });
  await assert.rejects(() => finalizeChefRequest(d.value), (e: any) => e.code === "INTERNAL_SERVER_ERROR");
  assert.deepEqual(d.calls, ["refund", "release"]);
});

test("save failure after commit refunds", async () => {
  const d = deps({ saveIdempotency: async () => { throw new Error("save failed"); } });
  await assert.rejects(() => finalizeChefRequest(d.value), /save failed/);
  assert.deepEqual(d.calls, ["commit", "refund", "release"]);
});

test("shouldCharge=false refunds and never commits", async () => {
  const d = deps({ shouldCharge: false });
  const out = await finalizeChefRequest(d.value);
  assert.equal(out.creditsCharged, 0);
  assert.deepEqual(d.calls, ["refund", "save"]);
});

test("happy path commits and saves once", async () => {
  const d = deps();
  const out = await finalizeChefRequest(d.value);
  assert.equal(out.creditsCharged, 1);
  assert.deepEqual(d.calls, ["commit", "save"]);
});

test("AI-generated cards with a reservation commit a credit", async () => {
  const aiReply = {
    ...reply,
    sources: { library: 0, ai: 2 },
    served: 2,
    requested: { total: 2, roles: ["meat", "vegetable"] as const },
  };
  const d = deps({
    buildContract: () => ({ ...aiReply, requested: { total: 2, roles: ["meat", "vegetable"] } }),
    shouldCharge: true,
  });
  const out = await finalizeChefRequest(d.value);
  assert.equal(out.creditsCharged, 1);
  assert.deepEqual(d.calls, ["commit", "save"]);
});
