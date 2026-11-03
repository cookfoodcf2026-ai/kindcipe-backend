/**
 * 食物詞 → 菜名/食材對應表（deterministic）
 *
 * 用途：AI Chef「0 卡 salvage」——用戶問「想食蛋類」「有咩豆腐菜式」時，
 * 唔應該用全文搜尋（會撈到「魚柳條」因為成份有蛋漿），而係按詞分類精準揀卡。
 */

export type FoodTermPattern = {
  keys: string[];
  name: RegExp;
  /** 只作為 fallback：菜名唔中時，睇主食材 */
  ingredient?: RegExp;
};

export const FOOD_TERM_PATTERNS: FoodTermPattern[] = [
  { keys: ["蛋", "雞蛋"], name: /蛋/, ingredient: /蛋/ },
  { keys: ["豆腐", "豆卜", "腐竹", "豆乾", "豆干"], name: /豆腐|豆卜|腐竹|豆乾|豆干/, ingredient: /豆腐|豆卜|腐竹|豆乾|豆干/ },
  { keys: ["蝦", "虾"], name: /蝦|虾/, ingredient: /蝦|虾/ },
  { keys: ["蟹"], name: /蟹/, ingredient: /蟹/ },
  { keys: ["魚", "鱼"], name: /魚|鱼/, ingredient: /魚|鱼/ },
  { keys: ["雞", "鸡", "雞肉"], name: /雞|鸡/, ingredient: /雞|鸡/ },
  { keys: ["牛", "牛肉"], name: /牛/, ingredient: /牛/ },
  { keys: ["豬", "猪", "排骨", "豬肉"], name: /豬|猪|排骨|腩|叉燒/, ingredient: /豬|猪|排骨|腩/ },
  { keys: ["羊", "羊肉"], name: /羊/, ingredient: /羊/ },
  { keys: ["菇", "菇類", "蘑菇"], name: /菇|菌/, ingredient: /菇|菌/ },
  { keys: ["菜", "蔬菜", "青菜"], name: /菜|苗|蘭/, ingredient: /菜|苗|蘭/ },
  { keys: ["湯", "湯水"], name: /湯|汤/, ingredient: /湯|汤/ },
  { keys: ["麵", "面", "粉麵"], name: /麵|面|粉|意粉/, ingredient: /麵|面|粉/ },
  { keys: ["飯"], name: /飯|饭/, ingredient: /飯|饭/ },
];

export function findFoodTermPattern(term: string): FoodTermPattern | null {
  const t = String(term ?? "").trim();
  if (!t) return null;
  // 最長 key 優先（「豆腐」先於「豆」）
  const sorted = [...FOOD_TERM_PATTERNS].sort((a, b) => {
    const la = Math.max(...a.keys.map((k) => k.length));
    const lb = Math.max(...b.keys.map((k) => k.length));
    return lb - la;
  });
  for (const p of sorted) {
    if (p.keys.some((k) => t.includes(k))) return p;
  }
  return null;
}

function ingredientNames(card: any): string {
  const list = Array.isArray(card?.ingredients) ? card.ingredients : [];
  return list.map((i: any) => String(i?.name ?? i?.nameEn ?? "")).join(" ");
}

/** 菜名命中（最準） */
export function matchesByTermName(card: any, pattern: FoodTermPattern): boolean {
  return pattern.name.test(String(card?.name ?? ""));
}

/** 菜名唔中時，用主食材判斷 */
export function matchesByTermIngredient(card: any, pattern: FoodTermPattern): boolean {
  if (!pattern.ingredient) return false;
  return pattern.ingredient.test(ingredientNames(card));
}
