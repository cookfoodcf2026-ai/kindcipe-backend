export type ChefChargeInput = {
  llmUsed: boolean;
  requested: number;
  served: number;
  /** The user asked for cards (meal/recipe), even if intent requested.total is 0. */
  wantsCards?: boolean;
  /** The reply text promises recipe cards that were not served. */
  cardClaim?: boolean;
};

/**
 * A partial recipe set is a failed request for the user, so it must not consume
 * a paid AI credit. Text-only answers (requested=0) keep the normal LLM charge —
 * unless the text promised cards that do not exist, which is a broken request
 * dressed up as a delivered one.
 */
export function shouldChargeChefRequest({ llmUsed, requested, served, wantsCards, cardClaim }: ChefChargeInput): boolean {
  if (!llmUsed) return false;
  if (served === 0 && wantsCards === true) return false;
  if (served === 0 && cardClaim === true) return false;
  if (requested > 0 && served < requested) return false;
  return true;
}
