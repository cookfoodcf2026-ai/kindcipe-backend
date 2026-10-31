export type ImportSource = "instagram" | "facebook" | "youtube" | "xiaohongshu" | "threads" | "tiktok" | "web" | "text" | "image";
export type ImportParseResult = "ok" | "no_content" | "blocked" | "partial" | "timeout" | "llm_fail" | "save_fail";
export type ImportStepsSource = "description" | "transcript" | "llm" | "none";

export type ImportParseEvent = {
  event: "import_parse";
  source: ImportSource;
  result: ImportParseResult;
  hasCaption: boolean;
  captionChars: number;
  hasIngredients: boolean;
  ingredientCount: number;
  stepCount: number;
  stepsSource: ImportStepsSource;
  stageMs: { fetch: number; parse: number; translate: number; classify: number };
  familyId?: number;
};

export function classifyImportParseResult(input: {
  parseReason?: string | null;
  ingredientCount: number;
  stepCount: number;
  source: ImportSource;
  pageContentChars?: number;
  hasCaption?: boolean;
  error?: unknown;
}): ImportParseResult {
  const message = String((input.error as Error)?.message ?? input.error ?? "");
  if (/timeout|timed out|ETIMEDOUT/i.test(message)) return "timeout";
  if (input.error) return "llm_fail";
  if (input.parseReason === "cannot_read") {
    const social = ["instagram", "facebook", "tiktok", "threads", "xiaohongshu"].includes(input.source);
    if (social && (input.pageContentChars ?? 0) === 0 && !input.hasCaption) return "blocked";
    return "no_content";
  }
  if (input.ingredientCount > 0 && input.stepCount > 0) return "ok";
  if (input.ingredientCount > 0 || input.stepCount > 0) return "partial";
  return input.parseReason === "no_recipe_content" ? "no_content" : "no_content";
}

export function buildImportParseEvent(input: Omit<ImportParseEvent, "event">): ImportParseEvent {
  return {
    event: "import_parse",
    source: input.source,
    result: input.result,
    hasCaption: input.hasCaption,
    captionChars: Math.max(0, Math.round(input.captionChars)),
    hasIngredients: input.hasIngredients,
    ingredientCount: Math.max(0, Math.round(input.ingredientCount)),
    stepCount: Math.max(0, Math.round(input.stepCount)),
    stepsSource: input.stepsSource,
    stageMs: {
      fetch: Math.max(0, Math.round(input.stageMs.fetch)),
      parse: Math.max(0, Math.round(input.stageMs.parse)),
      translate: Math.max(0, Math.round(input.stageMs.translate)),
      classify: Math.max(0, Math.round(input.stageMs.classify)),
    },
    ...(input.familyId != null ? { familyId: input.familyId } : {}),
  };
}

export function emitImportParseEvent(input: Omit<ImportParseEvent, "event">): void {
  console.log(JSON.stringify(buildImportParseEvent(input)));
}

export function importTelemetrySource(sourceType: string): ImportSource {
  if (sourceType === "import" || sourceType === "manual") return "web";
  if (sourceType === "text" || sourceType === "image") return sourceType;
  if (["instagram", "facebook", "youtube", "xiaohongshu", "threads", "tiktok"].includes(sourceType)) {
    return sourceType as ImportSource;
  }
  return "web";
}
