export type GroundingReason =
  | "exact"
  | "substring"
  | "single_char_ctx"
  | "en_token"
  | "synonym"
  | "blacklist"
  | "miss";

export type IngredientLike = {
  name?: unknown;
  nameEn?: unknown;
  nameFil?: unknown;
  nameId?: unknown;
};

export type GroundingResult = {
  grounded: boolean;
  reason: GroundingReason;
};

export type AnalyzeGroundingResult = {
  total: number;
  groundedCount: number;
  inferredIndexes: number[];
  blacklistHits: number;
  stepsInferred?: boolean;
  shouldWarnIngredients: boolean;
};

export const BLACKLIST_PHRASES = [
  "廚房紙巾",
  "紙巾",
  "優惠",
  "抽獎",
  "折扣",
  "贊助",
] as const;

export const SINGLE_CHAR_INGREDIENTS = [
  "鹽",
  "糖",
  "油",
  "蒜",
  "蔥",
  "薑",
  "蛋",
  "水",
  "醋",
  "酒",
  "米",
  "麵",
] as const;

/**
 * Broad ingredient synonym groups for grounding only. The first entry is the
 * canonical key; every member normalises to it via `normalizeForMatch`, so
 * this map does not introduce another normalisation scheme.
 */
export const INGREDIENT_SYNONYM_GROUPS = [
  ["醬油", "生抽", "老抽", "豉油", "しょうゆ", "醤油", "soy sauce", "shoyu"],
  ["糖", "砂糖"],
  ["鹽", "食鹽"],
  ["麻油", "芝麻油"],
  ["醋", "酢"],
  ["味醂", "みりん"],
  ["料理酒", "清酒"],
] as const;

const TRADITIONAL_TO_SIMPLIFIED_PAIRS =
  "鹽盐蔥葱薑姜麵面雞鸡豬猪蝦虾魚鱼醬酱紙纸優优獎奖贊赞維维達达廚厨飯饭" +
  "塊块頭头絲丝蘿萝蔔卜鮮鲜貝贝蠔蚝檸柠" +
  "櫛栉節节糰团捲卷撻挞";

const TRADITIONAL_TO_SIMPLIFIED = new Map<string, string>(
  Array.from({ length: TRADITIONAL_TO_SIMPLIFIED_PAIRS.length / 2 }, (_, i) => [
    TRADITIONAL_TO_SIMPLIFIED_PAIRS[i * 2],
    TRADITIONAL_TO_SIMPLIFIED_PAIRS[i * 2 + 1],
  ]),
);

const SINGLE_CHAR_SET = new Set(
  SINGLE_CHAR_INGREDIENTS.map((value) => foldChars(value.normalize("NFKC").toLowerCase())),
);

const SINGLE_CHAR_DIRECTION: Record<string, { prefix?: boolean; suffix?: boolean }> = {
  油: { suffix: true },
  蛋: { suffix: true },
  蒜: { prefix: true, suffix: true },
  葱: { prefix: true, suffix: true },
  姜: { prefix: true, suffix: true },
};

const SINGLE_CHAR_EXCLUDES: Record<string, string[]> = {
  油: ["油腻", "油炸", "油菜", "用油", "加油", "油温", "油鍋", "油锅", "油烟", "油煙", "油花"],
  蛋: ["蛋糕", "蛋挞", "蛋撻", "蛋卷", "蛋捲"],
  蒜: ["蒜香", "蒜味"],
  葱: ["葱香", "葱味"],
  姜: ["姜香", "姜味"],
};

const CN_QUANTITY_OR_UNIT =
  /^(?:[\d一二两兩三四五六七八九十半]|適量|适量|少許|少许|少量|些許|些许|酌量|隨意|随意|按需|to\s*taste)/;

const CN_PREFIX_DESCRIPTOR = /(?:適量|适量|少許|少许|少量|些許|些许|酌量|隨意|随意)\s*$/;

const TITLE_INGREDIENT_MARKER =
  /材料|食材|ingredients|[:：、/]|\d+\s*(?:g|kg|mg|ml|l|克|公斤|公克|毫克|毫升|茶匙|湯匙|大匙|小匙|杯|碗|個|隻|片|塊|條|根|把|粒|顆|包|罐|oz|lb|tbsp|tsp|cup)/i;

const INGREDIENT_DELIMITER = /[、，,\/;；。:：\s]+/g;

const ENGLISH_TWO_LETTER_WHITELIST = new Set(["ox"]);

function foldChars(value: string): string {
  return Array.from(value)
    .map((char) => TRADITIONAL_TO_SIMPLIFIED.get(char) ?? char)
    .join("");
}

function nfkcLower(value: unknown): string {
  return String(value ?? "").normalize("NFKC").toLowerCase();
}

export function normalizeForMatch(value: unknown): string {
  return foldChars(nfkcLower(value)).replace(/[^\p{L}\p{N}]/gu, "");
}

function normalizeEnglish(value: unknown): string {
  return nfkcLower(value).replace(/[^a-z0-9]+/g, " ").trim();
}

const INGREDIENT_CANONICAL_BY_VARIANT = new Map<string, string>(
  INGREDIENT_SYNONYM_GROUPS.flatMap((group) => {
    const canonical = normalizeForMatch(group[0]);
    return group.map((term) => [normalizeForMatch(term), canonical] as const);
  }),
);

const INGREDIENT_VARIANTS_BY_CANONICAL = new Map<string, string[]>(
  INGREDIENT_SYNONYM_GROUPS.map((group) => {
    const canonical = normalizeForMatch(group[0]);
    return [canonical, group.map((term) => normalizeForMatch(term))] as const;
  }),
);

export function canonicalIngredientKey(value: unknown): string {
  const normalized = normalizeForMatch(value);
  return INGREDIENT_CANONICAL_BY_VARIANT.get(normalized) ?? normalized;
}

function synonymGrounding(name: string, sourceText: string): GroundingReason | null {
  const normalizedName = normalizeForMatch(name);
  if (!normalizedName) return null;

  const canonical = canonicalIngredientKey(normalizedName);
  const variants = INGREDIENT_VARIANTS_BY_CANONICAL.get(canonical);
  if (!variants) return null;

  const normalizedSource = normalizeForMatch(sourceText);
  if (!normalizedSource) return null;

  for (const variant of variants) {
    if (!variant || variant === normalizedName) continue;
    if (normalizedSource.includes(variant)) return "synonym";
  }

  return null;
}

function compact(value: unknown): string {
  return normalizeForMatch(value);
}

function splitIngredientSegments(value: unknown): string[] {
  return foldChars(nfkcLower(value))
    .split(INGREDIENT_DELIMITER)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function containsBlacklist(value: unknown): boolean {
  const normalized = normalizeForMatch(value);
  if (!normalized) return false;
  return BLACKLIST_PHRASES.some((phrase) =>
    normalized.includes(normalizeForMatch(phrase)),
  );
}

function isSingleCharIngredient(normalized: string): boolean {
  return normalized.length === 1 && SINGLE_CHAR_SET.has(normalized);
}

function isExcludedSingleChar(char: string, segment: string): boolean {
  const excludes = SINGLE_CHAR_EXCLUDES[char];
  return Boolean(excludes?.some((word) => segment.includes(word)));
}

function singleCharGrounded(char: string, sourceText: string): boolean {
  const segments = splitIngredientSegments(sourceText);
  const direction = SINGLE_CHAR_DIRECTION[char] ?? {};

  for (const segment of segments) {
    if (segment === char) return true;
    if (isExcludedSingleChar(char, segment)) continue;

    const index = segment.indexOf(char);
    if (index >= 0) {
      const after = segment.slice(index + 1);
      const before = segment.slice(0, index);
      if (CN_QUANTITY_OR_UNIT.test(after)) return true;
      if (CN_PREFIX_DESCRIPTOR.test(before)) return true;
    }

    if (direction.prefix && segment.startsWith(char) && segment.length >= 2) {
      return true;
    }
    if (direction.suffix && segment.endsWith(char) && segment.length >= 2) {
      return true;
    }
  }

  return false;
}

function chineseNameGrounding(name: string, sourceText: string): GroundingReason | null {
  const normalizedName = normalizeForMatch(name);
  if (!normalizedName) return null;

  if (isSingleCharIngredient(normalizedName)) {
    return singleCharGrounded(normalizedName, sourceText) ? "single_char_ctx" : null;
  }

  if (normalizedName.length < 2) return null;

  const normalizedSource = normalizeForMatch(sourceText);
  if (!normalizedSource) return null;

  if (normalizedSource.includes(normalizedName)) return "exact";

  for (let i = 0; i + 2 <= normalizedName.length; i++) {
    if (normalizedSource.includes(normalizedName.slice(i, i + 2))) {
      return "substring";
    }
  }

  return null;
}

function stemEnglishToken(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.length > 3 && token.endsWith("es")) {
    return token.slice(0, -2);
  }
  if (token.length > 2 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

function englishTokens(value: unknown): string[] {
  return normalizeEnglish(value).split(" ").filter(Boolean);
}

function englishTokenAllowed(token: string): boolean {
  return token.length >= 3 || ENGLISH_TWO_LETTER_WHITELIST.has(token);
}

function englishNameGrounding(nameEn: string, sourceText: string): boolean {
  const phrase = normalizeEnglish(nameEn);
  if (!phrase) return false;

  const source = normalizeEnglish(sourceText);
  if (!source) return false;

  if (phrase.includes(" ")) {
    if (source === phrase || source.startsWith(`${phrase} `) || source.endsWith(` ${phrase}`) || source.includes(` ${phrase} `)) {
      return true;
    }
  }

  const sourceTokens = new Set<string>();
  for (const token of englishTokens(source)) {
    sourceTokens.add(token);
    sourceTokens.add(stemEnglishToken(token));
  }

  for (const rawToken of englishTokens(phrase)) {
    if (!englishTokenAllowed(rawToken)) continue;
    if (sourceTokens.has(rawToken) || sourceTokens.has(stemEnglishToken(rawToken))) {
      return true;
    }
  }

  return false;
}

export function groundIngredient(
  ing: IngredientLike,
  sourceText: string,
): GroundingResult {
  const variants = [ing?.name, ing?.nameEn, ing?.nameFil, ing?.nameId];
  if (variants.some((value) => containsBlacklist(value))) {
    return { grounded: false, reason: "blacklist" };
  }

  if (!String(sourceText ?? "").trim()) {
    return { grounded: false, reason: "miss" };
  }

  const name = String(ing?.name ?? "").trim();
  const nameEn = String(ing?.nameEn ?? "").trim();

  const chineseReason = chineseNameGrounding(name, sourceText);
  if (chineseReason) return { grounded: true, reason: chineseReason };

  if (nameEn && englishNameGrounding(nameEn, sourceText)) {
    return { grounded: true, reason: "en_token" };
  }

  const nameEnSynonym = nameEn ? synonymGrounding(nameEn, sourceText) : null;
  if (nameEnSynonym) return { grounded: true, reason: nameEnSynonym };

  const nameSynonym = name ? synonymGrounding(name, sourceText) : null;
  if (nameSynonym) return { grounded: true, reason: nameSynonym };

  if (
    name &&
    /[a-z]/i.test(name) &&
    !/[\u4e00-\u9fff]/.test(name) &&
    englishNameGrounding(name, sourceText)
  ) {
    return { grounded: true, reason: "en_token" };
  }

  return { grounded: false, reason: "miss" };
}

function bigrams(value: string): Set<string> {
  const chars = Array.from(value);
  if (chars.length < 2) return new Set(chars);
  const result = new Set<string>();
  for (let i = 0; i + 1 < chars.length; i++) {
    result.add(`${chars[i]}${chars[i + 1]}`);
  }
  return result;
}

function bigramJaccard(a: string, b: string): number {
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  return intersection / (left.size + right.size - intersection);
}

function hasIngredientMarker(line: string): boolean {
  return TITLE_INGREDIENT_MARKER.test(line);
}

function isTitleCandidate(line: string, name: string): boolean {
  if (Array.from(line.trim()).length > 24) return false;
  if (hasIngredientMarker(line)) return false;
  return bigramJaccard(normalizeForMatch(line), normalizeForMatch(name)) >= 0.6;
}

export function stripTitleLines(sourceText: string, name: string): string {
  const source = String(sourceText ?? "");
  const nameValue = String(name ?? "");
  if (!source.trim() || !nameValue.trim()) return source;

  const lines = source.split(/\r?\n/);
  const firstNonEmptyIndexes: number[] = [];
  for (let i = 0; i < lines.length && firstNonEmptyIndexes.length < 2; i++) {
    if (lines[i].trim()) firstNonEmptyIndexes.push(i);
  }
  if (firstNonEmptyIndexes.length === 0) return source;

  const threshold = Math.max(30, 2 * Array.from(normalizeForMatch(nameValue)).length);
  const removed = new Set<number>();

  for (const index of firstNonEmptyIndexes) {
    if (!isTitleCandidate(lines[index], nameValue)) continue;
    const remaining = lines
      .filter((_, lineIndex) => lineIndex !== index && !removed.has(lineIndex))
      .join("")
      .trim();
    if (Array.from(normalizeForMatch(remaining)).length >= threshold) {
      removed.add(index);
    }
  }

  if (removed.size === 0) return source;
  return lines.filter((_, index) => !removed.has(index)).join("\n");
}

export function analyzeGrounding(
  ingredients: IngredientLike[] | null | undefined,
  sourceText: string,
  name: string,
  stepsInferred?: boolean,
): AnalyzeGroundingResult {
  const list = Array.isArray(ingredients) ? ingredients : [];
  const source = stripTitleLines(String(sourceText ?? ""), String(name ?? ""));

  let total = 0;
  let groundedCount = 0;
  let blacklistHits = 0;
  const inferredIndexes: number[] = [];

  for (let index = 0; index < list.length; index++) {
    const result = groundIngredient(list[index], source);
    if (result.reason === "blacklist") {
      blacklistHits += 1;
      continue;
    }
    total += 1;
    if (result.grounded) groundedCount += 1;
    else inferredIndexes.push(index);
  }

  const inferred = inferredIndexes.length;
  const threshold = Math.max(2, Math.ceil(total * 0.25));
  const shouldWarnIngredients = total === 0 ? list.length > 0 : inferred >= threshold;

  return {
    total,
    groundedCount,
    inferredIndexes,
    blacklistHits,
    ...(typeof stepsInferred === "boolean" ? { stepsInferred } : {}),
    shouldWarnIngredients,
  };
}
