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

/**
 * 由菜名做「確定性護欄」：**只救援被誤判為 soup** 嘅情況
 * （例如「湯麵/湯飯/湯圓/糖水」被當成湯）。其他分類一律不動，避免誤改。
 * 先移除「電飯煲」等器具字，避免當中嘅「飯」字誤觸。
 */
const NAME_CARB_RE = /(?:麵|面|飯|饭|河粉|湯河|汤河|米線|米线|烏冬|乌冬|餃|饺|粥|米粉|意粉|意面|拉麵|拉面|通粉|丼|饅頭|馒头|noodle|ramen|pasta)/i;
const NAME_DESSERT_RE = /(?:湯圓|汤圆|糖水|糊$|豆沙|豆花|豆腐花|布甸|布丁|燉奶|炖奶|西米露|楊枝甘露|杨枝甘露|芋圓|芋圆|dessert|pudding)/i;
const NAME_DRINK_RE = /(?:水$|茶飲|茶饮|涼茶|凉茶|奶茶|豆漿|豆浆|果汁|咖啡|汽水|smoothie|juice|coffee)/i;

export function guardDishTypeByName(name: string, current: DishKind): DishKind {
  if (current !== "soup") return current; // 只處理「被誤判成湯」嘅個案
  const n = String(name || "").replace(/電飯煲|电饭煲|電子鍋|电子锅|飯煲|饭煲/g, "");
  // 名字以「湯/羹」結尾 = 真湯，一律保留
  if (/(?:湯|汤|soup)\s*$/.test(n) || /羹/.test(n)) return current;
  if (NAME_CARB_RE.test(n)) return "carb";
  if (NAME_DESSERT_RE.test(n)) return "dessert";
  if (NAME_DRINK_RE.test(n)) return "drink";
  return current;
}

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
    if (VALID.includes(t)) return guardDishTypeByName(input.name, t);
    return undefined;
  } catch (e) {
    console.warn("[dishType] LLM classify failed:", (e as Error)?.message);
    return undefined;
  }
}
