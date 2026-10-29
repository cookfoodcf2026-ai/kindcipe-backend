import { invokeLLM, extractJSON, type Message } from "../_core/llm";

export type DispatcherItemKind = "dish" | "category" | "ingredient";
export type DispatcherIntent = "cards" | "technique" | "chat" | "action" | "non_food";

export type DispatcherItem = {
  label: string;
  kind: DispatcherItemKind;
  qty: number;
};

export type ChefDispatch = {
  intent: DispatcherIntent;
  items: DispatcherItem[];
  confidence: number;
  ask: { needed: boolean; question: string };
  replyText: string;
};

export const DISPATCHER_PROMPT = `你係 Kindcipe 香港家庭煮食助手。你只做「理解同判斷」，唔准作食譜、唔准作價錢、唔准講營養數字。

只可以輸出一個 JSON object，schema：
{
  "intent": "cards" | "technique" | "chat" | "action" | "non_food",
  "items": [{"label": string, "kind": "dish"|"category"|"ingredient", "qty": number}],
  "confidence": number,
  "ask": {"needed": boolean, "question": string},
  "replyText": string
}

規則：
1. 明白粵語口語、錯字、中英夾雜、省略；例如「三送一湯」= 三餸一湯，「魚面」= 魚麵。
2. 食物拆成 items：
   - dish：具體菜名（蝦子麵、紅燒牛肉麵、魚湯麵）
   - category：類別（湯麵、粉麵、炒飯、湯、小食）
   - ingredient：食材（和牛、雞髀、菜心、剩兩隻蛋）
3. 數量由句子推：「三餸一湯」= 4；「2樣餸」= 2；冇講數量 = 每個 item 1。
4. 投訴 + 新要求（例如「你出雞？我要牛扒」）只取新要求。
5. confidence < 0.7 → ask.needed = true，問一條具體問題（口味／數量／邊一款）。
6. 技術問題（幾耐／點樣／溫度）→ intent=technique，唔准出卡。
7. 非食物／醫療／營養 → intent=non_food 或 chat，唔准亂答。
8. replyText 要自然、簡短（最多 3 句），跟用戶語言。
9. 冇卡時唔准講「已準備／已提供／撳上面卡片」。
10. 唔准發明菜名、價錢、營養數字或庫存。`;

function clampConfidence(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return n;
}

export function validateChefDispatch(value: unknown): ChefDispatch | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const intents: DispatcherIntent[] = ["cards", "technique", "chat", "action", "non_food"];
  if (!intents.includes(v.intent as DispatcherIntent)) return null;
  if (!Array.isArray(v.items)) return null;
  const items: DispatcherItem[] = [];
  for (const raw of v.items.slice(0, 8)) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    const label = String(item.label ?? "").trim();
    const kind = String(item.kind ?? "");
    const qty = Number(item.qty ?? 1);
    if (!label || label.length > 80) return null;
    if (!["dish", "category", "ingredient"].includes(kind)) return null;
    if (!Number.isFinite(qty) || qty < 1 || qty > 10) return null;
    items.push({ label, kind: kind as DispatcherItemKind, qty: Math.round(qty) });
  }
  const confidence = clampConfidence(v.confidence);
  if (confidence === null) return null;
  const askRaw = (v.ask ?? {}) as Record<string, unknown>;
  const replyText = String(v.replyText ?? "").trim();
  if (replyText.length > 500) return null;
  return {
    intent: v.intent as DispatcherIntent,
    items,
    confidence,
    ask: {
      needed: askRaw.needed === true,
      question: String(askRaw.question ?? "").trim().slice(0, 240),
    },
    replyText,
  };
}

export async function dispatchChefTurn(
  messages: Array<{ role: string; content: string }>,
  timeoutMs = 9000,
): Promise<ChefDispatch | null> {
  const context = messages.slice(-6).map((m) => `${m.role}: ${m.content}`).join("\n");
  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: DISPATCHER_PROMPT },
        { role: "user", content: `最近對話：\n${context}\n\n請判斷最新一句。` },
      ],
      maxTokens: 450,
      temperature: 0.2,
      timeoutMs,
      maxRetries: 0,
      responseFormat: { type: "json_object" },
    });
    const raw = response.choices?.[0]?.message?.content ?? "";
    const parsed = extractJSON<Record<string, unknown>>(raw);
    return validateChefDispatch(parsed);
  } catch (error) {
    console.warn("[AI Chef] dispatcher failed:", (error as Error)?.message || error);
    return null;
  }
}
