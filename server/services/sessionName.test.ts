import assert from "node:assert/strict";
import test from "node:test";
import { sessionDisplayName } from "../routers";

// A session token must carry a non-empty name or verifySession() treats every
// later request as anonymous — the bug that made OTP sign-in look dead.
test("session name falls back to the email prefix", () => {
  assert.equal(sessionDisplayName({ name: "Mavis", email: "a@b.com" }), "Mavis");
  assert.equal(sessionDisplayName({ name: "  ", email: "maviskyn@gmail.com" }), "maviskyn");
  assert.equal(sessionDisplayName({ name: null, email: null }), "user");
  assert.equal(sessionDisplayName({ name: null, email: "not-an-email" }), "user");
});
