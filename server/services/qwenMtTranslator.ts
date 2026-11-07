import { invokeLLM } from "../_core/llm";

export type TargetStepLang = "en" | "fil" | "id";
export type QwenMtEngine = "qwen-mt-flash" | "engine-a";

export type StepParseResult = {
  ok: boolean;
  steps: string[];
  issues: string[];
};

export type QwenMtDeps = {
  fetchImpl?: typeof fetch;
  invokeImpl?: (prompt: string) => Promise<string>;
  apiKey?: string;
  baseUrl?: string;
};

export type QwenMtResult = {
  steps: string[];
  engine: QwenMtEngine;
  attempts: number;
};

export type RecipeSectionResult = {
  ok: boolean;
  name: string;
  description: string;
  steps: string[];
  issues: string[];
};

export type QwenMtRecipeResult = {
  fields: {
    nameEn?: string;
    nameFil?: string;
    nameId?: string;
    descriptionEn?: string;
    descriptionFil?: string;
    descriptionId?: string;
    stepsEn?: string[];
    stepsFil?: string[];
    stepsId?: string[];
  };
  engines: Record<TargetStepLang, QwenMtEngine>;
  attempts: Record<TargetStepLang, number>;
};

export class QwenMtTranslationError extends Error {
  readonly issues: string[];
  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = "QwenMtTranslationError";
    this.issues = issues;
  }
}

const MODEL = "qwen-mt-flash";
const LANG_NAME: Record<TargetStepLang, string> = {
  en: "English",
  fil: "Filipino",
  id: "Indonesian",
};

export function parseNumberedSteps(text: string, expectedCount: number): StepParseResult {
  const issues: string[] = [];
  const steps: string[] = [];
  const lines = String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^(\d+)[.)、:：-]\s*(.+)$/);
    if (!match) {
      issues.push(`unexpected non-numbered line: ${line.slice(0, 60)}`);
      continue;
    }
    const number = Number(match[1]);
    if (number !== steps.length + 1) {
      issues.push(`expected step ${steps.length + 1}, got ${number}`);
      continue;
    }
    const body = match[2].trim();
    if (!body) {
      issues.push(`empty step ${number}`);
      continue;
    }
    steps.push(body);
  }
  if (steps.length !== expectedCount) issues.push(`expected ${expectedCount} steps, got ${steps.length}`);
  return { ok: issues.length === 0, steps, issues };
}

export function parseRecipeSections(text: string, expectedSteps: number): RecipeSectionResult {
  const raw = String(text ?? "");
  const nameIdx = raw.lastIndexOf("<<<NAME>>>");
  const descIdx = raw.lastIndexOf("<<<DESCRIPTION>>>");
  const stepsIdx = raw.lastIndexOf("<<<STEPS>>>");
  const issues: string[] = [];
  if (nameIdx < 0) issues.push("missing <<<NAME>>> marker");
  if (descIdx < 0) issues.push("missing <<<DESCRIPTION>>> marker");
  if (stepsIdx < 0) issues.push("missing <<<STEPS>>> marker");
  if (nameIdx < 0 || descIdx < 0 || stepsIdx < 0 || !(nameIdx < descIdx && descIdx < stepsIdx)) {
    return { ok: false, name: "", description: "", steps: [], issues };
  }
  const name = raw.slice(nameIdx + "<<<NAME>>>".length, descIdx).trim();
  const description = raw.slice(descIdx + "<<<DESCRIPTION>>>".length, stepsIdx).trim();
  if (!name) issues.push("empty name");
  const parsedSteps = parseNumberedSteps(raw.slice(stepsIdx + "<<<STEPS>>>".length), expectedSteps);
  issues.push(...parsedSteps.issues);
  return { ok: issues.length === 0, name, description, steps: parsedSteps.steps, issues };
}

function buildPrompt(steps: string[], target: TargetStepLang, terms: string[]): string {
  return `Translate these Chinese cooking steps into ${LANG_NAME[target]}.
Return exactly one numbered line per source step. Keep the same count and order.
Do not add, remove, merge, or split steps. Preserve quantities, units, and times.
Do not invent ingredients. Use these ingredient terms where relevant:
${terms.length ? terms.join("\n") : "(none provided)"}

Source steps:
${steps.map((step, i) => `${i + 1}. ${step}`).join("\n")}`;
}

async function callQwenMt(prompt: string, deps: QwenMtDeps): Promise<string> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const baseUrl = deps.baseUrl ?? process.env.DASHSCOPE_BASE_URL ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
  const apiKey = deps.apiKey ?? process.env.DASHSCOPE_API_KEY ?? "";
  if (!apiKey) throw new QwenMtTranslationError("DASHSCOPE_API_KEY is not set");
  const response = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2500,
      temperature: 0.2,
    }),
  });
  const data: any = await response.json();
  if (!response.ok) {
    throw new QwenMtTranslationError(`qwen-mt ${response.status}: ${JSON.stringify(data).slice(0, 160)}`);
  }
  return String(data?.choices?.[0]?.message?.content ?? "");
}

async function callEngineA(prompt: string, deps: QwenMtDeps): Promise<string> {
  if (deps.invokeImpl) return deps.invokeImpl(prompt);
  const response = await invokeLLM({
    messages: [{ role: "user", content: prompt }],
    maxTokens: 2500,
    temperature: 0.2,
    timeoutMs: 45000,
    maxRetries: 0,
  });
  return String(response.choices?.[0]?.message?.content ?? "");
}

function buildRecipePrompt(input: { name: string; description?: string; steps: string[]; targetLang: TargetStepLang; terms: string[] }): string {
  return `Translate this Chinese recipe into ${LANG_NAME[input.targetLang]}.
Keep these markers EXACTLY, one per section:
<<<NAME>>>
<<<DESCRIPTION>>>
<<<STEPS>>>
Rules:
- Keep the exact same number and order of steps.
- Preserve quantities, units, and times.
- Do not invent ingredients. Every ingredient mentioned in steps must be in the ingredient list.
- Use these ingredient terms where relevant:
${input.terms.length ? input.terms.join("\n") : "(none provided)"}

<<<NAME>>>
${input.name}
<<<DESCRIPTION>>>
${input.description ?? ""}
<<<STEPS>>>
${input.steps.map((step, i) => `${i + 1}. ${step}`).join("\n")}`;
}

async function translateRecipeSection(
  prompt: string,
  expectedSteps: number,
  deps: QwenMtDeps,
): Promise<{ result: RecipeSectionResult; engine: QwenMtEngine; attempts: number }> {
  let lastIssues: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await callQwenMt(prompt, deps);
      const parsed = parseRecipeSections(raw, expectedSteps);
      if (parsed.ok) return { result: parsed, engine: "qwen-mt-flash", attempts: attempt };
      lastIssues = parsed.issues;
    } catch (error) {
      lastIssues = [String((error as Error)?.message ?? error)];
    }
  }
  try {
    const raw = await callEngineA(prompt, deps);
    const parsed = parseRecipeSections(raw, expectedSteps);
    if (parsed.ok) return { result: parsed, engine: "engine-a", attempts: 3 };
    throw new QwenMtTranslationError("Engine A returned invalid recipe output", parsed.issues);
  } catch (error) {
    if (error instanceof QwenMtTranslationError) throw error;
    throw new QwenMtTranslationError("Both qwen-mt and engine A failed", [
      ...lastIssues,
      String((error as Error)?.message ?? error),
    ]);
  }
}

export async function translateRecipeWithQwenMt(input: {
  name: string;
  description?: string;
  steps: string[];
  ingredientTerms?: string[];
  deps?: QwenMtDeps;
}): Promise<QwenMtRecipeResult> {
  const steps = input.steps.map((step) => String(step ?? "").trim()).filter(Boolean);
  if (steps.length === 0) throw new QwenMtTranslationError("source recipe has no steps");
  const fields: QwenMtRecipeResult["fields"] = {};
  const engines = {} as Record<TargetStepLang, QwenMtEngine>;
  const attempts = {} as Record<TargetStepLang, number>;
  for (const lang of ["en", "fil", "id"] as const) {
    const prompt = buildRecipePrompt({
      name: input.name,
      description: input.description,
      steps,
      targetLang: lang,
      terms: input.ingredientTerms ?? [],
    });
    const translated = await translateRecipeSection(prompt, steps.length, input.deps ?? {});
    engines[lang] = translated.engine;
    attempts[lang] = translated.attempts;
    if (lang === "en") {
      fields.nameEn = translated.result.name;
      fields.descriptionEn = translated.result.description;
      fields.stepsEn = translated.result.steps;
    } else if (lang === "fil") {
      fields.nameFil = translated.result.name;
      fields.descriptionFil = translated.result.description;
      fields.stepsFil = translated.result.steps;
    } else {
      fields.nameId = translated.result.name;
      fields.descriptionId = translated.result.description;
      fields.stepsId = translated.result.steps;
    }
  }
  return { fields, engines, attempts };
}

export async function translateStepsWithQwenMt(input: {
  steps: string[];
  targetLang: TargetStepLang;
  ingredientTerms?: string[];
  deps?: QwenMtDeps;
}): Promise<QwenMtResult> {
  const steps = input.steps.map((step) => String(step ?? "").trim()).filter(Boolean);
  if (steps.length === 0) return { steps: [], engine: "qwen-mt-flash", attempts: 0 };
  const deps = input.deps ?? {};
  const prompt = buildPrompt(steps, input.targetLang, input.ingredientTerms ?? []);
  let lastIssues: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await callQwenMt(prompt, deps);
      const parsed = parseNumberedSteps(raw, steps.length);
      if (parsed.ok) return { steps: parsed.steps, engine: "qwen-mt-flash", attempts: attempt };
      lastIssues = parsed.issues;
    } catch (error) {
      lastIssues = [String((error as Error)?.message ?? error)];
    }
  }

  try {
    const fallbackRaw = await callEngineA(prompt, deps);
    const fallback = parseNumberedSteps(fallbackRaw, steps.length);
    if (fallback.ok) return { steps: fallback.steps, engine: "engine-a", attempts: 3 };
    throw new QwenMtTranslationError("Engine A returned invalid step output", fallback.issues);
  } catch (error) {
    if (error instanceof QwenMtTranslationError) throw error;
    throw new QwenMtTranslationError("Both qwen-mt and engine A failed", [
      ...lastIssues,
      String((error as Error)?.message ?? error),
    ]);
  }
}
