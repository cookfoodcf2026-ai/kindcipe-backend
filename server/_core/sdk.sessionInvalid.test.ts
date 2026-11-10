import assert from "node:assert/strict";
import test from "node:test";
import type { AxiosInstance } from "axios";
import type { Request } from "express";
import type { SDKUserStore } from "./sdk";

test("authenticateRequest rejects unknown session without calling OAuth", async () => {
  process.env.JWT_SECRET =
    process.env.JWT_SECRET ?? "test-session-secret-at-least-32-characters";
  process.env.APP_ID = process.env.APP_ID ?? "kindcipe";

  const { SDKServer } = await import("./sdk");

  let postCalls = 0;
  const fakeClient = {
    post: async () => {
      postCalls += 1;
      throw new Error("OAuth endpoint must not be called");
    },
  } as unknown as AxiosInstance;

  let upsertCalls = 0;
  const fakeStore = {
    getUserByOpenId: async () => null,
    upsertUser: async () => {
      upsertCalls += 1;
    },
  } as unknown as SDKUserStore;

  const sdk = new SDKServer(fakeClient, fakeStore);
  const token = await sdk.createSessionToken("ghost-open-id", {
    name: "Ghost User",
  });
  const req = {
    headers: { authorization: `Bearer ${token}` },
  } as unknown as Request;

  let thrown: unknown;
  try {
    await sdk.authenticateRequest(req);
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown, "authenticateRequest should throw for an unknown openId");
  assert.equal(
    (thrown as { statusCode?: number }).statusCode,
    401,
    "session-invalid error must be a 401, not a 500"
  );
  assert.equal(
    (thrown as { message?: string }).message,
    "Session no longer valid"
  );
  assert.equal(postCalls, 0, "OAuth post must not be attempted");
  assert.equal(upsertCalls, 0, "no user row should be upserted");
});
