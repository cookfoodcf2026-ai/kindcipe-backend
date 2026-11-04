/**
 * Step 1 of the AI Chef refactor (agreed with OpenCode):
 * ONE place that turns a user sentence into a Constraint object.
 *
 * This file is deliberately NOT wired into the pipeline yet — Step 1 only
 * freezes the contract so every later change can be tested against it.
 * Step 2 will feed this object to (a) library retrieval, (b) the LLM prompt
 * and (c) the single validator, replacing the post-hoc filters we piled up.
 */

export type ChefProtein = "pork" | "beef" | "chicken" | "fish" | "seafood" | "egg" | "soy";

export interface ChefConstraints {
  /** 素食 / 純素：最硬的一條線，任何時候都唔可以出肉 */
  diet: "vegetarian" | null;
  /** 用戶明確想食的蛋白（可多個） */
  proteins: ChefProtein[];
  /** 雪櫃／食材清單（用戶列出嘅樣） */
  pantry: string[];
  /** 時間上限（分鐘） */
  maxMinutes: number | null;
  /** 負面條件：用戶明確唔要嘅（辣、牛、海鮮…） */
  negatives: string[];
  /** 場景 hotkey：quick / healthy / ricecooker / kids / guest / highProtein */
  scenario: string | null;
  /** 具名菜式（「八寶素煲」） */
  namedDish: string | null;
  /** 用戶要幾多道（3 餸 1 湯 → 3 + 1 湯） */
  dishCount: number | null;
  wantsSoup: boolean;
}

const PROTEIN_WORDS: Array<[RegExp, ChefProtein]> = [
  [/豬|排骨|五花|煙肉|火腿|臘腸/, "pork"],
  [/牛|牛腩|牛柳/, "beef"],
  [/雞|鴨|鵝/, "chicken"],
  [/魚|鱈|三文|鯛|斑|魚柳/, "fish"],
  [/蝦|蟹|蜆|蠔|魷|帶子|瑤柱|海鮮/, "seafood"],
  [/蛋|雞蛋/, "egg"],
  [/豆腐|豆乾|腐竹|豆卜|毛豆|枝豆/, "soy"],
];

const SCENARIO_WORDS: Array<[RegExp, string]> = [
  [/蛋白|健身|增肌/, "highProtein"],
  [/素食|吃素|食素|vegan/, "vegetarian"],
  [/快手|快啲|快d|趕時間/, "quick"],
  [/清淡|少油|少鹽|輕盈|輕食/, "healthy"],
  [/電飯煲|一鍋|懶人/, "ricecooker"],
  [/小朋友|親子|細路|小孩/, "kids"],
  [/宴客|招呼朋友|請客/, "guest"],
];

const NEGATIVE_WORDS = /唔要|不要|走|唔好食|戒|避開|唔食/;
const DISH_SUFFIX = /(煲|麵|粉|飯|粥|湯|糕|卷|餅|餃|丸|扒|盅|鍋)/;

/** 由一句話抽出唯一一份 constraint（Step 2 會用佢餵三處）。 */
export function parseChefConstraints(rawText: string): ChefConstraints {
  const text = String(rawText ?? "").trim();
  const diet = /素食|吃素|食素|vegan|vegetarian/i.test(text) ? "vegetarian" : null;

  const proteins: ChefProtein[] = [];
  const wantsProtein = /想食|想煮|要|食|煮|整|有咩|推介|推薦/.test(text);
  if (wantsProtein && !diet) {
    for (const [re, key] of PROTEIN_WORDS) {
      if (re.test(text) && !proteins.includes(key)) proteins.push(key);
    }
  }

  const minutesMatch = text.match(/(\d{1,3})\s*分鐘/);
  const maxMinutes = minutesMatch ? Number(minutesMatch[1]) : null;

  const negatives: string[] = [];
  if (NEGATIVE_WORDS.test(text) && /辣/.test(text)) negatives.push("spicy");
  if (NEGATIVE_WORDS.test(text) && /牛/.test(text)) negatives.push("beef");

  let scenario: string | null = null;
  for (const [re, key] of SCENARIO_WORDS) {
    if (re.test(text)) {
      scenario = key;
      break;
    }
  }

  // 雪櫃食材：兩個入口寫法都認（「用以下食材煮餸：A、B」／「雪櫃得A同B」）
  const pantryRaw = text.match(/[：:]\s*([^\n。]+)/)?.[1] ?? text.match(/得([^\n。]+)/)?.[1] ?? "";
  const pantry = pantryRaw
    .split(/[、，,同＋/+]+/)
    .map((item) => item.replace(/^(有|仲有|同|得)/, "").trim())
    .filter((item) => item.length >= 1 && item.length <= 8);

  const namedDish = (() => {
    const cleaned = text.replace(/[，。！？、,.!?\s]/g, "");
    const candidate = cleaned.replace(/^(我)?(要|想食|想煮|想整|食)?/, "");
    if (candidate.length < 2 || candidate.length > 12) return null;
    if (!DISH_SUFFIX.test(candidate)) return null;
    if (/素食|高蛋白|清淡|快手|小朋友|宴客|有咩|推介|建議/.test(candidate)) return null;
    return candidate;
  })();

  const dishMatch = text.match(/([0-9一二兩两三四五六七八九十])\s*(?:道|個|款)?\s*(?:餸|菜)/);
  const cnDigits: Record<string, number> = { 一: 1, 兩: 2, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const dishCount = dishMatch ? (Number(dishMatch[1]) || cnDigits[dishMatch[1]] || null) : null;

  return {
    diet,
    proteins,
    pantry,
    maxMinutes,
    negatives,
    scenario,
    namedDish,
    dishCount,
    wantsSoup: /湯/.test(text) && Boolean(dishCount),
  };
}
