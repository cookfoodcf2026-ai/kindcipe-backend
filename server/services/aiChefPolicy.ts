export type ChefChargeInput = {
  llmUsed: boolean;
  requested: number;
  served: number;
};

/**
 * A partial recipe set is a failed request for the user, so it must not consume
 * a paid AI credit. Text-only answers (requested=0) keep the normal LLM charge.
 */
export function shouldChargeChefRequest({ llmUsed, requested, served }: ChefChargeInput): boolean {
  if (!llmUsed) return false;
  if (requested > 0 && served < requested) return false;
  return true;
}
