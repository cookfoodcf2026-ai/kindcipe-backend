/**
 * 三餸結構規則（deterministic，唔靠 LLM）
 *
 * 規則（管理層已拍板）：
 *   1. 蛋白唔重複：豬／雞／魚蝦／蛋／豆腐豆製品 各一
 *   2. 煮法唔重複：蒸／炒／煎炸／炆焗／灼煮 各一
 *   3. 菜系自由（中式、日韓、西式都可以）
 *
 * OpenCode review 後修正：
 *   - objective 改為「重複對數（collision score）」要下降，
 *     唔再要求完全無重複（否則 3 道同組時永遠 0 swap）。
 *   - 加詞語守衛：牛油果／牛油／牛奶／羊肚菌／魚香／蠔油 唔當蛋白。
 *   - 菜名冇線索時睇 ingredients。
 */

export const PROTEIN_GROUPS = ["pork", "beef", "chicken", "lamb", "seafood", "egg", "soy", "veg"] as const;
export type ProteinGroup = (typeof PROTEIN_GROUPS)[number];

export const COOKING_METHODS = ["steam", "stirfry", "panfry", "braise", "boil", "bake", "raw"] as const;
export type CookingMethod = (typeof COOKING_METHODS)[number];

/** 含蛋白字但唔係肉嘅詞（配對前先清走） */
const NEUTRAL_TOKENS = [
  "牛油果", "牛油", "牛奶", "奶油", "牛肝菌",
  "羊肚菌",
  "魚香", "魚露", "魚蛋", "魚蛋粉",
  "蠔油", "蠔豉",
  "雞蛋果", "雞粉", "雞湯",
  "肉豆蔻", "肉桂",
];

function stripNeutral(text: string): string {
  let t = text;
  for (const tok of NEUTRAL_TOKENS) t = t.split(tok).join(" ");
  return t;
}

const PROTEIN_RULES: Array<[ProteinGroup, RegExp]> = [
  ["beef", /牛|beef|steak/i],
  ["lamb", /羊|lamb/i],
  ["pork", /豬|猪|pork|排骨|腩肉|叉燒|煙肉|bacon|火腿|ham|肉餅|肉碎/i],
  ["chicken", /雞|鸡|chicken|雞翼|雞髀|雞胸/i],
  ["seafood", /魚|鱼|蝦|虾|蟹|蜆|蚬|蠔|蚝|魷|鱿|帶子|带子|花甲|shrimp|prawn|fish|salmon|tuna|squid|scallop|crab|oyster|clam/i],
  ["egg", /蛋|egg/i],
  ["soy", /豆腐|豆乾|豆干|豆卜|腐竹|豆漿|tofu|tempeh|枝豆|毛豆|edamame/i],
];

const METHOD_RULES: Array<[CookingMethod, RegExp]> = [
  ["steam", /蒸|steam/i],
  ["bake", /焗|烤|bake|roast|grill/i],
  ["stirfry", /炒|爆|stir[- ]?fr/i],
  ["panfry", /煎|炸|pan[- ]?fr|deep[- ]?fr/i],
  ["braise", /炆|燉|卤|滷|紅燒|红烧|braise|stew/i],
  ["boil", /灼|烚|煮|滾|滚|煲|湯|汤|soup|poach|simmer/i],
  ["raw", /沙律|沙拉|涼拌|凉拌|刺身|salad|sashimi/i],
];

function ingredientText(dish: unknown): string {
  const list = (dish as any)?.ingredients;
  if (!Array.isArray(list)) return "";
  return list
    .map((i: any) => (typeof i === "string" ? i : String(i?.name ?? i?.nameEn ?? "")))
    .join(" ");
}

function dishName(dish: unknown): string {
  return typeof dish === "string" ? dish : String((dish as any)?.name ?? "");
}

/**
 * 蛋白分類：先睇菜名（最可靠，例如「蒸排骨」），
 * 菜名冇線索時再睇食材（例如「咕嚕肉」要睇到豬肉）。
 */
export function proteinGroup(dish: string | { name: string; ingredients?: unknown }): ProteinGroup {
  const name = stripNeutral(dishName(dish));
  for (const [g, re] of PROTEIN_RULES) if (re.test(name)) return g;
  const ing = stripNeutral(ingredientText(dish));
  if (ing) for (const [g, re] of PROTEIN_RULES) if (re.test(ing)) return g;
  return "veg";
}

export function cookingMethod(dish: string | { name: string }): CookingMethod {
  const name = dishName(dish);
  for (const [m, re] of METHOD_RULES) if (re.test(name)) return m;
  return "stirfry"; // 冇明確線索時當炒（最常見）
}

export type DiversityDish = { name: string; ingredients?: unknown };

export type DiversityResult<T extends DiversityDish> = {
  dishes: T[];
  swapped: number;
  collisionsBefore: number;
  collisionsAfter: number;
  reasons: string[];
};

/** 重複對數：同一蛋白組 = 1 分，同一煮法 = 1 分 */
export function collisionScore(list: DiversityDish[]): number {
  let score = 0;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (proteinGroup(list[i]) === proteinGroup(list[j])) score += 1;
      if (cookingMethod(list[i]) === cookingMethod(list[j])) score += 1;
    }
  }
  return score;
}

/**
 * 貪心修正：每次換走後半嗰道，只要總 collision score 下降就接受。
 * @param dishes 已揀好嘅餸（唔包括湯）
 * @param candidates 後備（呼叫者要篩：同角色、有步驟、排除湯／甜品／飲品）
 */
export function enforceDiversity<T extends DiversityDish>(
  dishes: T[],
  candidates: T[],
  maxSwaps = 2,
): DiversityResult<T> {
  const out = [...dishes];
  const reasons: string[] = [];
  const collisionsBefore = collisionScore(out);
  let swapped = 0;

  for (let i = 0; i < out.length && swapped < maxSwaps; i++) {
    for (let j = i + 1; j < out.length && swapped < maxSwaps; j++) {
      const current = collisionScore(out);
      const sameProtein = proteinGroup(out[i]) === proteinGroup(out[j]);
      const sameMethod = cookingMethod(out[i]) === cookingMethod(out[j]);
      if (!sameProtein && !sameMethod) continue;

      const taken = new Set(out.map((d) => String(d.name)));
      let best: { dish: T; score: number } | null = null;
      for (const c of candidates) {
        if (taken.has(String(c.name))) continue;
        const trial = out.slice();
        trial[j] = c;
        const score = collisionScore(trial);
        if (score < current && (!best || score < best.score)) best = { dish: c, score };
      }

      if (best) {
        reasons.push(
          `swap ${out[j].name} → ${best.dish.name} (${sameProtein ? "protein" : ""}${
            sameProtein && sameMethod ? "+" : ""
          }${sameMethod ? "method" : ""}; score ${current}→${best.score})`,
        );
        out[j] = best.dish;
        swapped += 1;
      } else {
        reasons.push(`keep ${out[i].name} + ${out[j].name} (no improving candidate)`);
      }
    }
  }

  return {
    dishes: out,
    swapped,
    collisionsBefore,
    collisionsAfter: collisionScore(out),
    reasons,
  };
}

/** 回傳所有命中的蛋白組（多蛋白菜例如蝦仁豆腐蒸水蛋 → seafood + soy） */
export function proteinTags(dish: string | { name: string; ingredients?: unknown }): ProteinGroup[] {
  const name = stripNeutral(dishName(dish));
  const ing = stripNeutral(ingredientText(dish));
  const hits: ProteinGroup[] = [];
  for (const [g, re] of PROTEIN_RULES) {
    if (re.test(name) || (ing && re.test(ing))) hits.push(g);
  }
  if (hits.length === 0) hits.push("veg");
  return hits;
}
