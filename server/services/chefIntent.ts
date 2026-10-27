export type RequestedRole =
  | "meat"
  | "seafood"
  | "vegetable"
  | "soup"
  | "noodle"
  | "dessert"
  | "any";

export type ChefIntentKind =
  | "chat"
  | "clarify"
  | "recipe"
  | "meal"
  | "technique";

export type ChefRequested = {
  total: number;
  roles: RequestedRole[];
};

export type ChefIntent = {
  kind: ChefIntentKind;
  wantsCards: boolean;
  requested: ChefRequested;
  confidence: number;
  reason: string;
};

export type ResolveChefIntentOptions = {
  hasImage?: boolean;
  mode?: "chat" | "ai" | "library";
  forceText?: boolean;
  /** Feature flag: classify 湯麵/拉麵/烏冬 as noodle instead of soup. */
  noodleRole?: boolean;
};

const CN_NUM: Record<string, number> = {
  零: 0, 一: 1, 兩: 2, 二: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

const SMALL_TALK_RE = /^(hi|hello|hey|how are (you|u)|how r u|i am (so )?sad|i'?m (so )?sad|feeling sad|thanks|thank you|thx|ok|okay|多謝|謝謝|唔該|你好|您好|早晨|晚安|好|好的|得|收到)[.!?。！？\s]*$/i;
const AMBIGUOUS_FOOD_RE = /(我唔知|唔知|隨便|求其|你話事|食咩好|煮咩好|有咩好|i don'?t know|not sure|surprise me|help me decide)/i;
const TECHNIQUE_RE = /(幾耐|點樣|如何|怎樣|秘訣|技巧|點解|溫度|幾多度|要幾耐|幾多分鐘|點先|點至|how\s*(long|to|many)|temperature|煮幾耐|蒸幾耐|焗幾耐|煎幾耐|煲幾耐)/i;
const NOODLE_RE = /(?:湯[麵面]|拉麵|拉面|烏冬|乌冬|米線|米线|意粉|河粉|米粉|noodle|ramen|udon|soba|pasta|laksa|pho)/i;

function toNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const token = raw.trim();
  if (/^\d+$/.test(token)) return Number(token);
  return CN_NUM[token] ?? null;
}

function clampCount(n: number | null, min = 1, max = 10): number | null {
  if (n === null || !Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

function roleList(total: number, role: RequestedRole): RequestedRole[] {
  return Array.from({ length: Math.max(0, total) }, () => role);
}

function dishRoles(total: number): RequestedRole[] {
  if (total <= 0) return [];
  if (total === 1) return ["any"];
  if (total === 2) return ["meat", "any"];
  const roles: RequestedRole[] = ["meat", "seafood", "vegetable"];
  while (roles.length < total) roles.push("any");
  return roles.slice(0, total);
}

function explicitDessertMeat(text: string): ChefRequested | null {
  const zhMeatFirst = /(?:一|1|兩|2|两)\s*(?:個|个|道|款|份)?\s*(?:肉|肉類|肉类|肉食|主菜)[^。！？!?\n]{0,16}(?:同|和|加|＆|&|,|，)[^。！？!?\n]{0,16}(?:甜品|甜點|甜点|dessert)/i;
  const zhDessertFirst = /(?:一|1|兩|2|两)\s*(?:個|个|道|款|份)?\s*(?:甜品|甜點|甜点|dessert)[^。！？!?\n]{0,16}(?:同|和|加|＆|&|,|，)[^。！？!?\n]{0,16}(?:肉|肉類|肉类|肉食|主菜)/i;
  const enMeatFirst = /\b(one|two|1|2)\b[^.\n]{0,24}\b(meat|protein|main)\b[^.\n]{0,24}\b(one|two|1|2)\b[^.\n]{0,24}\b(dessert|sweet)\b/i;
  const enDessertFirst = /\b(one|two|1|2)\b[^.\n]{0,24}\b(dessert|sweet)\b[^.\n]{0,24}\b(one|two|1|2)\b[^.\n]{0,24}\b(meat|protein|main)\b/i;
  if (zhMeatFirst.test(text) || enMeatFirst.test(text)) {
    return { total: 2, roles: ["meat", "dessert"] };
  }
  if (zhDessertFirst.test(text) || enDessertFirst.test(text)) {
    return { total: 2, roles: ["dessert", "meat"] };
  }
  return null;
}

function explicitMixedRoles(text: string, noodleRole = true): RequestedRole[] | null {
  const hasMeat = /(肉|肉類|肉类|主菜|\bmeat\b|\bprotein\b)/i.test(text);
  const hasSeafood = /(海鮮|海鲜|魚|鱼|蝦|虾|蟹|豆腐|\bseafood\b|\bfish\b|\bshrimp\b|\btofu\b)/i.test(text);
  const hasVeg = /(菜|蔬菜|青菜|時蔬|时蔬|\bveg(e|gie|etable)?\b)/i.test(text);
  const hasNoodle = noodleRole && NOODLE_RE.test(text);
  // "湯麵" is one noodle dish, not a soup + a noodle. Remove the noodle phrase
  // before testing for a standalone soup.
  const soupText = noodleRole ? text.replace(new RegExp(NOODLE_RE.source, "gi"), " ") : text;
  const hasSoup = /(湯|汤|soup|sopas|sup)/i.test(soupText);
  const hasDessert = /(甜品|甜點|甜点|dessert|panghimagas|pencuci mulut)/i.test(text);
  const roles: RequestedRole[] = [];
  if (hasMeat) roles.push("meat");
  if (hasSeafood) roles.push("seafood");
  if (hasVeg) roles.push("vegetable");
  if (hasSoup) roles.push("soup");
  if (hasNoodle) roles.push("noodle");
  if (hasDessert) roles.push("dessert");
  return roles.length > 0 ? roles : null;
}

function explicitDishSoup(text: string): ChefRequested | null {
  const m = text.match(/(\d+|[零一二兩两三四五六七八九十])\s*[餸菜送]\s*(?:(\d+|[零一二兩两三四五六七八九十])\s*[湯汤]|[湯汤])/);
  if (m) {
    const dishes = clampCount(toNumber(m[1]), 0, 10);
    if (dishes === null) return null;
    const soups = m[2] ? clampCount(toNumber(m[2]), 1, 5) : 1;
    if (soups === null) return null;
    return { total: dishes + soups, roles: [...dishRoles(dishes), ...roleList(soups, "soup")] };
  }
  const en = text.match(/(\d+|one|two|three|four|five)\s*(?:dishes?|recipes?)\s*(?:and|\+|,)?\s*(\d+|one|two|three|four|five)\s*(?:soups?|soup)/i);
  if (en) {
    const word: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
    const dishes = clampCount(/^\d+$/.test(en[1]) ? Number(en[1]) : word[en[1].toLowerCase()], 0, 10);
    const soups = clampCount(/^\d+$/.test(en[2]) ? Number(en[2]) : word[en[2].toLowerCase()], 1, 5);
    if (dishes !== null && soups !== null) {
      return { total: dishes + soups, roles: [...dishRoles(dishes), ...roleList(soups, "soup")] };
    }
  }
  return null;
}

function explicitRoleCount(text: string, noodleRole = true): ChefRequested | null {
  const mixed = explicitMixedRoles(text, noodleRole);
  const rolePatterns: Array<{ role: RequestedRole; re: RegExp }> = [
    { role: "meat", re: /(\d+|[一二兩两三四五六七八九十])\s*(?:個|个|道|款|份)?\s*(?:肉|肉類|肉类|主菜)/ },
    { role: "seafood", re: /(\d+|[一二兩两三四五六七八九十])\s*(?:個|个|道|款|份)?\s*(?:海鮮|海鲜|魚|鱼|蝦|虾|蟹)/ },
    { role: "vegetable", re: /(\d+|[一二兩两三四五六七八九十])\s*(?:個|个|道|款|份)?\s*(?:菜|蔬菜|青菜|時蔬|时蔬)/ },
    { role: "soup", re: /(\d+|[一二兩两三四五六七八九十])\s*(?:個|个|道|款|份)?\s*(?:湯|汤|soup)/i },
    ...(noodleRole ? [{ role: "noodle" as const, re: /(\d+|[一二兩两三四五六七八九十])\s*(?:個|个|道|款|份)?\s*(?:湯?[麵面]|拉麵|拉面|烏冬|乌冬|米線|米线|意粉|河粉|米粉)/ }] : []),
    { role: "dessert", re: /(\d+|[一二兩两三四五六七八九十])\s*(?:個|个|道|款|份)?\s*(?:甜品|甜點|甜点|dessert)/i },
  ];
  const out: RequestedRole[] = [];
  for (const { role, re } of rolePatterns) {
    const m = text.match(re);
    if (!m) continue;
    const n = clampCount(toNumber(m[1]), 1, 10);
    if (n === null) continue;
    out.push(...roleList(n, role));
  }
  if (out.length > 0) return { total: out.length, roles: out };

  if (mixed && mixed.length > 1) return { total: mixed.length, roles: mixed };

  const single = text.match(/(?:\b(one|1|a|an)\b|一(?:個|个|道|款)?)\s*(meat|protein|dessert|sweet|soup|vegetable|veg|seafood|fish|noodle|ramen|udon)/i);
  if (single) {
    const raw = single[2].toLowerCase();
    const role: RequestedRole = raw === "meat" || raw === "protein" ? "meat"
      : raw === "dessert" || raw === "sweet" ? "dessert"
        : raw === "soup" ? "soup"
          : raw === "seafood" || raw === "fish" ? "seafood"
            : raw === "noodle" || raw === "ramen" || raw === "udon" ? "noodle"
            : "vegetable";
    return { total: 1, roles: [role] };
  }
  return null;
}

function explicitSimpleCount(text: string): ChefRequested | null {
  const m = text.match(/(\d+|[一二兩两三四五六七八九十])\s*(?:個|个|道|款|碟)?\s*(?:餸|菜|送|recipes?|cards?|dishes?)/i);
  if (!m) return null;
  const n = clampCount(toNumber(m[1]), 1, 10);
  if (n === null) return null;
  return { total: n, roles: dishRoles(n) };
}

export function resolveChefIntent(
  rawText: string,
  opts: ResolveChefIntentOptions = {},
): ChefIntent {
  const text = String(rawText ?? "").trim();
  const mode = opts.mode ?? "chat";
  const noodleRole = opts.noodleRole !== false;
  const hasImage = opts.hasImage === true;
  const empty: ChefRequested = { total: 0, roles: [] };

  if (hasImage) {
    return { kind: "chat", wantsCards: false, requested: empty, confidence: 0.95, reason: "image" };
  }
  if (!text) {
    return { kind: "chat", wantsCards: false, requested: empty, confidence: 0.99, reason: "empty" };
  }
  if (SMALL_TALK_RE.test(text)) {
    return { kind: "chat", wantsCards: false, requested: empty, confidence: 0.99, reason: "small_talk" };
  }
  if (AMBIGUOUS_FOOD_RE.test(text)) {
    return { kind: "clarify", wantsCards: false, requested: empty, confidence: 0.9, reason: "ambiguous_food" };
  }
  if (text.length < 80 && TECHNIQUE_RE.test(text) && !/[?？]?\s*(?:食譜|recipe|一肉|3餸|三餸|甜品)/i.test(text)) {
    return { kind: "technique", wantsCards: false, requested: empty, confidence: 0.9, reason: "technique" };
  }

  const explicit = explicitDessertMeat(text) ?? explicitDishSoup(text) ?? explicitRoleCount(text, noodleRole);
  if (explicit && explicit.total > 0) {
    return {
      kind: explicit.total > 1 ? "meal" : "recipe",
      wantsCards: true,
      requested: explicit,
      confidence: 0.95,
      reason: "explicit_roles",
    };
  }

  const simple = explicitSimpleCount(text);
  if (simple) {
    return {
      kind: simple.total > 1 ? "meal" : "recipe",
      wantsCards: true,
      requested: simple,
      confidence: 0.85,
      reason: "explicit_count",
    };
  }

  const hasSoup = /(湯水|老火湯|滾湯|燉湯|煲湯|湯品|soup|tonic|今晚食咩|晚餐推薦|設計晚餐)/i.test(text);
  if (hasSoup) {
    return {
      kind: "meal",
      wantsCards: true,
      requested: { total: 4, roles: ["meat", "seafood", "vegetable", "soup"] },
      confidence: 0.75,
      reason: "soup_meal",
    };
  }

  const foodRequest = /(食譜|recipe|想食|想吃|煮|炒|蒸|焗|煎|湯|chicken|beef|pork|fish|shrimp|soup|noodle|pasta|curry|meat|dessert|肉|菜|魚|鱼|蝦|虾|蛋|豆腐|飯|饭|麵|面)/i.test(text);
  const hasDessert = /(甜品|甜點|甜点|dessert|sweet)/i.test(text);
  if (foodRequest || mode === "ai" || mode === "library") {
    return {
      kind: "recipe",
      wantsCards: true,
      requested: { total: 1, roles: [hasDessert ? "dessert" : "any"] },
      confidence: 0.7,
      reason: mode === "ai" || mode === "library" ? "explicit_source" : "food_word",
    };
  }

  return {
    kind: "chat",
    wantsCards: false,
    requested: empty,
    confidence: 0.8,
    reason: opts.forceText ? "legacy_force_text_no_food" : "no_food_intent",
  };
}

export function lastUserText(
  messages: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>,
): string {
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) return "";
  if (typeof last.content === "string") return last.content.trim();
  return last.content.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text!).join(" ").trim();
}
