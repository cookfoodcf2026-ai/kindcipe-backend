/**
 * DashScope (Qwen) LLM Helper
 * 使用阿里雲 DashScope OpenAI-compatible API，支援文字 + 圖片 Vision
 *
 * 需要的環境變數：
 *   DASHSCOPE_API_KEY  - API Key（必填）
 *   DASHSCOPE_BASE_URL - API endpoint（選填，預設新加坡 region）
 */

import { ENV } from "./env";

const DEFAULT_TEXT_MODEL = "qwen3.7-flash";
const DEFAULT_VISION_MODEL = "qwen3.7-flash";
const DEFAULT_MAX_TOKENS = 8192;

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
}

export type MessageContent = string | Array<TextContent | ImageContent>;

export interface Message {
  role: MessageRole;
  content: MessageContent;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface LLMParams {
  messages: Message[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  maxRetries?: number;
  responseFormat?: {
    type: "json_object";
  } | {
    type: "json_schema";
    json_schema: {
      name: string;
      strict: boolean;
      schema: object;
    };
  };
  enableSearch?: boolean;
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
}

export interface LLMResult {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

function hasImageContent(messages: Message[]): boolean {
  return messages.some((msg) => {
    if (typeof msg.content === "string") return false;
    return msg.content.some((c) => c.type === "image_url");
  });
}

/**
 * Concurrency guard for LLM calls — protects the DashScope QPS budget and keeps
 * the process from being overwhelmed by a burst of AI requests. Excess calls
 * wait in a FIFO queue instead of failing.
 */
const MAX_CONCURRENT_LLM = Number(process.env.MAX_CONCURRENT_LLM ?? 16);
let _llmActive = 0;
const _llmQueue: Array<() => void> = [];

async function acquireLlmSlot(): Promise<void> {
  if (_llmActive < MAX_CONCURRENT_LLM) {
    _llmActive++;
    return;
  }
  await new Promise<void>((resolve) => _llmQueue.push(resolve));
  _llmActive++;
}

function releaseLlmSlot(): void {
  _llmActive = Math.max(0, _llmActive - 1);
  const next = _llmQueue.shift();
  if (next) next();
}

export async function invokeLLM(params: LLMParams): Promise<LLMResult> {
  await acquireLlmSlot();
  try {
    return await invokeLLMInner(params);
  } finally {
    releaseLlmSlot();
  }
}

// ─── Gemini fallback (resilience) ─────────────────────────────────────────────
// 當 DashScope key 失效/配額/網絡問題令所有 retry 都失敗時，用 Gemini 頂住，
// 避免成個 AI 生成（3餸1湯、AI 補缺、換菜）跌返「1 卡/random」。
const GEMINI_KEY = process.env.GEMINI_API_KEY ?? "";
const GEMINI_BASE = process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODEL = process.env.GEMINI_TEXT_MODEL ?? "gemini-2.5-flash";

async function invokeGeminiFallback(params: LLMParams): Promise<LLMResult> {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY not set — no LLM fallback available");

  // 將 OpenAI 格式 messages 轉做 Gemini 格式（system → 併入 user 開頭）
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
  let systemText = "";
  for (const m of params.messages) {
    const text =
      typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ")
          : "";
    if (m.role === "system") { systemText += text + "\n"; continue; }
    if (m.role === "user") {
      if (systemText) { contents.push({ role: "user", parts: [{ text: systemText + text }] }); systemText = ""; }
      else contents.push({ role: "user", parts: [{ text }] });
    } else {
      contents.push({ role: "model", parts: [{ text }] });
    }
  }
  if (systemText && contents.length > 0) contents[0].parts[0].text = systemText + contents[0].parts[0].text;

  const url = `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: params.maxTokens ?? 2000,
      temperature: params.temperature ?? 0.7,
      ...(params.responseFormat?.type === "json_object" ? { responseMimeType: "application/json" } : {}),
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 30000);
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Gemini fallback failed: ${res.status} – ${t.slice(0, 150)}`);
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
    return {
      choices: [{ message: { role: "assistant", content: text, tool_calls: undefined }, finish_reason: "stop" }],
      usage: undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function invokeLLMInner(params: LLMParams): Promise<LLMResult> {
  const apiKey = ENV.dashScopeApiKey;
  if (!apiKey) {
    throw new Error(
      "DASHSCOPE_API_KEY is not set. Get one from https://modelstudio.console.alibabacloud.com"
    );
  }

  const hasVision = hasImageContent(params.messages);
  const model =
    params.model ?? (hasVision ? DEFAULT_VISION_MODEL : DEFAULT_TEXT_MODEL);
  const baseUrl = ENV.dashScopeBaseUrl;
  
  // Hard timeout: 15s (Gemini suggestion - fail fast, don't make user wait 60s)
  const HARD_TIMEOUT_MS = params.timeoutMs ?? 15000;
  
  // Retry logic with exponential backoff (Gemini + DeepSeek)
  // 可以經 maxRetries 收窄（例如 meal 生成唔想重試放大 timeout），default 2 不變
  const MAX_RETRIES = params.maxRetries ?? 2;
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const retryStart = Date.now();
    
    if (attempt > 0) {
      console.log(`[LLM] Retry attempt ${attempt}/${MAX_RETRIES} (simplified prompt)`);
    }
    
    // Simplify prompt on retry (remove tools, shorten context)
    const isRetry = attempt > 0;
    const body: Record<string, unknown> = {
      model,
      messages: params.messages,
      max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: isRetry ? 0.5 : (params.temperature ?? 0.7),  // More stable on retry
      enable_thinking: false,
    };

    // On retry, remove tools to speed up (DeepSeek suggestion)
    if (params.tools && params.tools.length > 0 && !isRetry) {
      body.tools = params.tools;
    }

    if (params.responseFormat) {
      if (params.responseFormat.type === "json_object") {
        body.response_format = { type: "json_object" };
      } else {
        body.response_format = {
          type: params.responseFormat.type,
          json_schema: {
            name: params.responseFormat.json_schema.name,
            strict: params.responseFormat.json_schema.strict,
            schema: params.responseFormat.json_schema.schema,
          },
        };
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HARD_TIMEOUT_MS);

    try {
      const callStart = Date.now();
      console.log(`[LLM] Calling ${model} with ${params.messages.length} messages (timeout: ${HARD_TIMEOUT_MS}ms, attempt: ${attempt + 1})`);
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const callDuration = Date.now() - callStart;
      console.log(`[LLM] Response status: ${response.status} (duration: ${callDuration}ms)`);

      if (!response.ok) {
        const errorText = await response.text();
        console.log(`[LLM] Error body: ${errorText.slice(0, 200)}`);
        throw new Error(
          `DashScope API failed: ${response.status} – ${errorText}`
        );
      }

      let result: {
        id?: string;
        choices: Array<{
          index: number;
          message: { role: string; content: string | null; tool_calls?: ToolCall[] };
          finish_reason: string;
        }>;
        usage?: {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
        };
      };
      // LLM 有時會回非 JSON body（如 gateway 錯誤頁），response.json() 會拋 cryptic "Unexpected character: u"。
      // 包一層 catch，拋乾淨可重試嘅 error（仍會行下面 retry 邏輯）。
      try {
        result = (await response.json()) as typeof result;
      } catch (jsonErr) {
        throw new Error(`LLM 回覆格式異常（非 JSON）: ${String((jsonErr as Error)?.message || jsonErr).slice(0, 120)}`);
      }

      const totalDuration = Date.now() - retryStart;
      console.log(`[LLM] Success! Total attempt duration: ${totalDuration}ms`);
      return {
        choices: result.choices.map((c) => ({
          message: {
            role: c.message.role ?? "assistant",
            content: c.message.content,
            tool_calls: c.message.tool_calls,
          },
          finish_reason: c.finish_reason?.toLowerCase() ?? "stop",
        })),
        usage: result.usage
          ? {
              prompt_tokens: result.usage.prompt_tokens,
              completion_tokens: result.usage.completion_tokens,
              total_tokens: result.usage.total_tokens,
            }
          : undefined,
      };
    } catch (err) {
      clearTimeout(timeout);
      lastError = err as Error;
      const attemptDuration = Date.now() - retryStart;
      console.log(`[LLM] Attempt ${attempt + 1} failed after ${attemptDuration}ms: ${(err as Error).message}`);
      
      // Exponential backoff before retry (Gemini suggestion)
      if (attempt < MAX_RETRIES) {
        const backoffMs = 1000 * Math.pow(2, attempt);  // 1s, 2s
        console.log(`[LLM] Waiting ${backoffMs}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }
  
  // All retries exhausted
  const totalWaitTime = Date.now();
  if (lastError) {
    // 用 Gemini 頂住（DashScope 401/過期/配額/網絡問題時，唔好令 AI 生成全壞）
    try {
      console.log(`[LLM] DashScope exhausted after ${MAX_RETRIES + 1} attempts; falling back to Gemini...`);
      return await invokeGeminiFallback(params);
    } catch (fbErr) {
      console.error(`[LLM] Gemini fallback also failed: ${(fbErr as Error).message}`);
      console.error(`[LLM] All ${MAX_RETRIES + 1} attempts failed after ${totalWaitTime}ms`);
      throw lastError;
    }
  }
  
  // Should never reach here
  throw new Error("LLM call failed after all retries");
}

export async function parseRecipeFromImage(
  imageBase64: string,
  mimeType = "image/jpeg"
): Promise<string> {
  const result = await invokeLLM({
    messages: [
      {
        role: "system",
        content:
          "你是一個專業的食譜解析助手，專門從圖片中提取食譜資訊。請用繁體中文回答，並以 JSON 格式輸出。",
      },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${imageBase64}` },
          },
          {
            type: "text",
            text: `請從這張圖片中提取食譜資訊，以 JSON 格式輸出，包含以下欄位：
{
  "name": "食譜名稱",
  "description": "簡短描述",
  "servings": 人份數字,
  "cookTime": 烹飪時間分鐘數字,
  "difficulty": "easy/medium/hard",
  "ingredients": [{"name": "食材名", "quantity": "份量", "unit": "單位"}],
  "steps": ["步驟1", "步驟2"],
  "tags": ["標籤1", "標籤2"]
}
如果圖片不是食譜，請返回 {"error": "不是食譜圖片"}`,
          },
        ],
      },
    ],
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "recipe",
        strict: true,
        schema: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            servings: { type: "number" },
            cookTime: { type: "number" },
            difficulty: { type: "string" },
            ingredients: { type: "array" },
            steps: { type: "array" },
            tags: { type: "array" },
            error: { type: "string" },
          },
        },
      },
    },
  });

  return result.choices[0]?.message.content ?? "{}";
}

export function extractJSON<T = Record<string, unknown>>(raw: string): T {
  let content = raw.trim();
  // Strip markdown code fences
  if (content.startsWith("```")) {
    content = content.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
  }
  if (!content || /^undefined|null$/i.test(content)) {
    console.warn("[LLM] extractJSON received empty/invalid content");
    return {} as T;
  }
  const objectStart = content.indexOf("{");
  const objectEnd = content.lastIndexOf("}");
  const arrayStart = content.indexOf("[");
  const arrayEnd = content.lastIndexOf("]");

  if (objectStart !== -1 && objectEnd > objectStart) {
    content = content.slice(objectStart, objectEnd + 1);
  } else if (arrayStart !== -1 && arrayEnd > arrayStart) {
    content = content.slice(arrayStart, arrayEnd + 1);
  }
  try {
    return JSON.parse(content) as T;
  } catch (err) {
    console.warn("[LLM] extractJSON parse failed:", String((err as Error)?.message || err));
    return {} as T;
  }
}

/**
 * Extract the FIRST complete JSON value (object or array) from LLM output using
 * balanced-bracket scanning that respects string literals + escapes.
 *
 * Unlike extractJSON (first "{" .. last "}"), this survives:
 *  - two concatenated JSON objects  ({"a":1}{"b":2})
 *  - trailing prose after the JSON
 *  - braces inside string values
 * Returns null when no complete value is found.
 */
export function extractFirstJson<T = Record<string, unknown>>(raw: string): T | null {
  if (!raw) return null;
  let content = raw.trim();
  if (content.startsWith("```")) {
    content = content.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
  }
  const start = (() => {
    const o = content.indexOf("{");
    const a = content.indexOf("[");
    if (o === -1) return a;
    if (a === -1) return o;
    return Math.min(o, a);
  })();
  if (start === -1) return null;

  const open = content[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < content.length; i++) {
    const c = content[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(content.slice(start, i + 1)) as T;
        } catch (e) {
          console.warn("[LLM] extractFirstJson parse failed:", String((e as Error)?.message || e));
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Repair common JSON issues from LLM output
 * Handles: unquoted keys, truncated strings, unclosed braces
 */
export function repairJSON(content: string): string {
  // 1. 修復無引號鍵名：{title: "x"} -> {"title": "x"}
  content = content.replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":');
  
  // 2. 修復無引號字符串值 (簡單情況)
  content = content.replace(/:\s*([A-Za-z\u4e00-\u9fff]+)\s*([,}])/g, ': "$1"$2');
  
  // 3. 處理截斷字符串：補完未閉合的引號
  content = content.replace(/"[^"\\]*(?:\\.[^"\\]*)*$/g, (match) => {
    return match.endsWith('"') ? match : match + '"';
  });
  
  // 4. 補未閉合括號
  const openBraces = (content.match(/{/g) || []).length;
  const closeBraces = (content.match(/}/g) || []).length;
  const openBrackets = (content.match(/\[/g) || []).length;
  const closeBrackets = (content.match(/]/g) || []).length;
  
  content += '}'.repeat(Math.max(0, openBraces - closeBraces));
  content += ']'.repeat(Math.max(0, openBrackets - closeBrackets));
  
  // 5. 修復結尾逗號問題
  content = content.replace(/,(\s*[}\]])/g, '$1');
  
  return content;
}

/**
 * Fix5: 嘗試抽取「最後一個完整 JSON 值」前嘅有效部分 —— 處理 LLM 喺 array 中途截斷嘅情況
 * 做法：由最尾開始逐步嘗試 parse，搵到第一個成功嘅 JSON 就停
 */
export function salvageJSON(raw: string): Record<string, unknown> | null {
  let content = raw.trim();
  // 先剷走前後非 JSON 文字
  const s = content.indexOf("{");
  const e = content.lastIndexOf("}");
  if (s === -1 || e <= s) return null;
  content = content.slice(s, e + 1);

  // 先試直接 parse（可能已經完整）
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    // 繼續嘗試修復
  }

  // 逐步縮短（由最尾砍 1-2 字）再試 parse
  for (let cut = 1; cut < Math.min(400, content.length); cut += 2) {
    const candidate = repairJSON(content.slice(0, content.length - cut));
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      // 繼續試
    }
  }
  return null;
}

// ─── Streaming LLM call for SSE ──────────────────────────

export async function* invokeLLMStream(
  params: LLMParams
): AsyncGenerator<string> {
  const apiKey = ENV.dashScopeApiKey;
  if (!apiKey) throw new Error("DASHSCOPE_API_KEY is not set");

  const hasVision = hasImageContent(params.messages);
  const model = params.model ?? (hasVision ? DEFAULT_VISION_MODEL : DEFAULT_TEXT_MODEL);
  const baseUrl = ENV.dashScopeBaseUrl;

  const body: Record<string, unknown> = {
    model,
    messages: params.messages,
    max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: params.temperature ?? 0.7,
    stream: true,
    enable_thinking: false,
    stream_options: { include_usage: true },
  };

  if (params.enableSearch) body.enable_search = true;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 29000);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`DashScope stream failed: ${response.status} – ${errText.slice(0, 200)}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const jsonStr = trimmed.slice(5).trim();
      if (jsonStr === "[DONE]") return;

      try {
        const parsed = JSON.parse(jsonStr);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (typeof delta === "string") yield delta;
      } catch {
        // Skip unparseable lines
      }
    }
  }
}
