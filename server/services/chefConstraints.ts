/**
 * Step 1 (v2) of the AI Chef refactor, agreed with OpenCode:
 * ONE place that turns a user sentence into a Constraint object.
 *
 * Not wired into the pipeline yet — Step 1 only freezes the contract so every
 * later change is testable. Step 2 feeds this object to (a) library retrieval,
 * (b) the LLM prompt and (c) the single validator.
 *
 * v2 after OpenCode review:
 *  - diet distinguishes vegan from vegetarian
 *  - servings captured (the LLM prompt needs it)
 *  - pantryMode distinguishes "only these" from "prefer these"
 *  - negatives are an enum, not free text
 *  - 蛋 no longer counts as protein when the sentence says 蛋白/蛋白質
 *  - 「想要八寶素煲」no longer keeps the verb inside namedDish
 *  - 「得」 only starts a pantry list after 雪櫃/冰箱/剩/淨係/只有
 */

export type ChefDiet = "vegan" | "vegetarian";
export type ChefProtein = "pork" | "beef" | "chicken" | "fish" | "seafood" | "egg" | "soy";
export type ChefNegative = "spicy" | "pork" | "beef" | "chicken" | "seafood" | "dairy" | "nuts";
export type ChefScenario =
  | "quick"
  | "healthy"
  | "ricecooker"
  | "kids"
  | "guest"
  | "highProtein"
  | "vegetarian";

export interface ChefConstraints {
  /** 素食／純素：最硬的一條線，任何時候都唔可以出肉 */
  diet: ChefDiet | null;
  /** 用戶講出口嘅蛋白（「想食魚」→ ["fish"]） */
  proteins: ChefProtein[];
  /** true = 一定要有；false = 有就好 */
  proteinHard: boolean;
  pantry: string[];
  /** only = 只用呢啲；prefer = 優先呢啲 */
  pantryMode: "only" | "prefer" | null;
  maxMinutes: number | null;
  negatives: ChefNegative[];
  servings: number | null;
  scenario: ChefScenario | null;
  namedDish: string | null;
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

const SCENARIO_WORDS: Array<[RegExp, ChefScenario]> = [
  [/蛋白|健身|增肌/, "highProtein"],
  [/素食|吃素|食素|vegan|純素|全素/, "vegetarian"],
  [/快手|快啲|快d|趕時間/, "quick"],
  [/清淡|少油|少鹽|輕盈|輕食/, "healthy"],
  [/電飯煲|一鍋|懶人/, "ricecooker"],
  [/小朋友|親子|細路|小孩/, "kids"],
  [/宴客|招呼朋友|請客/, "guest"],
];

const NEGATIVE_TRIGGER = /唔要|不要|走|唔好食|戒|避開|唔食|唔可以|敏感/;
const NEGATIVE_MAP: Array<[RegExp, ChefNegative]> = [
  [/辣/, "spicy"],
  [/豬|排骨/, "pork"],
  [/牛/, "beef"],
  [/雞|鴨|鵝/, "chicken"],
  [/海鮮|魚|蝦|蟹|蜆|蠔/, "seafood"],
  [/奶|芝士|乳酪/, "dairy"],
  [/果仁|花生|腰果|杏仁/, "nuts"],
];

const PANTRY_ONLY_PREFIX = /(?:雪櫃|冰箱|剩|淨係|只有|只係)/;
const DISH_SUFFIX = /(煲|麵|粉|飯|粥|湯|糕|卷|餅|餃|丸|扒|盅|鍋)/;
const CN_DIGITS: Record<string, number> = {
  一: 1, 兩: 2, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

/** 十二 / 二十 / 二十五 → 12 / 20 / 25（只處理到 99，夠用） */
function toChineseNumber(raw: string): number | null {
  const digits = "零一二三四五六七八九";
  if (!raw) return null;
  if (raw === "十") return 10;
  if (raw.length === 1) return digits.indexOf(raw) >= 0 ? digits.indexOf(raw) : null;
  if (raw.startsWith("十")) return 10 + (digits.indexOf(raw[1]) || 0);
  const tens = digits.indexOf(raw[0]);
  if (tens <= 0) return null;
  const ones = raw[2] ? digits.indexOf(raw[2]) : 0;
  return tens * 10 + (ones > 0 ? ones : 0);
}

export function parseChefConstraints(rawText: string): ChefConstraints {
  const text = String(rawText ?? "").trim();

  const diet: ChefDiet | null = /純素|全素|vegan/i.test(text)
    ? "vegan"
    : /素食|吃素|食素|vegetarian/i.test(text)
      ? "vegetarian"
      : null;

  // 「蛋白」「蛋白質」係營養概念，唔係蛋呢種食材
  const nutrientProtein = /蛋白質?/.test(text);
  const proteinText = text.replace(/蛋白質?/g, " ");
  const rawProteins: ChefProtein[] = [];
  for (const [re, key] of PROTEIN_WORDS) {
    if (key === "egg" && nutrientProtein) continue;
    if (re.test(proteinText) && !rawProteins.includes(key)) rawProteins.push(key);
  }
  // 素食 = 唔可以有肉：蛋白願望一律作廢，由紅線管
  const proteins = diet ? [] : rawProteins;

  const minutesMatch = text.match(/(\d{1,3})\s*分鐘/);
  const maxMinutes = minutesMatch ? Number(minutesMatch[1]) : null;

  // 只喺「唔要…」嗰個子句抽否定詞，唔可以食埋後半句「想食雞」
  const negatives: ChefNegative[] = [];
  const clauses = text.split(/[，,；;。但]/);
  for (const clause of clauses) {
    if (!NEGATIVE_TRIGGER.test(clause)) continue;
    for (const [re, key] of NEGATIVE_MAP) {
      if (re.test(clause) && !negatives.includes(key)) negatives.push(key);
    }
  }

  // 否定詞優先：「唔要豬，想食雞」唔可以令 proteins 仍然含 pork
  const proteinAfterNegatives = negatives.length === 0
    ? proteins
    : proteins.filter((protein) => {
        if (protein === "pork") return !negatives.includes("pork");
        if (protein === "beef") return !negatives.includes("beef");
        if (protein === "chicken") return !negatives.includes("chicken");
        if (protein === "fish" || protein === "seafood") return !negatives.includes("seafood");
        return true;
      });

  let scenario: ChefScenario | null = null;
  for (const [re, key] of SCENARIO_WORDS) {
    if (re.test(text)) {
      scenario = key;
      break;
    }
  }

  const pantryMatch =
    text.match(/[：:]\s*([^\n。]+)/)?.[1] ??
    (PANTRY_ONLY_PREFIX.test(text) ? text.match(/得([^\n。]+)/)?.[1] : undefined) ??
    "";
  const pantry = pantryMatch
    .split(/[、，,同＋/+]+/)
    .map((item) => item.replace(/^(有|仲有|同|得|埋)/, "").replace(/(同埋|同)$/, "").trim())
    .filter((item) => item.length >= 1 && item.length <= 8 && !/得閒/.test(item));
  const pantryMode: ChefConstraints["pantryMode"] = pantry.length === 0
    ? null
    : /淨係|只有|只係|雪櫃得|冰箱得|剩得/.test(text)
      ? "only"
      : "prefer";

  const namedDish = (() => {
    const cleaned = text.replace(/[，。！？、,.!?\s]/g, "");
    const candidate = cleaned.replace(/^(我|想|要|請|幫我)+/, "");
    if (candidate.length < 2 || candidate.length > 12) return null;
    if (!DISH_SUFFIX.test(candidate)) return null;
    // 泛願望（想飲湯、三餸一湯）唔係菜名
    if (/餸|飲湯/.test(candidate)) return null;
    if (/[一二兩两三四五六七八九十\d]\s*(?:個|碗)?\s*湯$/.test(candidate)) return null;
    if (/素食|高蛋白|清淡|快手|小朋友|宴客|有咩|推介|建議|得閒/.test(candidate)) return null;
    return candidate;
  })();

  const servingsMatch = text.match(/([0-9]{1,2}|[一二兩两三四五六七八九十]{1,3})\s*(?:個人|人|位)/);
  const servingsRaw = servingsMatch?.[1] ?? "";
  const servings = servingsRaw
    ? (/^[0-9]+$/.test(servingsRaw) ? Number(servingsRaw) : (CN_DIGITS[servingsRaw] ?? toChineseNumber(servingsRaw)))
    : null;

  const dishMatch = text.match(/([0-9一二兩两三四五六七八九十])\s*(?:道|個|款)?\s*(?:餸|菜)/);
  const dishCount = dishMatch ? (Number(dishMatch[1]) || CN_DIGITS[dishMatch[1]] || null) : null;

  return {
    diet,
    proteins: proteinAfterNegatives,
    proteinHard: /想食|要|想煮/.test(text) && proteinAfterNegatives.length > 0,
    pantry,
    pantryMode,
    maxMinutes,
    negatives,
    servings,
    scenario,
    namedDish,
    dishCount,
    // 「想飲湯」「要有湯」都算要湯，唔一定要同時講幾道餸
    wantsSoup: /湯/.test(text) && (Boolean(dishCount) || /飲湯|要有湯|想有湯|一個湯|湯水/.test(text)),
  };
}
