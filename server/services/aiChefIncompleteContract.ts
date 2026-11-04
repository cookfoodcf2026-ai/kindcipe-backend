import { createHash } from "node:crypto";

export type IncompleteContractStatus = "complete" | "incomplete";

export type IncompleteContractOutcome = {
  enabled: boolean;
  /** False for chat/technique turns that do not request cards. */
  applies: boolean;
  status: IncompleteContractStatus;
  requiredCards: number;
  served: number;
  /** Partial sets must never charge, even when they contain AI cards. */
  shouldCharge: boolean;
  retryToken?: string;
};

/** Deterministic token so the same initial request can be retried with the same
 *  key without adding a column or a new table. */
export function deriveChefRetryToken(params: {
  familyId: number;
  chatId?: string;
  clientMessageId?: string;
  payloadHash: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify([
      "ai-chef-retry-v1",
      params.familyId,
      params.chatId ?? "",
      params.clientMessageId ?? "",
      params.payloadHash,
    ]))
    .digest("hex")
    .slice(0, 32);
}

export function resolveIncompleteContract(params: {
  enabled: boolean;
  requiredCards: number;
  served: number;
  shouldCharge: boolean;
  retryToken?: string;
}): IncompleteContractOutcome {
  const requiredCards = Number.isFinite(params.requiredCards)
    ? Math.max(0, Math.floor(params.requiredCards))
    : 0;
  const served = Number.isFinite(params.served)
    ? Math.max(0, Math.floor(params.served))
    : 0;
  const applies = params.enabled && requiredCards > 0;
  const complete = served >= requiredCards;

  return {
    enabled: params.enabled,
    applies,
    status: complete ? "complete" : "incomplete",
    requiredCards,
    served,
    // Flag OFF keeps the legacy charge decision. Only a partial set under the
    // new contract is forced free.
    shouldCharge: applies && !complete ? false : params.shouldCharge,
    retryToken: params.retryToken,
  };
}

/** Contract fields added to the public response. Empty when the contract does
 *  not apply, so flag OFF is byte-for-byte unchanged. */
export function incompleteContractResponseFields(
  outcome: IncompleteContractOutcome,
  creditCharged: number,
): Record<string, unknown> {
  if (!outcome.applies) return {};
  return {
    status: outcome.status,
    requiredCards: outcome.requiredCards,
    creditCharged: creditCharged > 0,
    ...(outcome.retryToken ? { retryToken: outcome.retryToken } : {}),
  };
}
