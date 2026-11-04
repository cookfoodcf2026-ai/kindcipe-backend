import assert from "node:assert/strict";
import test from "node:test";
import type { ChefIntent } from "./chefIntent";
import {
  runChefLifecycle,
  type ChefRequestKey,
  type ChefRequestStore,
  type ChefRunResult,
} from "./aiChefLifecycle";
import type { IdempotencyCached } from "./aiChefIdempotency";
import {
  deriveChefRetryToken,
  resolveIncompleteContract,
} from "./aiChefIncompleteContract";

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

const mealIntent: ChefIntent = {
  kind: "meal",
  wantsCards: true,
  requested: { total: 4, roles: ["meat", "seafood", "vegetable", "soup"] },
  confidence: 1,
  reason: "test",
};

function aiRecipe(name: string) {
  return {
    name,
    description: `${name} description`,
    cookTime: 20,
    servings: 4,
    difficulty: "easy",
    ingredients: [{ name: "Ingredient", quantity: "1", unit: "pc" }],
    steps: ["Step 1", "Step 2", "Step 3", "Step 4", "Step 5"],
    tags: ["test"],
    source: "ai" as const,
  };
}

function deps(overrides: {
  store: MemoryChefRequestStore;
  ledger: MemoryCreditLedger;
  served: number;
  clientMessageId?: string;
  retryToken?: string;
  enabled?: boolean;
  payload?: unknown;
}) {
  return {
    requestId: `req_${overrides.served}`,
    familyId: 13,
    chatId: "chat_contract",
    clientMessageId: overrides.clientMessageId ?? "msg_first",
    retryToken: overrides.retryToken,
    intent: mealIntent,
    lang: "zh-TW",
    payload: overrides.payload ?? { messages: [{ role: "user", content: "三餸一湯" }], mode: "ai" },
    requestedCredits: 1,
    store: overrides.store,
    incompleteContract: { enabled: overrides.enabled ?? true, requiredCards: 4 },
    reserveCredit: overrides.ledger.reserve,
    commitCredit: overrides.ledger.commit,
    refundCredit: overrides.ledger.refund,
    run: async (): Promise<ChefRunResult> => {
      overrides.ledger.runCalls += 1;
      return {
        content: "AI meal",
        recipes: Array.from({ length: overrides.served }, (_, i) => aiRecipe(`Dish ${i + 1}`)),
        llmUsed: true,
        missingRoles: [],
        llmCalls: 1,
      };
    },
  };
}

test("contract: 4 cards is complete and charges one credit", async () => {
  const store = new MemoryChefRequestStore();
  const ledger = new MemoryCreditLedger();
  const out = await runChefLifecycle(deps({ store, ledger, served: 4 }));

  assert.equal(out.contract?.status, "complete");
  assert.equal(out.contract?.requiredCards, 4);
  assert.equal(out.contract?.shouldCharge, true);
  assert.equal(out.creditsCharged, 1);
  assert.equal(ledger.credits, 1);
  assert.equal((out.reply as unknown as Record<string, unknown>).status, "complete");
  assert.equal((out.reply as unknown as Record<string, unknown>).creditCharged, true);
  assert.equal(typeof (out.reply as unknown as Record<string, unknown>).retryToken, "string");
});

test("contract: 3 of 4 cards is incomplete, free, and returns a retry token", async () => {
  const store = new MemoryChefRequestStore();
  const ledger = new MemoryCreditLedger();
  const out = await runChefLifecycle(deps({ store, ledger, served: 3 }));

  assert.equal(out.contract?.status, "incomplete");
  assert.equal(out.contract?.shouldCharge, false);
  assert.equal(out.creditsCharged, 0);
  assert.equal(ledger.credits, 0);
  assert.equal((out.reply as unknown as Record<string, unknown>).status, "incomplete");
  assert.equal((out.reply as unknown as Record<string, unknown>).creditCharged, false);
  assert.equal(typeof (out.reply as unknown as Record<string, unknown>).retryToken, "string");
});

test("contract: zero cards is incomplete and free", async () => {
  const store = new MemoryChefRequestStore();
  const ledger = new MemoryCreditLedger();
  const out = await runChefLifecycle(deps({ store, ledger, served: 0 }));

  assert.equal(out.contract?.status, "incomplete");
  assert.equal(out.creditsCharged, 0);
  assert.equal(ledger.credits, 0);
});

test("contract: same retry token + same payload reuses the result and charges once", async () => {
  const store = new MemoryChefRequestStore();
  const ledger = new MemoryCreditLedger();
  const first = await runChefLifecycle(deps({ store, ledger, served: 4 }));
  const token = (first.reply as unknown as Record<string, unknown>).retryToken as string;

  assert.equal(first.creditsCharged, 1);
  assert.equal(ledger.credits, 1);
  assert.equal(ledger.runCalls, 1);

  const second = await runChefLifecycle(deps({
    store,
    ledger,
    served: 4,
    clientMessageId: "msg_retry",
    retryToken: token,
  }));

  assert.equal(second.decision, "reuse");
  assert.equal(second.creditsCharged, 0);
  assert.equal(ledger.credits, 1);
  assert.equal(ledger.runCalls, 1);
  assert.deepEqual(second.reply, first.reply);
});

test("contract: retry token with a different payload conflicts before charging", async () => {
  const store = new MemoryChefRequestStore();
  const ledger = new MemoryCreditLedger();
  const first = await runChefLifecycle(deps({ store, ledger, served: 4 }));
  const token = (first.reply as unknown as Record<string, unknown>).retryToken as string;

  await assert.rejects(
    runChefLifecycle(deps({
      store,
      ledger,
      served: 4,
      clientMessageId: "msg_retry",
      retryToken: token,
      payload: { messages: [{ role: "user", content: "兩餸一湯" }], mode: "ai" },
    })),
    /different payload/,
  );
  assert.equal(ledger.credits, 1);
  assert.equal(ledger.runCalls, 1);
});

test("contract flag OFF keeps the legacy charge decision and response shape", async () => {
  const store = new MemoryChefRequestStore();
  const ledger = new MemoryCreditLedger();
  const out = await runChefLifecycle(deps({ store, ledger, served: 3, enabled: false }));

  assert.equal(out.creditsCharged, 1);
  assert.equal(ledger.credits, 1);
  assert.equal((out.reply as unknown as Record<string, unknown>).status, "partial_cards");
  assert.equal((out.reply as unknown as Record<string, unknown>).requiredCards, undefined);
  assert.equal((out.reply as unknown as Record<string, unknown>).retryToken, undefined);
  assert.equal(out.contract?.applies, false);
});

test("retry token derivation is stable for the same request identity", () => {
  const input = { familyId: 13, chatId: "chat", clientMessageId: "msg", payloadHash: "hash" };
  assert.equal(deriveChefRetryToken(input), deriveChefRetryToken(input));
  assert.notEqual(
    deriveChefRetryToken(input),
    deriveChefRetryToken({ ...input, clientMessageId: "msg_2" }),
  );
});

test("resolveIncompleteContract does not force a refund when the contract is off", () => {
  const out = resolveIncompleteContract({
    enabled: false,
    requiredCards: 4,
    served: 3,
    shouldCharge: true,
    retryToken: "tok",
  });
  assert.equal(out.applies, false);
  assert.equal(out.shouldCharge, true);
});
