import assert from "node:assert/strict";
import test from "node:test";
import { runWithUsageWithDeps, type UsageDeps } from "./usage";

type Params = Parameters<UsageDeps["reserve"]>[0];

const params = {
  familyId: 13,
  userId: "1",
  kind: "ai_edit",
  limits: { aiCredits: 150, imports: 100, customRecipes: null } as any,
  idempotencyKey: "test-key",
  cost: { credits: 1 },
} as unknown as Params;

function deps(reservation: { status: "reserved"; eventId: number } | { status: "skipped" }) {
  const calls = { reserve: 0, commit: 0, refund: 0 };
  const impl: UsageDeps = {
    reserve: (async () => {
      calls.reserve += 1;
      return reservation as any;
    }) as unknown as UsageDeps["reserve"],
    commit: (async () => {
      calls.commit += 1;
    }) as unknown as UsageDeps["commit"],
    refund: (async () => {
      calls.refund += 1;
    }) as unknown as UsageDeps["refund"],
  };
  return { impl, calls };
}

test("runWithUsage: 成功才 commit，失敗要 refund", async () => {
  const ok = deps({ status: "reserved", eventId: 1 });
  const value = await runWithUsageWithDeps(ok.impl, params, async () => "done");
  assert.equal(value, "done");
  assert.deepEqual(ok.calls, { reserve: 1, commit: 1, refund: 0 });

  const bad = deps({ status: "reserved", eventId: 2 });
  await assert.rejects(
    () => runWithUsageWithDeps(bad.impl, params, async () => {
      throw new Error("AI 補齊失敗");
    }),
    /AI 補齊失敗/,
  );
  assert.deepEqual(bad.calls, { reserve: 1, commit: 0, refund: 1 }, "失敗一定要 refund，唔可以 commit");
});

test("runWithUsage: 未取得 reservation（skipped）時唔會 commit 亦唔會 refund", async () => {
  const skipped = deps({ status: "skipped" });
  const value = await runWithUsageWithDeps(skipped.impl, params, async () => 42);
  assert.equal(value, 42);
  assert.deepEqual(skipped.calls, { reserve: 1, commit: 0, refund: 0 });
});
