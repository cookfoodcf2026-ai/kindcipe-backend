import { randomUUID } from "node:crypto";
import { startLlmMeter, type LlmMeter } from "../_core/llm";

/** Start an import-parse LLM meter so recordLlmUsage() can attribute cost to
 * the family/monthly ledger with route=recipe_import. */
export function startRecipeImportMeter(familyId: number, userId: string, requestId: string = randomUUID()): LlmMeter {
  console.log(`[LLM cost] route=recipe_import family=${familyId} request=${requestId}`);
  return startLlmMeter({ familyId, userId, route: "recipe_import", requestId });
}
