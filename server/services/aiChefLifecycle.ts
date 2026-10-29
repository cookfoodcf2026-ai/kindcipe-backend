import { createHash } from "node:crypto";
import { aiReply } from "../_core/aiReply";
import { shouldChargeChefRequest } from "./aiChefPolicy";
import { buildClientMessageKey, getIdempotencyDecision, type IdempotencyCached } from "./aiChefIdempotency";
import type { ChefCardSnapshot, ChefReply, ChefResponseStatus } from "./chefResponse";
import { validateChefReply } from "./chefResponse";
import type { ChefIntent, RequestedRole } from "./chefIntent";

export type ChefRecipeLike = {
  name: string;
  description?: string;
  cookTime?: number;
  servings?: number;
  difficulty?: string;
  recipeCategory?: string;
  dishType?: string;
  ingredients?: Array<{
    name: string;
    nameEn?: string;
    nameFil?: string;
    nameId?: string;
    quantity?: string;
    unit?: string;
  }>;
  steps?: string[];
  stepsEn?: string[];
  stepsFil?: string[];
  stepsId?: string[];
  tags?: string[];
  source?: "official" | "custom" | "ai";
  officialId?: number;
  customId?: number;
  image?: string;
  thumbnailUrl?: string;
};

export type ChefRunResult = {
  content: string;
  recipes: ChefRecipeLike[];
  llmUsed: boolean;
  missingRoles?: RequestedRole[];
  llmCalls?: number;
};

export type ChefRequestKey = {
  familyId: number;
  chatId?: string;
  clientMessageId?: string;
};

export type ChefClaimResult =
  | { decision: "claimed" }
  | { decision: "reuse"; cached: IdempotencyCached }
  | { decision: "conflict" };

export interface ChefRequestStore {
  find(key: ChefRequestKey): Promise<IdempotencyCached | undefined>;
  save(key: ChefRequestKey, value: IdempotencyCached): Promise<void>;
  /** Optional atomic insert-if-absent used by the real DB store. */
  claim?: (key: ChefRequestKey, payloadHash: string) => Promise<ChefClaimResult>;
  /** Remove a pending claim after a failed run. */
  release?: (key: ChefRequestKey) => Promise<void>;
}

export class ChefIdempotencyConflictError extends Error {
  code = "CONFLICT" as const;
  constructor() {
    super("clientMessageId was reused with a different payload");
    this.name = "ChefIdempotencyConflictError";
  }
}

export class ChefReplyContractError extends Error {
  code = "CONTRACT" as const;
  errors: string[];
  constructor(errors: string[]) {
    super(`invalid ChefReply: ${errors.join("; ")}`);
    this.name = "ChefReplyContractError";
    this.errors = errors;
  }
}

/** Stable JSON hash so retries of the same request are reusable. */
export function hashChefPayload(value: unknown): string {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function statusFor(intent: ChefIntent, recipes: ChefRecipeLike[]): ChefResponseStatus {
  const requested = intent.requested.total;
  if (recipes.length === 0) {
    if (intent.kind === "clarify") return "clarify";
    if (requested > 0) return "no_cards";
    return "text";
  }
  return recipes.length < requested ? "partial_cards" : "cards";
}

function cardId(recipe: ChefRecipeLike, index: number): string {
  if (recipe.officialId != null) return `official_${recipe.officialId}`;
  if (recipe.customId != null) return `custom_${recipe.customId}`;
  return `ai_${index}_${recipe.name}`;
}

function toCard(recipe: ChefRecipeLike, role: RequestedRole, index: number): ChefCardSnapshot {
  return {
    cardId: cardId(recipe, index),
    name: recipe.name,
    description: recipe.description ?? "",
    cookTime: recipe.cookTime ?? 30,
    servings: recipe.servings ?? 4,
    difficulty: recipe.difficulty ?? "medium",
    recipeCategory: recipe.recipeCategory,
    dishType: recipe.dishType,
    ingredients: (recipe.ingredients ?? []).map((ing) => ({
      name: ing.name,
      nameEn: ing.nameEn,
      nameFil: ing.nameFil,
      nameId: ing.nameId,
      quantity: ing.quantity ?? "",
      unit: ing.unit ?? "",
    })),
    steps: recipe.steps ?? [],
    stepsEn: recipe.stepsEn,
    stepsFil: recipe.stepsFil,
    stepsId: recipe.stepsId,
    tags: recipe.tags ?? [],
    source: recipe.source ?? "ai",
    role,
    officialId: recipe.officialId,
    customId: recipe.customId,
    image: recipe.image,
    thumbnailUrl: recipe.thumbnailUrl,
  };
}

export function buildChefReply(params: {
  requestId: string;
  chatId?: string;
  clientMessageId?: string;
  intent: ChefIntent;
  result: ChefRunResult;
  lang?: string;
  templateText?: boolean;
  operation?: "replace" | "append";
}): ChefReply {
  const { requestId, chatId, clientMessageId, intent, result } = params;
  const lang = params.lang ?? "zh-TW";
  const status = statusFor(intent, result.recipes);
  const recipes = result.recipes.map((recipe, i) =>
    toCard(recipe, intent.requested.roles[i] ?? "any", i),
  );
  const served = recipes.length;
  const requested = intent.requested.total;
  const missingRoles =
    status === "no_cards"
      ? (result.missingRoles?.length ? result.missingRoles : intent.requested.roles)
      : status === "partial_cards"
        ? (result.missingRoles?.length ? result.missingRoles : intent.requested.roles.slice(served))
        : [];
  const sources = recipes.reduce(
    (acc, recipe) => {
      if (recipe.source === "official" || recipe.source === "custom") acc.library += 1;
      else acc.ai += 1;
      return acc;
    },
    { library: 0, ai: 0 },
  );

  // no_cards/clarify must never claim a recipe exists. Use a deterministic
  // template instead of trusting a model/library string.
  const operation = params.operation ?? "replace";
  const replyText = status === "no_cards"
    ? aiReply(lang, "libNone")
    : status === "clarify"
      ? (result.content || aiReply(lang, "libNone"))
      : params.templateText && status === "cards"
        ? aiReply(lang, operation === "append" ? "cardsAdded" : "cardsReady")
        : params.templateText && status === "partial_cards"
          ? aiReply(lang, "partialSet", { served, total: requested })
          : result.content;
  const quickReplies = status === "no_cards" || status === "clarify"
    ? [
        { actionId: "ai_generate" as const, labelKey: "aiChef.aiGenerate" },
        { actionId: "restart" as const, labelKey: "aiChef.quickRestart" },
      ]
    : [];

  return {
    requestId,
    chatId,
    clientMessageId,
    status,
    operation,
    recipes,
    replyText,
    requested: intent.requested,
    served,
    missingRoles,
    sources,
    quickReplies,
  };
}

/** Add contract fields only when the flag is enabled. OFF must be a no-op. */
export function applyTruthfulContract<T extends Record<string, unknown>>(
  legacy: T,
  contract: ChefReply,
  enabled: boolean,
): T & { status?: ChefReply["status"]; replyText?: string; quickReplies?: ChefReply["quickReplies"]; content?: unknown } {
  if (!enabled) return legacy;
  return {
    ...legacy,
    content: contract.replyText,
    status: contract.status,
    operation: contract.operation,
    replyText: contract.replyText,
    quickReplies: contract.quickReplies,
  };
}

export type ChefLifecycleInput = {
  requestId: string;
  familyId: number;
  chatId?: string;
  clientMessageId?: string;
  intent: ChefIntent;
  lang?: string;
  payload: unknown;
  requestedCredits: number;
  store?: ChefRequestStore;
  reserveCredit: (requestedCredits: number) => Promise<number | undefined>;
  commitCredit: (reservationId: number) => Promise<void>;
  refundCredit: (reservationId: number) => Promise<void>;
  run: () => Promise<ChefRunResult>;
};

export type ChefLifecycleResult = {
  reply: ChefReply;
  decision: "miss" | "reuse";
  creditsCharged: number;
  llmCalls: number;
};

/**
 * Idempotency + charging lifecycle shared by the router. A repeated
 * clientMessageId with the same payload returns the stored reply without
 * reserving or charging credit again.
 */
export async function runChefLifecycle(input: ChefLifecycleInput): Promise<ChefLifecycleResult> {
  const key: ChefRequestKey = {
    familyId: input.familyId,
    chatId: input.chatId,
    clientMessageId: input.clientMessageId,
  };
  const keyString = buildClientMessageKey({ familyId: key.familyId, chatId: key.chatId, clientMessageId: key.clientMessageId });
  const payloadHash = hashChefPayload(input.payload);
  let claimed = false;

  if (keyString && input.store) {
    if (input.store.claim) {
      const claim = await input.store.claim(key, payloadHash);
      if (claim.decision === "conflict") throw new ChefIdempotencyConflictError();
      if (claim.decision === "reuse") {
        return { reply: claim.cached.response as ChefReply, decision: "reuse", creditsCharged: 0, llmCalls: 0 };
      }
      claimed = true;
    } else {
      const cached = await input.store.find(key);
      const decision = getIdempotencyDecision(cached, payloadHash);
      if (decision === "conflict") throw new ChefIdempotencyConflictError();
      if (decision === "reuse") {
        return { reply: cached!.response as ChefReply, decision: "reuse", creditsCharged: 0, llmCalls: 0 };
      }
    }
  }

  const reservationId = await input.reserveCredit(input.requestedCredits);
  let result: ChefRunResult;
  try {
    result = await input.run();
  } catch (error) {
    if (reservationId !== undefined) await input.refundCredit(reservationId);
    if (claimed && input.store?.release) await input.store.release(key);
    throw error;
  }

  const reply = buildChefReply({
    requestId: input.requestId,
    chatId: input.chatId,
    clientMessageId: input.clientMessageId,
    intent: input.intent,
    result,
    lang: input.lang,
  });
  const errors = validateChefReply(reply);
  if (errors.length > 0) {
    if (reservationId !== undefined) await input.refundCredit(reservationId);
    if (claimed && input.store?.release) await input.store.release(key);
    throw new ChefReplyContractError(errors);
  }

  const charge = shouldChargeChefRequest({
    served: reply.served,
    aiCards: result.recipes.filter((recipe) => (recipe.source ?? "ai") === "ai").length,
  });
  if (reservationId !== undefined) {
    if (charge) await input.commitCredit(reservationId);
    else await input.refundCredit(reservationId);
  }
  const creditsCharged = reservationId !== undefined && charge ? input.requestedCredits : 0;

  if (keyString && input.store) {
    await input.store.save(key, { payloadHash, response: reply });
  }

  return { reply, decision: "miss", creditsCharged, llmCalls: result.llmCalls ?? 0 };
}
