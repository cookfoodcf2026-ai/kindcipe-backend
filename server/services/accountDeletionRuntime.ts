import { getStripe } from "../_core/stripe";
import { accountDeletionStore } from "../db";
import { deleteAccount, type DeleteAccountResult } from "./accountDeletion";

/**
 * Production wiring: real DB store + real Stripe API. Kept separate from the
 * pure orchestrator so tests never import the database or Stripe SDK.
 */
export async function requestAccountDeletion(userId: string): Promise<DeleteAccountResult> {
  return deleteAccount(userId, {
    store: accountDeletionStore,
    stripe: {
      async cancel(subscriptionId: string) {
        await getStripe().subscriptions.cancel(subscriptionId);
      },
    },
  });
}
