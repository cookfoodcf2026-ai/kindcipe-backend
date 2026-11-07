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
