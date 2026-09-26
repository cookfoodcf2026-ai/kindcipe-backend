/**
 * 菜式分類器（LLM-based）—— 用語意理解判斷菜式屬邊一類，支援多語言。
 * 用嚟喺「入庫」時（匯入 / 自訂 / AI 生成）計算 dishType 並儲存，
 * 令 3餸1湯 / weekly menu 直接讀 DB 嘅 dishType，唔再靠硬編碼 regex。
 *
 * canonical 值同前端 `lib/dishType.ts` 對齊（9 類）。
 */
import { invokeLLM, extractJSON } from "../_core/llm";

export type DishKind =
  | "soup"
  | "meat"
  | "seafood"
  | "vegetable"
  | "carb"
  | "appetizer"
  | "dessert"
  | "drink"
  | "other";

const VALID: DishKind[] = [
  "soup", "meat", "seafood", "vegetable", "carb",
  "appetizer", "dessert", "drink", "other",
];

export async function classifyRecipeDishTypeLLM(input: {
  name: string;
  description?: string;
  ingredients?: unknown[];
  tags?: string[];
  category?: string;
}): Promise<DishKind | undefined> {
  try {
    const ing = (input.ingredients || [])
      .map((i: any) => String(i?.name ?? i ?? "").trim())
      .filter(Boolean)
      .slice(0, 10)
      .join("、");
    const tags = (input.tags || []).map(String).join("、");
    const prompt =
      `你係一個菜式分類器。菜式可以係任何語言（中文、英文、日文、韓文等），請用語意判斷佢屬邊一類。\n` +
      `菜名：${input.name}\n` +
      `描述：${input.description || "（無）"}\n` +
      `食材：${ing || "（無）"}\n` +
      `標籤：${tags || "（無）"}\n` +
      `分類：${input.category || "（無）"}\n\n` +
      `請回傳 JSON：{"type":"soup"|"meat"|"seafood"|"vegetable"|"carb"|"appetizer"|"dessert"|"drink"|"other"}\n` +
      `規則：\n` +
      `- soup：湯水（老火湯、滾湯、燉湯、羹）；湯麵/湯飯唔算湯，算 carb\n` +
      `- meat：肉類主菜（豬/牛/雞/鴨/羊/排骨等）\n` +
      `- seafood：海鮮/其他蛋白（魚/蝦/蟹/蜆/蠔/豆腐/蛋等）\n` +
      `- vegetable：蔬菜/小炒（菜心、芥蘭、瓜、菇、番茄、時蔬等）\n` +
      `- carb：主食（飯/麵/粉/粥/意粉/饅頭/餃子）\n` +
      `- appetizer：前菜/小食/涼拌/沙律/點心\n` +
      `- dessert：甜品/糖水/糕點\n` +
      `- drink：飲品/茶飲/果汁/涼茶\n` +
      `- other：以上皆非\n` +
      `只回傳 JSON，唔好加其他文字。`;

    const resp = await invokeLLM({
      messages: [{ role: "user", content: prompt }],
      maxTokens: 60,
      temperature: 0,
      timeoutMs: 12000,
      enableSearch: false,
      responseFormat: { type: "json_object" },
    });
    const raw = resp.choices?.[0]?.message?.content || "";
    const parsed = extractJSON<{ type?: string }>(raw);
    const t = parsed?.type as DishKind;
    if (VALID.includes(t)) return t;
    return undefined;
  } catch (e) {
    console.warn("[dishType] LLM classify failed:", (e as Error)?.message);
    return undefined;
  }
}
