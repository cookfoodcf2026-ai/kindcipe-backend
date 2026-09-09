/**
 * Model Router — 負責根據任務類型將 LLM 請求路由到最適合嘅模型
 * 
 * Model Mapping:
 *   - deepseek-v3     → 對話、邏輯處理、JSON 提取
 *   - gemini-2.5-flash → Vision/多模態、圖片辨識、雪櫃分析
 */

import { ENV } from "../_core/env";
import { invokeLLM } from "../_core/llm";

// ── DeepSeek 配置 ──────────────────────────────────────────────
const DEEP_SEEK_BASE_URL =
  process.env.DEEP_SEEK_BASE_URL ??
  "https://api.deepseek.com/v1"; // 生產時替換為真實 endpoint

const DEEP_SEEK_API_KEY = process.env.DEEP_SEEK_API_KEY ?? "";

// ── Gemini 配置 ────────────────────────────────────────────────
const GEMINI_BASE_URL =
  process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/models";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";

// ── 測試用：預設模型 ───────────────────────────────────────────
// 若環境變數未設定，回退至 Qwen (保持原有行為不受影響)
const DEFAULT_TEXT_MODEL = "qwen3.7-flash";
const DEFAULT_VISION_MODEL = "qwen3.7-flash";

/**
 * 判斷是否為 Vision 請求（包含 image_url 內容）
 */
function hasImageContent(messages: any[]): boolean {
  return messages.some((msg: any) => {
    if (typeof msg.content === "string") return false;
    return msg.content?.some?.((c: any) => c?.type === "image_url");
  });
}

/**
 * Route LLM request to the appropriate model
 * @param messages - 對話訊息陣列
 * @param taskType - 任務類型： "chat" | "vision" | "json" | "free_chat"
 * @returns LLMResult - API 回應結果
 */
export async function routeLLM(
  messages: any[],
  taskType: "chat" | "vision" | "json" | "free_chat" = "chat"
) {
  // 根據任務類型選擇模型
  const isVision = hasImageContent(messages);

  if (taskType === "vision" || isVision) {
    // Vision 任務 → Gemini
    if (!GEMINI_API_KEY) {
      console.warn("[ModelRouter] GEMINI_API_KEY not set, falling back to Qwen vision");
      return invokeLLM({
        messages,
        model: DEFAULT_VISION_MODEL,
        maxTokens: 4096,
        temperature: 0.7,
      });
    }
    return invokeGeminiVision(messages);
  }

  if (taskType === "json") {
    // JSON 提取任務 → DeepSeek (較好解析結構化輸出)
    if (!DEEP_SEEK_API_KEY) {
      console.warn("[ModelRouter] DEEP_SEEK_API_KEY not set, falling back to Qwen");
      return invokeLLM({
        messages,
        model: DEFAULT_TEXT_MODEL,
        maxTokens: 2048,
        temperature: 0.3,
        responseFormat: {
          type: "json_schema",
          json_schema: {
            name: "recipe",
            strict: true,
            schema: {
              type: "object",
              properties: {
                name: { type: "string" },
                ingredients: {
                  type: "array",
                  items: { type: "object", properties: { name: { type: "string" }, quantity: { type: "number" }, unit: { type: "string" } } },
                },
                steps: { type: "array", items: { type: "string" } },
              },
              required: ["name", "ingredients", "steps"],
              additionalProperties: false,
            },
          },
        },
      });
    }
    return invokeDeepSeekJson(messages);
  }

  // 預設：對話/邏輯任務 → DeepSeek
  if (!DEEP_SEEK_API_KEY) {
    console.warn("[ModelRouter] DEEP_SEEK_API_KEY not set, falling back to Qwen");
    return invokeLLM({
      messages,
      model: DEFAULT_TEXT_MODEL,
      maxTokens: 4096,
      temperature: 0.7,
    });
  }
  return invokeDeepSeekChat(messages);
}

/**
 * 調用 Gemini Vision (2.5 Flash)
 */
async function invokeGeminiVision(messages: any[]) {
  // 過濾出 image 內容
  const imageParts = messages
    .filter((msg: any) => msg.role === "user")
    .flatMap((msg: any) =>
      Array.isArray(msg.content)
        ? msg.content.filter((c: any) => c?.type === "image_url")
        : []
    );

  const base64Images = imageParts.map((p: any) => p.image_url.url);

  // Gemini 要求將圖片轉為 parts 格式
  const geminiMessages = [...messages].map((msg: any) => {
    if (msg.role === "system") return msg;
    if (msg.role === "user" && Array.isArray(msg.content)) {
      const textParts = msg.content
        .filter((c: any) => c.type !== "image_url")
        .map((c: any) => c.text);
      return {
        role: "user",
        parts: [...textParts, ...base64Images.map((u: string) => ({ image_url: { url: u } }))],
      };
    }
    return msg;
  });

  const modelName = "gemini-2.5-flash";
  const baseUrl = GEMINI_BASE_URL;
  const apiKey = GEMINI_API_KEY;

  // Gemini API: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}
  const url = `${baseUrl}/${modelName}:generateContent?key=${apiKey}`;

  const body = {
    contents: geminiMessages.map((m: any) => ({
      role: m.role,
      parts: Array.isArray(m.parts) ? m.parts : [{ text: String(m.content) }],
    })),
    // 配置思考預算（可選）
    // thinkingConfig: { thinkingBudget: 0 },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[ModelRouter] Gemini Vision error:", response.status, errorText);
      throw new Error(`Gemini Vision failed: ${response.status}`);
    }

    const data = await response.json();
    // 解析 Gemini 回應格式
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return { choices: [{ message: { role: "assistant", content: text } }] };
  } catch (err) {
    console.error("[ModelRouter] Gemini Vision exception:", err);
    throw err;
  }
}

/**
 * 調用 DeepSeek 用於 JSON 結構化輸出
 */
async function invokeDeepSeekJson(messages: any[]) {
  // DeepSeek 支援 response_format: json_schema
  const body = {
    model: "deepseek-chat",
    messages,
    temperature: 0.3,
    maxTokens: 2048,
    response_format: {
      type: "json_object", // DeepSeek 支援 json_object
    },
  };

  try {
    const response = await fetch(`${DEEP_SEEK_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DEEP_SEEK_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[ModelRouter] DeepSeek JSON error:", response.status, errorText);
      throw new Error(`DeepSeek JSON failed: ${response.status}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || "{}";
    return { choices: [{ message: { role: "assistant", content } }] };
  } catch (err) {
    console.error("[ModelRouter] DeepSeek JSON exception:", err);
    throw err;
  }
}

/**
 * 調用 DeepSeek 用於普通對話/邏輯處理
 */
async function invokeDeepSeekChat(messages: any[]) {
  const body = {
    model: "deepseek-chat",
    messages,
    temperature: 0.7,
    maxTokens: 4096,
  };

  try {
    const response = await fetch(`${DEEP_SEEK_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DEEP_SEEK_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[ModelRouter] DeepSeek Chat error:", response.status, errorText);
      throw new Error(`DeepSeek Chat failed: ${response.status}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || "";
    return { choices: [{ message: { role: "assistant", content } }] };
  } catch (err) {
    console.error("[ModelRouter] DeepSeek Chat exception:", err);
    throw err as Error;
  }
}

