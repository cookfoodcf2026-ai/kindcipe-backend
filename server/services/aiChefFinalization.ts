import { TRPCError } from "@trpc/server";
import type { ChefReply } from "./chefResponse";

export type FinalizeChefDeps = {
  truthful: boolean;
  shouldCharge: boolean;
  requestedCredits: number;
  reservationId?: number;
  buildContract?: () => ChefReply;
  validate: (reply: ChefReply) => string[];
  buildLegacy: (contract: ChefReply | null) => Promise<Record<string, unknown>>;
  applyContract: (legacy: Record<string, unknown>, contract: ChefReply) => Record<string, unknown>;
  commitUsage?: (reservationId: number) => Promise<void>;
  refundUsage?: (reservationId: number) => Promise<void>;
  saveIdempotency?: (response: Record<string, unknown>) => Promise<void>;
  releaseIdempotency?: () => Promise<void>;
};

export type FinalizeChefResult = {
  response: Record<string, unknown>;
  contract: ChefReply | null;
  creditsCharged: number;
};

/**
 * The single place where a Chef response crosses the money/contract boundary.
 * Contract validation happens before commit; any later failure refunds.
 * This function does NOT change the public response shape; callers apply it.
 */
export async function finalizeChefRequest(deps: FinalizeChefDeps): Promise<FinalizeChefResult> {
  let contract: ChefReply | null = null;
  let committed = false;
  try {
    if (deps.truthful) {
      if (!deps.buildContract) throw new Error("truthful finalization requires buildContract");
      contract = deps.buildContract();
      const errors = deps.validate(contract);
      if (errors.length > 0) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 回覆格式異常，請再試。" });
      }
    }

    if (deps.reservationId !== undefined) {
      if (deps.shouldCharge) {
        if (!deps.commitUsage) throw new Error("missing commitUsage");
        await deps.commitUsage(deps.reservationId);
        committed = true;
      } else if (deps.refundUsage) {
        await deps.refundUsage(deps.reservationId);
      }
    }

    const legacy = await deps.buildLegacy(contract);
    const response = contract ? deps.applyContract(legacy, contract) : legacy;
    if (deps.saveIdempotency) await deps.saveIdempotency(response);
    return {
      response,
      contract,
      creditsCharged: deps.reservationId !== undefined && deps.shouldCharge ? deps.requestedCredits : 0,
    };
  } catch (error) {
    if (deps.reservationId !== undefined && deps.refundUsage) {
      await deps.refundUsage(deps.reservationId).catch(() => {});
    }
    if (deps.releaseIdempotency) await deps.releaseIdempotency().catch(() => {});
    throw error;
  }
}
