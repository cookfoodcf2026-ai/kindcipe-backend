import type { RequestedRole } from "./chefIntent";

type ProteinFamily = "beef" | "chicken" | "pork" | "lamb" | "seafood" | "egg_tofu";

type ProteinFamilySpec = {
  role: RequestedRole;
  aliases: string[];
  fallbackQueries: string[];
};

/**
 * Shared, deterministic food vocabulary. Both meal role search and single-card
 * search use this file so a beef request cannot silently become chicken.
 */
export const PROTEIN_FAMILIES: Record<ProteinFamily, ProteinFamilySpec> = {
  beef: {
    role: "meat",
    aliases: ["牛扒", "牛排", "牛柳", "牛肉", "牛腩", "牛肩", "牛肋", "牛小排", "和牛", "西冷"],
    fallbackQueries: ["牛扒", "牛排", "牛柳", "牛"],
  },
  chicken: {
    role: "meat",
    aliases: ["雞扒", "雞排", "雞腿", "雞髀", "雞翼", "雞翅", "雞胸", "雞肉"],
    fallbackQueries: ["雞扒", "雞腿", "雞髀", "雞"],
  },
  pork: {
    role: "meat",
    aliases: ["豬扒", "豬排", "豬肉", "豬腩", "豬手", "豬腳", "排骨", "叉燒", "燒肉"],
    fallbackQueries: ["豬扒", "豬排", "豬肉", "豬"],
  },
  lamb: {
    role: "meat",
    aliases: ["羊扒", "羊排", "羊肉", "羊架", "羊腩"],
    fallbackQueries: ["羊扒", "羊排", "羊肉", "羊"],
  },
  seafood: {
    role: "seafood",
    aliases: ["海鮮", "魚扒", "魚柳", "三文魚", "鱸魚", "石斑", "蝦", "蟹", "蜆", "蠔", "魷魚", "帶子"],
    fallbackQueries: ["海鮮", "魚", "蝦"],
  },
  egg_tofu: {
    role: "seafood",
    aliases: ["雞蛋", "蛋", "豆腐", "豆卜", "豆乾", "腐皮", "腐竹"],
    fallbackQueries: ["蛋", "豆腐"],
  },
};

const VEGETABLE_TERMS = [
  "菜心", "芥蘭", "通菜", "菠菜", "生菜", "白菜", "椰菜", "西蘭花", "時蔬", "蔬菜", "青菜", "菜",
  "南瓜", "蘿蔔", "薯仔", "番茄", "茄子", "青椒", "洋蔥", "節瓜", "勝瓜", "苦瓜", "冬瓜", "青瓜",
  "黃瓜", "絲瓜", "豆苗", "豆芽", "豆角", "青豆", "毛豆", "雲耳", "木耳", "菇", "菌", "筍",
];
const SOUP_TERMS = ["湯水", "老火湯", "燉湯", "煲湯", "滾湯", "湯羹", "湯", "soup"];
const NOODLE_TERMS = ["湯麵", "拉麵", "烏冬", "米線", "意粉", "河粉", "米粉", "麵", "noodle", "ramen", "udon", "pasta"];
const DESSERT_TERMS = ["甜品", "甜點", "糖水", "布甸", "蛋糕", "雪糕", "dessert"];

const ALL_FOOD_TERMS = [...new Set([
  ...Object.values(PROTEIN_FAMILIES).flatMap((f) => f.aliases),
  ...VEGETABLE_TERMS,
  ...SOUP_TERMS,
  ...NOODLE_TERMS,
  ...DESSERT_TERMS,
])].sort((a, b) => b.length - a.length);

export function proteinFamilyForTerm(term: string): ProteinFamily | undefined {
  const raw = String(term ?? "").trim();
  if (!raw) return undefined;
  for (const [family, spec] of Object.entries(PROTEIN_FAMILIES) as Array<[ProteinFamily, ProteinFamilySpec]>) {
    if (spec.aliases.some((alias) => alias.length === 1 ? raw === alias : raw.includes(alias))) return family;
  }
  return undefined;
}

/** Longest known food term in the text, or null. */
export function findFoodTerm(text: string): string | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  return ALL_FOOD_TERMS.find((term) => raw.includes(term)) ?? null;
}

/** Pick the last question clause that actually mentions food. */
export function lastFoodClause(text: string): string {
  const raw = String(text ?? "").trim();
  if (!raw) return "";
  const clauses = raw.split(/[?？]+/).map((part) => part.trim()).filter(Boolean);
  const withFood = clauses.filter((clause) => findFoodTerm(clause));
  if (withFood.length > 0) return withFood[withFood.length - 1];
  return clauses.length > 0 ? clauses[clauses.length - 1] : raw;
}

export function hasRequestVerb(text: string): boolean {
  return /(?:我|你)?(?:要|想食|想吃|想煮|想整|要食|要煮|要整|食|吃|煮|整|煎|烤|焗|炒)/.test(String(text ?? ""));
}

export function roleForFoodTerm(term: string): RequestedRole {
  const raw = String(term ?? "").trim();
  const family = proteinFamilyForTerm(raw);
  if (family) return PROTEIN_FAMILIES[family].role;
  if (SOUP_TERMS.some((t) => raw.includes(t))) return "soup";
  if (NOODLE_TERMS.some((t) => raw.includes(t))) return "noodle";
  if (DESSERT_TERMS.some((t) => raw.includes(t))) return "dessert";
  if (VEGETABLE_TERMS.some((t) => raw.includes(t))) return "vegetable";
  return "any";
}

export function fallbackQueriesForFoodTerm(term: string): string[] {
  const raw = String(term ?? "").trim();
  const family = proteinFamilyForTerm(raw);
  if (family) return [...PROTEIN_FAMILIES[family].fallbackQueries];
  if (SOUP_TERMS.some((t) => raw.includes(t))) return ["湯"];
  if (NOODLE_TERMS.some((t) => raw.includes(t))) return ["麵"];
  if (DESSERT_TERMS.some((t) => raw.includes(t))) return ["甜品"];
  if (VEGETABLE_TERMS.some((t) => raw.includes(t))) return ["菜", "蔬菜"];
  return [];
}
