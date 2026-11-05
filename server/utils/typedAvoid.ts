/**
 * 用戶打落 chat 嘅忌口／過敏原。
 *
 * 點解要：`avoidIngredients` 只覆蓋 app 嘅問卷格式（structured prefs）。用戶自己打
 * 「避免：花生」「我對蝦敏感」時，之前完全冇過濾，結果出咗含花生嘅湯（實測 #13）。
 * 安全相關嘅過濾寧願保守：抽到嘅字眼一律當忌口，最多剔多幾張卡，唔可以漏。
 */

const SPLIT_RE = /[、,，/｜|]/;

const ALLERGEN_HINTS = [
  "花生", "花生醬", "腰果", "杏仁", "核桃", "合桃", "芝麻", "大豆", "黃豆",
  "蝦", "蟹", "龍蝦", "貝", "蜆", "蠔", "青口", "帶子", "魷魚", "八爪魚",
  "魚", "奶", "牛奶", "芝士", "牛油", "忌廉", "蛋", "雞蛋", "麵筋", "麩質",
  "小麥", "蕎麥", "芒果", "榴槤", "奇異果", "芹菜", "芥末", "亞硫酸", "味精",
];

const NEGATION_RE = /(?:唔係|不是|唔會|冇|沒有|not|isn't|is not)\s*$/u;
const FLAVOUR_ONLY = new Set(["太辣", "油", "太油", "咸", "太咸", "甜", "太甜", "酸", "苦"]);
const CATEGORY_WORDS = new Set(["海鮮", "肉", "辣"]);

function looksLikeIngredient(token: string): boolean {
  if (FLAVOUR_ONLY.has(token)) return false;
  if (CATEGORY_WORDS.has(token)) return true;
  if (ALLERGEN_HINTS.includes(token)) return true;
  return /[肉魚蝦蟹菜瓜豆蛋奶蔥蒜薑椒菇米麵雞豬牛鴨羊鵝蠔蜆貝]/.test(token);
}

function cleanToken(raw: string): string | null {
  const token = raw
    .replace(/^(?:我|我們|我哋|唔該|請|all)\s*/u, "")
    .replace(/(?:敏感|過敏|都唔得|都唔食|唔食得)$/u, "")
    .replace(/[。！!？?；;：:）)」』"']+$/u, "")
    .trim();
  const limit = /^[a-z\s-]+$/iu.test(token) ? 24 : 8;
  if (token.length < 1 || token.length > limit) return null;
  // 抽象詞唔可以當食材（「菜／食物／湯」太闊，留俾 LLM；「海鮮／肉／辣」係品類詞，要保留）
  if (/^(?:菜|嘢|食物|湯|飯|麵|甜|酸|苦)$/u.test(token)) return null;
  return token;
}

/**
 * 抽取明確標記嘅忌口：
 * - 「避免：花生」「過敏：蝦、蟹」
 * - 「我對花生敏感」「對蝦過敏」
 * - 「唔食牛肉」「唔要蔥」
 * - 英文 "no peanuts" / "avoid peanuts"
 */
export function extractTypedAvoid(text: string): string[] {
  const source = String(text ?? "");
  if (!source.trim()) return [];
  const found = new Set<string>();

  const pushList = (blob: string | undefined) => {
    if (!blob) return;
    for (const part of blob.split(SPLIT_RE)) {
      const token = cleanToken(part);
      if (token && looksLikeIngredient(token)) found.add(token);
    }
  };

  // 避免／忌口／過敏／敏感 後面跟清單
  for (const match of source.matchAll(/(?:避免|忌口|戒口|唔食得|食唔得|過敏|敏感)[：:\s]*([^；;。！!\n]{1,40})/gu)) {
    pushList(match[1]);
  }
  // 對 X 敏感／過敏
  for (const match of source.matchAll(/對([^，,。；;\s]{1,12}?)(?:敏感|過敏)/gu)) {
    const before = source.slice(0, match.index ?? 0);
    if (NEGATION_RE.test(before)) continue; // 「唔係對花生過敏」唔算
    const token = cleanToken(match[1]);
    if (token && looksLikeIngredient(token)) found.add(token);
  }
  // 唔要 X / 唔食 X / 不要 X / 走 X（只取單一詞，避免食咗整句）
  for (const match of source.matchAll(/(?:唔要|唔食|不要|不吃|走)\s*([^\s，,。；;、！!？?]{1,6})/gu)) {
    const before = source.slice(0, match.index ?? 0);
    if (NEGATION_RE.test(before)) continue;
    const token = cleanToken(match[1]);
    // 只接納已知致敏原或明顯食材名，否則「唔要太油」會被當食材
    if (token && (ALLERGEN_HINTS.includes(token) || /[肉魚蝦蟹菜瓜豆蛋奶蔥蒜薑椒菇]/.test(token))) {
      found.add(token);
    }
  }
  // 英文 no / avoid / allergic to
  const EN_ALLERGENS = ["peanut", "peanuts", "nut", "nuts", "dairy", "milk", "gluten", "wheat",
    "shellfish", "shrimp", "prawn", "crab", "egg", "eggs", "soy", "sesame", "fish"];
  for (const match of source.matchAll(/(?:^|[.,;!?]\s*)(?:no|avoid|without|allergic to)\s+([a-z][a-z\s-]{2,30})/giu)) {
    const first = match[1].trim().split(/\s+/)[0].toLowerCase();
    if (EN_ALLERGENS.includes(first)) found.add(first);
  }

  return [...found];
}
