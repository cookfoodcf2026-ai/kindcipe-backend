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
const NAME_CARB_RE = /(?:麵|面|飯|饭|河粉|湯河|汤河|米線|米线|烏冬|乌冬|餃|饺|粥|米粉|意粉|意面|拉麵|拉面|通粉|丼|饅頭|馒头|冬粉|粉絲|粉丝|叻沙|喇沙|年糕|粄條|粄条|米苔目|泡饃|泡馍|泡飯|泡饭|粿條|粿条|油麵|油面|麵線|面线|公仔麵|公仔面|noodle|ramen|pasta|vermicelli|rice noodle|glass noodle|soba|udon|pho|laksa|congee|risotto|gnocchi|naan|biryani|bibimbap|donburi|ラーメン|うどん|そば|라면|국수|냉면|김밥|덮밥)/i;
const NAME_DESSERT_RE = /(?:湯圓|汤圆|湯丸|汤丸|糖水|糊$|豆沙|豆花|豆腐花|布甸|布丁|燉奶|炖奶|燉蛋|炖蛋|西米露|楊枝甘露|杨枝甘露|芋圓|芋圆|dessert|pudding|tangyuan|sweet soup|glutinous rice ball|mochi|sago|red bean soup)/i;
const NAME_DRINK_RE = /(?:水$|茶飲|茶饮|涼茶|凉茶|奶茶|豆漿|豆浆|果汁|咖啡|汽水|冬瓜茶|菊花茶|洛神花茶|檸檬茶|柠檬茶|杏仁茶|smoothie|juice|coffee|soda|milk tea)/i;
const NAME_VEG_RE = /(?:菜心|芥蘭|芥兰|時蔬|时蔬|青菜|蔬菜|豆苗|菠菜|生菜|通菜|白菜|椰菜|西蘭花|西兰花|浸菜|炒菜|瓜|菇|木耳|雲耳|云耳)/i;
const NAME_PROTEIN_RE = /(?:魚|鱼|蝦|虾|蟹|雞|鸡|牛|豬|猪|肉|羊|鴨|鸭|蛋|豆腐|海鮮|海鲜|羊肉|牛腩)/i;

export function guardDishTypeByName(name: string, current: DishKind): DishKind {
  if (current !== "soup") return current; // 只處理「被誤判成湯」嘅個案
  const n = String(name || "").replace(/電飯煲|电饭煲|電子鍋|电子锅|飯煲|饭煲/g, "");
  // 甜品字（如 red bean soup / 湯圓）先判，避免被「以 soup/湯 結尾」誤留做湯
  if (NAME_DESSERT_RE.test(n)) return "dessert";
  // 名字以「湯/羹」結尾 = 真湯，一律保留
  if (/(?:湯|汤|soup)\s*$/.test(n) || /羹/.test(n)) return current;
  if (NAME_CARB_RE.test(n)) return "carb";
  if (NAME_DRINK_RE.test(n)) return "drink";
  // 蔬菜救援：含蔬菜字但唔含蛋白字（避免「魚湯浸瓜」變蔬菜）
  if (NAME_VEG_RE.test(n) && !NAME_PROTEIN_RE.test(n)) return "vegetable";
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
