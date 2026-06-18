/**
 * Vertex AI Gemini API Helper
 * 使用 Google Vertex AI（而非 Google AI Studio），解決香港地區被阻擋的問題
 *
 * 需要的環境變數：
 *   GCP_PROJECT_ID           - GCP 專案 ID
 *   GCP_LOCATION             - Vertex AI 區域（預設 asia-east2）
 *   GCP_SERVICE_ACCOUNT_JSON - Service Account 金鑰 JSON 內容
 *
 * 設定方式：https://console.cloud.google.com → IAM → Service Accounts
 * 角色：Vertex AI User
 *
 * 定價：https://cloud.google.com/vertex-ai/generative-ai/pricing
 */

import { GoogleAuth } from "google-auth-library";

const DEFAULT_MODEL = "gemini-2.5-flash";

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getVertexToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }
  const creds = process.env.GCP_SERVICE_ACCOUNT_JSON;
  const auth = new GoogleAuth({
    credentials: creds ? JSON.parse(creds) : undefined,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  cachedToken = { token: token.token!, expiresAt: Date.now() + 1800000 };
  return token.token!;
}

export type MessageRole = "user" | "assistant" | "system";

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

function convertToGeminiMessages(messages: Message[]) {
  const systemParts: string[] = [];
  const contents: Array<{ role: string; parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> }> = [];

  for (const msg of messages) {
    if (msg.role === "system") {
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
            const [header, data] = url.split(",");
            const mimeType = header.split(":")[1].split(";")[0];
            parts.push({ inline_data: { mime_type: mimeType, data } });
          } else {
            parts.push({ text: `[Image: ${url}]` });
          }
        }
      }
    }

    contents.push({ role, parts });
  }

  return { systemParts, contents };
}

export async function invokeLLM(params: LLMParams): Promise<LLMResult> {
  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) {
    throw new Error("GCP_PROJECT_ID is not set. Create a GCP project and enable Vertex AI API.");
  }

  const region = process.env.GCP_LOCATION || "asia-east2";
  const model = params.model ?? DEFAULT_MODEL;

  if (!process.env.GCP_SERVICE_ACCOUNT_JSON) {
    throw new Error("GCP_SERVICE_ACCOUNT_JSON is not set. Create a service account with Vertex AI User role.");
  }

  const { systemParts, contents } = convertToGeminiMessages(params.messages);

  const payload: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: params.maxTokens ?? 8192,
      temperature: params.temperature ?? 0.7,
    },
  };

  if (systemParts.length > 0) {
    payload.systemInstruction = {
      parts: [{ text: systemParts.join("\n\n") }],
    };
  }

  if (params.responseFormat?.type === "json_schema") {
    (payload.generationConfig as Record<string, unknown>).responseMimeType = "application/json";
    (payload.generationConfig as Record<string, unknown>).responseSchema = params.responseFormat.json_schema.schema;
  }

  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${model}:generateContent`;
  const token = await getVertexToken();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
    signal: controller.signal,
  });

  clearTimeout(timeout);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Vertex AI API failed: ${response.status} – ${errorText}`);
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
