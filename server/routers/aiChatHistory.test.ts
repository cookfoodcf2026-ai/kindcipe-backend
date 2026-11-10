import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { aiChatUsage, chefQueryLog, aiChefRequests } from "../../drizzle/schema";
import { createAiChatRouter } from "./aiChat";

type ChatRow = { id: string; userId: number; title: string; messages: string; createdAt: Date; updatedAt: Date };
type LogRow = { id: number; userId: string; rawText: string | null };
type RequestRow = { id: number; userId: string; responseJson: unknown };
type UsageRow = { id: number; userId: string; count: number };

type Seed = {
  sessions?: ChatRow[];
  queryLogs?: LogRow[];
  chefRequests?: RequestRow[];
  usage?: UsageRow[];
};

function fakeDb(seed: Seed) {
  const sessions = (seed.sessions ?? []).map((row) => ({ ...row }));
  const queryLogs = (seed.queryLogs ?? []).map((row) => ({ ...row }));
  const chefRequests = (seed.chefRequests ?? []).map((row) => ({ ...row }));
  const usage = (seed.usage ?? []).map((row) => ({ ...row }));
  const dialect = new PgDialect();

  const rowsFor = (table: unknown): Array<Record<string, unknown>> => {
    if (table === chefQueryLog) return queryLogs;
    if (table === aiChefRequests) return chefRequests;
    if (table === aiChatUsage) return usage;
    return sessions;
  };

  const isSessions = (table: unknown) => table !== chefQueryLog && table !== aiChefRequests && table !== aiChatUsage;

  return {
    sessions,
    queryLogs,
    chefRequests,
    usage,
    delete(table: unknown) {
      const target = rowsFor(table);
      return {
        where(condition: unknown) {
          const query = dialect.sqlToQuery(condition as never);
          const sql = query.sql;
          const params = query.params as unknown[];
          return {
            async returning() {
              const matches = (row: Record<string, unknown>) => {
                if (isSessions(table)) {
                  const hasId = sql.includes('"id"');
                  const hasUserId = sql.includes('"user_id"');
                  if (hasId && hasUserId) {
                    const [id, userId] = params;
                    return row.id === id && row.userId === userId;
                  }
                  if (hasUserId) {
                    const [userId] = params;
                    return row.userId === userId;
                  }
                  if (hasId) {
                    const [id] = params;
                    return row.id === id;
                  }
                }
                return false;
              };
              const deleted = target.filter(matches);
              for (const row of deleted) target.splice(target.indexOf(row), 1);
              return deleted.map((row) => ({ id: row.id }));
            },
          };
        },
      };
    },
    update(table: unknown) {
      const target = rowsFor(table);
      return {
        set(values: Record<string, unknown>) {
          return {
            async where(condition: unknown) {
              const query = dialect.sqlToQuery(condition as never);
              const params = query.params as unknown[];
              const userId = String(params[0] ?? "");
              for (const row of target) {
                if (String(row.userId) === userId) Object.assign(row, values);
              }
            },
          };
        },
      };
    },
  };
}

const ctxFor = (userId: number) => ({
  user: { id: userId, openId: `user-${userId}`, role: "user" },
  activeFamilyId: null,
  activeFamilyRole: null,
  readOnly: false,
  sharedLocked: false,
  clientPlatform: "web",
  req: { headers: {} },
  res: {},
}) as any;

const row = (id: string, userId: number): ChatRow => ({
  id,
  userId,
  title: id,
  messages: "[]",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
});

test("deleteSession deletes the caller's own session", async () => {
  const db = fakeDb({ sessions: [row("own", 1), row("other", 2)] });
  const caller = createAiChatRouter((async () => db) as any).createCaller(ctxFor(1));

  const result = await caller.deleteSession({ id: "own" });
  assert.deepEqual(result, { success: true, deleted: 1 });
  assert.deepEqual(db.sessions.map((r) => r.id), ["other"]);
});

test("deleteSession cannot delete another user's session", async () => {
  const db = fakeDb({ sessions: [row("own", 1), row("other", 2)] });
  const caller = createAiChatRouter((async () => db) as any).createCaller(ctxFor(1));

  const result = await caller.deleteSession({ id: "other" });
  assert.deepEqual(result, { success: true, deleted: 0 });
  assert.deepEqual(db.sessions.map((r) => r.id), ["own", "other"]);
});

test("the older duplicate delete endpoint is gone", () => {
  const procedures = (createAiChatRouter((async () => fakeDb({})) as any) as any)._def.procedures;
  assert.equal("delete" in procedures, false);
  assert.equal("deleteSession" in procedures, true);
});

test("deleteSession throws INTERNAL_SERVER_ERROR when the DB is unavailable", async () => {
  const caller = createAiChatRouter((async () => null) as any).createCaller(ctxFor(1));
  await assert.rejects(
    () => caller.deleteSession({ id: "own" }),
    (error: any) => error?.code === "INTERNAL_SERVER_ERROR",
  );
});

test("clearHistory throws INTERNAL_SERVER_ERROR when the DB is unavailable", async () => {
  const caller = createAiChatRouter((async () => null) as any).createCaller(ctxFor(1));
  await assert.rejects(
    () => caller.clearHistory(),
    (error: any) => error?.code === "INTERNAL_SERVER_ERROR",
  );
});

test("clearHistory deletes only the caller's sessions", async () => {
  const db = fakeDb({ sessions: [row("a", 1), row("b", 1), row("c", 2)] });
  const caller = createAiChatRouter((async () => db) as any).createCaller(ctxFor(1));

  const result = await caller.clearHistory();
  assert.deepEqual(result, { success: true, deleted: 2 });
  assert.deepEqual(db.sessions.map((r) => r.id), ["c"]);
});

test("clearHistory scrubs conversation text but keeps billing/quota audit rows", async () => {
  const db = fakeDb({
    sessions: [row("a", 1), row("b", 2)],
    queryLogs: [
      { id: 1, userId: "1", rawText: "我想食海鮮" },
      { id: 2, userId: "2", rawText: "我想食牛" },
    ],
    chefRequests: [
      { id: 1, userId: "1", responseJson: { replyText: "私人對話" } },
      { id: 2, userId: "2", responseJson: { replyText: "其他用戶" } },
    ],
    usage: [
      { id: 1, userId: "1", count: 37 },
      { id: 2, userId: "2", count: 11 },
    ],
  });
  const caller = createAiChatRouter((async () => db) as any).createCaller(ctxFor(1));

  const result = await caller.clearHistory();
  assert.deepEqual(result, { success: true, deleted: 1 });

  assert.equal(db.sessions.filter((r) => r.userId === 1).length, 0);
  assert.deepEqual(db.sessions.map((r) => r.id), ["b"]);

  assert.equal(db.queryLogs.find((r) => r.userId === "1")?.rawText, null);
  assert.equal(db.queryLogs.find((r) => r.userId === "2")?.rawText, "我想食牛");

  assert.equal(db.chefRequests.find((r) => r.userId === "1")?.responseJson, null);
  assert.deepEqual(db.chefRequests.find((r) => r.userId === "2")?.responseJson, { replyText: "其他用戶" });

  assert.equal(db.usage.find((r) => r.userId === "1")?.count, 37);
  assert.equal(db.usage.find((r) => r.userId === "2")?.count, 11);
});
