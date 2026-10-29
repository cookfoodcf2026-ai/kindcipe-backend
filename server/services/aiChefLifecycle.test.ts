import assert from "node:assert/strict";
import test from "node:test";
import { aiReply } from "../_core/aiReply";
import { resolveChefIntent } from "./chefIntent";
import { processAIChefChat } from "../routers/aiRecipe";
import {
  ChefIdempotencyConflictError,
  runChefLifecycle,
  type ChefRequestKey,
  type ChefRequestStore,
  type ChefRunResult,
} from "./aiChefLifecycle";
import type { IdempotencyCached } from "./aiChefIdempotency";

// No real DB connection is allowed for this harness.
delete process.env.DATABASE_URL;

class MemoryChefRequestStore implements ChefRequestStore {
  readonly rows = new Map<string, IdempotencyCached>();
  private key(key: ChefRequestKey): string {
    return `${key.familyId}:${key.chatId ?? ""}:${key.clientMessageId ?? ""}`;
  }
  async find(key: ChefRequestKey): Promise<IdempotencyCached | undefined> {
    return this.rows.get(this.key(key));
  }
  async save(key: ChefRequestKey, value: IdempotencyCached): Promise<void> {
    this.rows.set(this.key(key), value);
  }
}

class MemoryCreditLedger {
  credits = 0;
  runCalls = 0;
  private nextId = 1;
  private reservations = new Map<number, number>();
  reserve = async (requestedCredits: number): Promise<number> => {
    const id = this.nextId++;
    this.reservations.set(id, requestedCredits);
    return id;
  };
  commit = async (id: number): Promise<void> => {
    const credits = this.reservations.get(id);
    if (credits === undefined) throw new Error(`unknown reservation ${id}`);
    this.reservations.delete(id);
    this.credits += credits;
  };
  refund = async (id: number): Promise<void> => {
    this.reservations.delete(id);
  };
}

const dessert = {
  name: "Mango Sago",
  description: "Mango dessert",
  cookTime: 20,
  servings: 4,
  difficulty: "easy",
  ingredients: [
    { name: "Mango", quantity: "2", unit: "pcs" },
    { name: "Sago", quantity: "50", unit: "g" },
  ],
  steps: ["Step 1", "Step 2", "Step 3", "Step 4", "Step 5"],
  tags: ["dessert"],
  source: "official" as const,
  officialId: 42,
};

const baseIntent = resolveChefIntent("咁有冇甜點", { mode: "chat" });

test("D2 exact: no library dessert gives no_cards, empty recipes, and safe text", async () => {
  assert.equal(baseIntent.wantsCards, true);
  assert.deepEqual(baseIntent.requested, { total: 1, roles: ["dessert"] });

  const store = new MemoryChefRequestStore();
  const ledger = new MemoryCreditLedger();
  const out = await runChefLifecycle({
    requestId: "req_d2",
    familyId: 13,
    chatId: "chat_d2",
    clientMessageId: "msg_d2",
    intent: baseIntent,
    lang: "zh-TW",
    payload: { messages: [{ role: "user", content: "咁有冇甜點" }] },
    requestedCredits: 1,
    store,
    reserveCredit: ledger.reserve,
    commitCredit: ledger.commit,
    refundCredit: ledger.refund,
    run: async () => {
      const actual = await processAIChefChat(
        [{ role: "user", content: "咁有冇甜點" }],
        13,
        undefined,
        "library",
        [],
        undefined,
        "zh-TW",
      );
      return { ...actual, llmCalls: 0 };
    },
  });

  assert.ok(out.reply.status === "no_cards" || out.reply.status === "clarify");
  assert.deepEqual(out.reply.recipes, []);
  assert.equal(out.reply.served, 0);
  assert.doesNotMatch(out.reply.replyText, /here is|here are|perfect|以下係|呢個就係|推介|推薦|我搵到/i);
  assert.equal(out.creditsCharged, 0);
  assert.equal(out.llmCalls, 0);
  assert.equal(ledger.credits, 0);
});

test("library dessert gives cards and served equals recipes length", async () => {
  const store = new MemoryChefRequestStore();
  const ledger = new MemoryCreditLedger();
  const out = await runChefLifecycle({
    requestId: "req_cards",
    familyId: 13,
    chatId: "chat_cards",
    clientMessageId: "msg_cards",
    intent: baseIntent,
    payload: { messages: [{ role: "user", content: "咁有冇甜點" }] },
    requestedCredits: 1,
    store,
    reserveCredit: ledger.reserve,
    commitCredit: ledger.commit,
    refundCredit: ledger.refund,
    run: async () => ({
      content: "我喺食譜庫搵到呢個食譜：",
      recipes: [dessert],
      llmUsed: false,
      missingRoles: [],
      llmCalls: 0,
    }),
  });

  assert.equal(out.reply.status, "cards");
  assert.equal(out.reply.served, out.reply.recipes.length);
  assert.equal(out.reply.served, 1);
  assert.deepEqual(out.reply.sources, { library: 1, ai: 0 });
  assert.equal(out.creditsCharged, 0);
  assert.equal(out.llmCalls, 0);
  assert.equal(ledger.credits, 0);
});

test("double-click with same clientMessageId reuses and charges only once", async () => {
  const store = new MemoryChefRequestStore();
  const ledger = new MemoryCreditLedger();
  const intent = resolveChefIntent("我想食甜品", { mode: "ai" });
  const payload = { messages: [{ role: "user", content: "我想食甜品" }], mode: "ai" };
  const deps = {
    requestId: "req_click",
    familyId: 13,
    chatId: "chat_click",
    clientMessageId: "msg_click",
    intent,
    payload,
    requestedCredits: 1,
    store,
    reserveCredit: ledger.reserve,
    commitCredit: ledger.commit,
    refundCredit: ledger.refund,
    run: async (): Promise<ChefRunResult> => {
      ledger.runCalls += 1;
      return { content: "AI recipe", recipes: [{ ...dessert, source: "ai", officialId: undefined }], llmUsed: true, missingRoles: [], llmCalls: 1 };
    },
  };

  const first = await runChefLifecycle(deps);
  const second = await runChefLifecycle(deps);

  assert.equal(first.decision, "miss");
  assert.equal(first.creditsCharged, 1);
  assert.equal(first.llmCalls, 1);
  assert.equal(second.decision, "reuse");
  assert.equal(second.creditsCharged, 0);
  assert.equal(second.llmCalls, 0);
  assert.equal(ledger.runCalls, 1);
  assert.equal(ledger.credits, 1);
  assert.equal(store.rows.size, 1);
  assert.deepEqual(second.reply, first.reply);
});

test("deterministic no-card path reports llm_calls = 0", async () => {
  const store = new MemoryChefRequestStore();
  const ledger = new MemoryCreditLedger();
  let llmCalls = 0;
  const out = await runChefLifecycle({
    requestId: "req_zero",
    familyId: 13,
    chatId: "chat_zero",
    clientMessageId: "msg_zero",
    intent: baseIntent,
    payload: { messages: [{ role: "user", content: "咁有冇甜點" }] },
    requestedCredits: 1,
    store,
    reserveCredit: ledger.reserve,
    commitCredit: ledger.commit,
    refundCredit: ledger.refund,
    run: async () => {
      llmCalls += 0;
      return { content: aiReply("zh-TW", "libNone"), recipes: [], llmUsed: false, missingRoles: ["dessert"], llmCalls };
    },
  });
  assert.equal(out.llmCalls, 0);
  assert.equal(out.reply.status, "no_cards");
});

test("same clientMessageId with different payload conflicts before charging", async () => {
  const store = new MemoryChefRequestStore();
  const ledger = new MemoryCreditLedger();
  const intent = resolveChefIntent("我想食甜品", { mode: "ai" });
  const base = {
    requestId: "req_conflict",
    familyId: 13,
    chatId: "chat_conflict",
    clientMessageId: "msg_conflict",
    intent,
    requestedCredits: 1,
    store,
    reserveCredit: ledger.reserve,
    commitCredit: ledger.commit,
    refundCredit: ledger.refund,
    run: async (): Promise<ChefRunResult> => {
      ledger.runCalls += 1;
      return { content: "AI recipe", recipes: [{ ...dessert, source: "ai", officialId: undefined }], llmUsed: true, missingRoles: [], llmCalls: 1 };
    },
  };
  await runChefLifecycle({ ...base, payload: { messages: [{ role: "user", content: "我想食甜品" }] } });
  await assert.rejects(
    runChefLifecycle({ ...base, payload: { messages: [{ role: "user", content: "改為咸點" }] } }),
    (error: unknown) => error instanceof ChefIdempotencyConflictError,
  );
  assert.equal(ledger.runCalls, 1);
  assert.equal(ledger.credits, 1);
});
