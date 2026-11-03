/**
 * 三餸結構規則（deterministic，唔靠 LLM）
 *
 * 目標（管理層已拍板）：
 *   1. 蛋白唔重複：豬／雞／魚蝦／蛋／豆腐豆製品 各一（4 個位時允許 2 個「其他」）
 *   2. 煮法唔重複：蒸／炒／煎炸／炆焗／灼煮 各一
 *   3. 菜系自由（中式、日韓、西式都可以）
 *
 * 呢個 module 只做「揀完之後嘅修正」：若果兩道菜撞蛋白又撞煮法，
 * 就由同一個 pool 換入一道唔撞嘅。冇合適替代就保留原狀（唔會少一道）。
 */

export const PROTEIN_GROUPS = ["pork", "beef", "chicken", "lamb", "seafood", "egg", "soy", "veg"] as const;
export type ProteinGroup = (typeof PROTEIN_GROUPS)[number];

export const COOKING_METHODS = ["steam", "stirfry", "panfry", "braise", "boil", "bake", "raw"] as const;
export type CookingMethod = (typeof COOKING_METHODS)[number];

const PROTEIN_RULES: Array<[ProteinGroup, RegExp]> = [
  ["beef", /牛|beef|牛扒|牛腩|肥牛/i],
  ["lamb", /羊|lam[b]?|羊架/i],
  ["pork", /豬|猪|pork|排骨|腩肉|叉燒|煙肉|bacon|火腿|ham/i],
  ["chicken", /雞|鸡|chicken|雞翼|雞髀|雞胸/i],
  ["seafood", /魚|鱼|蝦|虾|蟹|蜆|蚬|蠔|蚝|魷|鱿|帶子|带子|花甲|shrimp|prawn|fish|salmon|tuna|squid|scallop|crab|oyster|clam/i],
  ["egg", /蛋|egg|雞蛋/i],
  ["soy", /豆腐|豆乾|豆干|豆卜|腐竹|豆漿|tofu|tempeh|枝豆|毛豆|edamame/i],
];

const METHOD_RULES: Array<[CookingMethod, RegExp]> = [
  ["steam", /蒸|steam/i],
  ["bake", /焗|烤|bake|roast|grill/i],
  ["stirfry", /炒|爆|stir[- ]?fr/i],
  ["panfry", /煎|炸|pan[- ]?fr|deep[- ]?fr|fry/i],
  ["braise", /炆|燉|卤|滷|紅燒|红烧|braise|stew/i],
  ["boil", /灼|烚|煮|滾|滚|煲|湯|汤|soup|boil|poach|simmer/i],
  ["raw", /沙律|沙拉|涼拌|凉拌|刺身|salad|sashimi/i],
];

function ingredientText(dish: unknown): string {
  const list = (dish as any)?.ingredients;
  if (!Array.isArray(list)) return "";
  return list
    .map((i: any) => (typeof i === "string" ? i : String(i?.name ?? i?.nameEn ?? "")))
    .join(" ");
}

/**
 * 蛋白分類：先睇菜名（最可靠，例如「蒸排骨」），
 * 菜名冇線索時再睇食材（例如「咕嚕肉」要睇到豬肉）。
 */
export function proteinGroup(dish: string | { name: string; ingredients?: unknown }): ProteinGroup {
  const name = typeof dish === "string" ? dish : String((dish as any)?.name ?? "");
  for (const [g, re] of PROTEIN_RULES) if (re.test(name)) return g;
  const ing = typeof dish === "string" ? "" : ingredientText(dish);
  if (ing) {
    for (const [g, re] of PROTEIN_RULES) if (re.test(ing)) return g;
  }
  return "veg";
}

export function cookingMethod(name: string): CookingMethod {
  const n = String(name ?? "");
  for (const [m, re] of METHOD_RULES) if (re.test(n)) return m;
  return "stirfry"; // 冇明確線索時當炒（最常見）
}

export type DiversityDish = { name: string; ingredients?: unknown };

export type DiversityResult<T extends DiversityDish> = {
  dishes: T[];
  swapped: number;
  reasons: string[];
};

/**
 * 檢查 + 修正撞板。
 * @param dishes 已揀好嘅餸（唔包括湯）
 * @param candidates 同角色嘅後備（同 dishes 同 type 嘅 pool）
 */
export function enforceDiversity<T extends DiversityDish>(
  dishes: T[],
  candidates: T[],
  maxSwaps = 2,
): DiversityResult<T> {
  const out = [...dishes];
  const reasons: string[] = [];
  let swapped = 0;

  const usedProteins = () => out.map((d) => proteinGroup(d));
  const usedMethods = () => out.map((d) => cookingMethod(d.name));

  for (let i = 0; i < out.length && swapped < maxSwaps; i++) {
    for (let j = i + 1; j < out.length && swapped < maxSwaps; j++) {
      const sameProtein = proteinGroup(out[i]) === proteinGroup(out[j]);
      const sameMethod = cookingMethod(out[i].name) === cookingMethod(out[j].name);
      if (!sameProtein && !sameMethod) continue;

      // 試由 candidates 搵替代（換走 j）
      const taken = new Set(out.map((d) => d.name));
      const pBefore = usedProteins();
      const mBefore = usedMethods();
      const pick = candidates.find((c) => {
        if (taken.has(c.name)) return false;
        const pg = proteinGroup(c);
        const cm = cookingMethod(c.name);
        const proteinOk = !sameProtein || pg !== proteinGroup(out[i]);
        const methodOk = !sameMethod || cm !== cookingMethod(out[i].name);
        if (!proteinOk || !methodOk) return false;
        // 換入之後整體唔可以多撞
        const pAfter = pBefore.filter((_, k) => k !== j).concat(pg);
        const mAfter = mBefore.filter((_, k) => k !== j).concat(cm);
        const dupP = new Set(pAfter).size !== pAfter.length;
        const dupM = new Set(mAfter).size !== mAfter.length;
        return !dupP && !dupM;
      });

      if (pick) {
        reasons.push(`swap ${out[j].name} → ${pick.name} (${sameProtein ? "protein" : ""}${sameProtein && sameMethod ? "+" : ""}${sameMethod ? "method" : ""})`);
        out[j] = pick;
        swapped += 1;
      } else {
        reasons.push(`keep ${out[i].name} + ${out[j].name} (no better candidate)`);
      }
    }
  }

  return { dishes: out, swapped, reasons };
}
