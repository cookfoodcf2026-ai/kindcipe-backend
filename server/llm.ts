/**
 * Google Gemini API Helper
 * 替換 Manus 內建 LLM
 *
 * 需要的環境變數：
 *   GEMINI_API_KEY - Google AI Studio API Key（格式：AIzaSy...）
 *
 * 取得方式：https://aistudio.google.com → Get API key
 *
 * 定價（2026年）：
 *   Gemini 2.0 Flash: $0.10/1M input tokens, $0.40/1M output tokens
 *   免費方案：每天 1,500 次請求
 */

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-2.0-flash";

export type MessageRole = "user" | "assistant" | "system";

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image_url";
  image_url: {
    url: string; // base64 data URL 或 https URL
    detail?: "auto" | "low" | "high";
  };
}

export type MessageContent = string | Array<TextContent | ImageContent>;

export interface Message {
  role: MessageRole;
  content: MessageContent;
}

export interface LLMParams {
  messages: Message[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  responseFormat?: {
    type: "json_schema";
    json_schema: {
      name: string;
      strict: boolean;
      schema: object;
    };
  };
}

export interface LLMResult {
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * 將 OpenAI 格式的 messages 轉換為 Gemini 格式
 */
function convertToGeminiMessages(messages: Message[]) {
  const systemParts: string[] = [];
  const contents: Array<{ role: string; parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> }> = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      // Gemini 用 systemInstruction 處理 system messages
      const text = typeof msg.content === "string" ? msg.content : msg.content.map(c => c.type === "text" ? c.text : "").join("");
      systemParts.push(text);
      continue;
    }

    const role = msg.role === "assistant" ? "model" : "user";
    const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [];

    if (typeof msg.content === "string") {
      parts.push({ text: msg.content });
    } else {
      for (const content of msg.content) {
        if (content.type === "text") {
          parts.push({ text: content.text });
        } else if (content.type === "image_url") {
          const url = content.image_url.url;
          if (url.startsWith("data:")) {
            // base64 data URL
            const [header, data] = url.split(",");
            const mimeType = header.split(":")[1].split(";")[0];
            parts.push({ inline_data: { mime_type: mimeType, data } });
          } else {
            // 外部 URL — Gemini 支援直接傳入 URL
            parts.push({ text: `[Image: ${url}]` }); // fallback
          }
        }
      }
    }

    contents.push({ role, parts });
  }

  return { systemParts, contents };
}

/**
 * 呼叫 Gemini API（相容 OpenAI 格式輸入輸出）
 */
export async function invokeLLM(params: LLMParams): Promise<LLMResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set. Get your key at https://aistudio.google.com");
  }

  const model = params.model ?? DEFAULT_MODEL;
  const { systemParts, contents } = convertToGeminiMessages(params.messages);

  const payload: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: params.maxTokens ?? 8192,
      temperature: params.temperature ?? 0.7,
    },
  };

  // System instruction
  if (systemParts.length > 0) {
    payload.systemInstruction = {
      parts: [{ text: systemParts.join("\n\n") }],
    };
  }

  // JSON schema response format
  if (params.responseFormat?.type === "json_schema") {
    (payload.generationConfig as Record<string, unknown>).responseMimeType = "application/json";
    (payload.generationConfig as Record<string, unknown>).responseSchema = params.responseFormat.json_schema.schema;
  }

  const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API failed: ${response.status} ${response.statusText} – ${errorText}`);
  }

  const result = await response.json() as {
    candidates: Array<{
      content: { parts: Array<{ text: string }>; role: string };
      finishReason: string;
    }>;
    usageMetadata?: {
      promptTokenCount: number;
      candidatesTokenCount: number;
      totalTokenCount: number;
    };
  };

  // 轉換回 OpenAI 格式
  return {
    choices: result.candidates.map(c => ({
      message: {
        role: "assistant",
        content: c.content.parts.map(p => p.text).join(""),
      },
      finish_reason: c.finishReason?.toLowerCase() ?? "stop",
    })),
    usage: result.usageMetadata
      ? {
          prompt_tokens: result.usageMetadata.promptTokenCount,
          completion_tokens: result.usageMetadata.candidatesTokenCount,
          total_tokens: result.usageMetadata.totalTokenCount,
        }
      : undefined,
  };
}

/**
 * 便捷函數：解析圖片中的食譜（用於 Instagram 截圖匯入）
 */
export async function parseRecipeFromImage(imageBase64: string, mimeType = "image/jpeg"): Promise<string> {
  const result = await invokeLLM({
    messages: [
      {
        role: "system",
        content: "你是一個專業的食譜解析助手，專門從圖片中提取食譜資訊。請用繁體中文回答，並以 JSON 格式輸出。",
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
