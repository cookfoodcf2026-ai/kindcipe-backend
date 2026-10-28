export type IdempotencyCached = {
  payloadHash: string;
  response: unknown;
};

export type IdempotencyDecision = "reuse" | "conflict" | "miss";

/** Decide what to do with a repeated client message. */
export function getIdempotencyDecision(
  cached: IdempotencyCached | undefined,
  payloadHash: string,
): IdempotencyDecision {
  if (!cached) return "miss";
  return cached.payloadHash === payloadHash ? "reuse" : "conflict";
}

/**
 * Stable key for a client message. Returns null when the client message id is
 * missing/invalid; callers then fall back to a non-idempotent request.
 */
export function buildClientMessageKey(params: {
  familyId: number;
  chatId: string | undefined;
  clientMessageId: string | undefined;
}): string | null {
  const messageId = String(params.clientMessageId ?? "").trim();
  if (!messageId) return null;
  return `${params.familyId}:${params.chatId ?? ""}:${messageId}`;
}
