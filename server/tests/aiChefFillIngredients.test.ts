import assert from "node:assert/strict";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import {
  runFillIngredients,
  type FillIngredient,
  type FillIngredientsDeps,
  type FillIngredientsInput,
} from "../routers/aiRecipe";
import type { FamilyEntitlements } from "../services/entitlements";
import { UsageLimitError, runWithUsageWithDeps, type UsageDeps } from "../services/usage";

const INPUT: FillIngredientsInput = { name: "番茄炒蛋", description: "家常菜" };

function makeEnt(overrides: Partial<FamilyEntitlements> = {}): FamilyEntitlements {
  return {
    familyId: 7,
    status: "active",
    plan: "pro",
    isPaid: true,
    limits: { aiCredits: 150, imports: 100, customRecipes: null, members: 4 },
    legacyAiCredits: null,
    memberCount: 1,
    memberGraceEndsAt: null,
    memberGraceActive: false,
    readOnly: false,
    canUseKol: true,
    canUseParty: true,
    activeWriteUserIds: ["user_1"],
    ...overrides,
  };
}

function makeIngredients(count = 8): FillIngredient[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `材料${index + 1}`,
    quantity: String(index + 1),
    unit: "克",
  }));
}

interface HarnessState {
  commits: number[];
  refunds: number[];
  generateCalls: number;
  meterCalls: number;
  increments: number;
  nextEventId: number;
  nextRequestId: number;
}

function makeDeps(options: {
  ent?: FamilyEntitlements;
  generate?: (input: FillIngredientsInput) => Promise<FillIngredient[] | null>;
  localize?: (ingredients: FillIngredient[]) => Promise<FillIngredient[] | null>;
  quotaExceeded?: boolean;
} = {}): { deps: FillIngredientsDeps; state: HarnessState } {
  const state: HarnessState = {
    commits: [],
    refunds: [],
    generateCalls: 0,
    meterCalls: 0,
    increments: 0,
    nextEventId: 0,
    nextRequestId: 0,
  };

  const usageDeps: UsageDeps = {
    reserve: async () => {
      if (options.quotaExceeded) throw new UsageLimitError("AI_CREDITS", 15, 15);
      state.nextEventId += 1;
      return { eventId: state.nextEventId, status: "reserved" };
    },
    commit: async (eventId) => {
      state.commits.push(eventId);
    },
    refund: async (eventId) => {
      state.refunds.push(eventId);
    },
  };

  const deps: FillIngredientsDeps = {
    getFamilyEntitlements: async () => options.ent ?? makeEnt(),
    startLlmMeter: (() => {
      state.meterCalls += 1;
      return {} as any;
    }) as FillIngredientsDeps["startLlmMeter"],
    runWithUsage: (params, fn) => runWithUsageWithDeps(usageDeps, params, fn),
    incrementAiChatUsage: (async () => {
      state.increments += 1;
      return 1;
    }) as FillIngredientsDeps["incrementAiChatUsage"],
    generate: async (input) => {
      state.generateCalls += 1;
      return options.generate ? options.generate(input) : [];
    },
    localizeIngredients: async (ingredients) =>
      options.localize ? options.localize(ingredients) : ingredients,
    newRequestId: () => {
      state.nextRequestId += 1;
      return `req-${state.nextRequestId}`;
    },
  };

  return { deps, state };
}

function isTrpcError(code: TRPCError["code"], message?: string) {
  return (error: unknown) =>
    error instanceof TRPCError && error.code === code && (message ? error.message.includes(message) : true);
}

test("fillIngredients happy path returns ingredients only, no steps", async () => {
  const ingredients = makeIngredients(8);
  const { deps, state } = makeDeps({ generate: async () => ingredients });

  const result = await runFillIngredients(deps, { familyId: 7, userId: "user_1", input: INPUT });

  assert.equal(result.aiGenerated, true);
  assert.deepEqual(result.ingredients, ingredients);
  assert.deepEqual(Object.keys(result).sort(), ["aiGenerated", "ingredients"]);
  assert.equal("steps" in result, false);
  assert.equal(state.generateCalls, 1);
  assert.equal(state.meterCalls, 1);
  assert.deepEqual(state.commits, [1]);
  assert.deepEqual(state.refunds, []);
  assert.equal(state.increments, 1);
});

test("fillIngredients refunds and throws when the model returns no ingredients", async () => {
  const { deps, state } = makeDeps({ generate: async () => [] });

  await assert.rejects(
    () => runFillIngredients(deps, { familyId: 7, userId: "user_1", input: INPUT }),
    isTrpcError("INTERNAL_SERVER_ERROR", "AI 補材料失敗，請再試。"),
  );
  assert.deepEqual(state.refunds, [1]);
  assert.deepEqual(state.commits, []);
});

test("fillIngredients rejects a result with fewer than 3 ingredients", async () => {
  const { deps, state } = makeDeps({ generate: async () => makeIngredients(2) });

  await assert.rejects(
    () => runFillIngredients(deps, { familyId: 7, userId: "user_1", input: INPUT }),
    isTrpcError("INTERNAL_SERVER_ERROR", "AI 補材料失敗，請再試。"),
  );
  assert.deepEqual(state.refunds, [1]);
  assert.deepEqual(state.commits, []);
});

test("fillIngredients is forbidden for a read-only family and never calls the model", async () => {
  const { deps, state } = makeDeps({
    ent: makeEnt({ readOnly: true }),
    generate: async () => makeIngredients(8),
  });

  await assert.rejects(
    () => runFillIngredients(deps, { familyId: 7, userId: "user_1", input: INPUT }),
    isTrpcError("FORBIDDEN"),
  );
  assert.equal(state.generateCalls, 0);
  assert.equal(state.meterCalls, 0);
  assert.deepEqual(state.refunds, []);
});

test("fillIngredients maps quota exhaustion to the usage TRPC error", async () => {
  const { deps, state } = makeDeps({ quotaExceeded: true, generate: async () => makeIngredients(8) });

  await assert.rejects(
    () => runFillIngredients(deps, { familyId: 7, userId: "user_1", input: INPUT }),
    isTrpcError("FORBIDDEN", "AI 用量已達到上限"),
  );
  assert.equal(state.generateCalls, 0);
  assert.deepEqual(state.commits, []);
  assert.deepEqual(state.refunds, []);
});
