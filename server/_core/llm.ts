/**
 * DashScope (Qwen) LLM Helper
 * 使用阿里雲 DashScope OpenAI-compatible API，支援文字 + 圖片 Vision
 *
 * 需要的環境變數：
 *   DASHSCOPE_API_KEY  - API Key（必填）
 *   DASHSCOPE_BASE_URL - API endpoint（選填，預設新加坡 region）
 */

import { ENV } from "./env";

const DEFAULT_TEXT_MODEL = "qwen3.5-plus";
const DEFAULT_VISION_MODEL = "qwen3.5-plus";
const DEFAULT_MAX_TOKENS = 8192;

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

function hasImageContent(messages: Message[]): boolean {
  return messages.some((msg) => {
    if (typeof msg.content === "string") return false;
    return msg.content.some((c) => c.type === "image_url");
  });
}

export async function invokeLLM(params: LLMParams): Promise<LLMResult> {
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

  const body: Record<string, unknown> = {
    model,
    messages: params.messages,
    max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: params.temperature ?? 0.7,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
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

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `DashScope API failed: ${response.status} – ${errorText}`
      );
    }

    const result = (await response.json()) as {
      id?: string;
      choices: Array<{
        index: number;
        message: { role: string; content: string };
        finish_reason: string;
      }>;
      usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    };

    return {
      choices: result.choices.map((c) => ({
        message: {
          role: c.message.role ?? "assistant",
          content: c.message.content ?? "",
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
    throw err;
  }
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
