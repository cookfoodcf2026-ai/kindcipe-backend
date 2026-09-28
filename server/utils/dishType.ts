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
 * 由菜名做「確定性護欄」，修正 LLM 常見誤判（尤其「名稱有湯字但唔係湯」）。
 * 順序：carb → dessert → drink → soup（先匹配先贏）。
 */
const NAME_CARB_RE = /(?:麵|面|飯|饭|河粉|湯河|汤河|米線|米线|烏冬|乌冬|餃|饺|粥|米粉|意粉|意面|拉麵|拉面|通粉|丼|饅頭|馒头|麵包|面包|三文治|漢堡|汉堡|薄餅|薄饼|披薩|披萨|pizza|noodle|ramen|rice|pasta|bread)/i;
const NAME_DESSERT_RE = /(?:湯圓|汤圆|糖水|糊$|豆沙|豆花|豆腐花|布甸|布丁|燉奶|炖奶|雪糕|蛋糕|蛋撻|蛋挞|奶凍|奶冻|慕斯|西米露|楊枝甘露|杨枝甘露|芋圓|芋圆|dessert|cake|pudding|sorbet|ice cream)/i;
const NAME_DRINK_RE = /(?:茶$|茶飲|茶饮|涼茶|凉茶|水$|果汁|咖啡|奶茶|豆漿|豆浆|汽水|沙冰|smoothie|juice|coffee|latte|tea)/i;
const NAME_SOUP_RE = /(?:羹|煲湯|煲汤|燉湯|炖汤|老火湯|老火汤|滾湯|滚汤|清湯|清汤|濃湯|浓汤|羅宋湯|罗宋汤|粟米湯|番茄湯|湯$|汤$|soup)/i;

export function guardDishTypeByName(name: string, current: DishKind): DishKind {
  const n = String(name || "");
  if (NAME_CARB_RE.test(n)) return "carb";
  if (NAME_DESSERT_RE.test(n)) return "dessert";
  if (NAME_DRINK_RE.test(n)) return "drink";
  if (NAME_SOUP_RE.test(n)) return "soup";
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
