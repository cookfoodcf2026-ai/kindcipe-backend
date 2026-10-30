import assert from "node:assert/strict";
import test from "node:test";
import { getLlmMeter } from "../_core/llm";
import { startRecipeImportMeter } from "./recipeImportMeter";

test("import parse uses recipe_import llm meter", () => {
  const meter = startRecipeImportMeter(1234, "user-1", "req-import-1");
  assert.equal(meter.context?.familyId, 1234);
  assert.equal(meter.context?.userId, "user-1");
  assert.equal(meter.context?.route, "recipe_import");
  assert.equal(meter.context?.requestId, "req-import-1");
  assert.equal(getLlmMeter(), meter);
});
