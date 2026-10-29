export type ChefChargeInput = {
  /** Cards actually returned to the user. */
  served: number;
  /** Cards produced by the LLM (source === "ai"). */
  aiCards: number;
};

/**
 * Product rule: only served AI-generated cards consume a credit.
 * Pure library cards, pure text chat, and zero-card responses are free.
 * This decision intentionally does not depend on mode/path.
 */
export function shouldChargeChefRequest({ served, aiCards }: ChefChargeInput): boolean {
  return served > 0 && aiCards > 0;
}
