/**
 * normalizeRecipeIngredients — 將食譜 ingredients 統一整理：
 *   1. 拆開「一欄多樣」（name 用 / 、 ； 分隔咗多樣食材）→ 每樣一個獨立 ingredient
 *   2. 每個獨立 ingredient 重新分類（categorizeIngredient）
 *   3. quantity「各30克」→ 每樣 30 克；「少許」→ 每樣少許
 *
 * 目的：避免「鮮蝦仁/冬菇/叉燒粒」入庫後加入購物車時 3 樣顯示同一行 / 類別全部「其他」。
 */

export interface NormalizedIngredient {
  name: string;
  quantity: string;
  unit: string;
  category: string;
}

const CATEGORY_RULES: { cat: string; keywords: string[] }[] = [
  { cat: "蔬菜", keywords: ["菜心", "芥蘭", "西蘭花", "椰菜", "菠菜", "生菜", "白菜", "青菜", "蘿蔔", "紅蘿蔔", "白蘿蔔", "番茄", "蕃茄", "薯仔", "青瓜", "黃瓜", "茄子", "南瓜", "冬瓜", "絲瓜", "勝瓜", "洋蔥", "芹菜", "韭菜", "豆", "芽", "菇", "木耳", "筍", "菜"] },
  { cat: "肉類", keywords: ["排骨", "豬扒", "豬腩", "豬頸", "牛肉", "豬肉", "羊肉", "雞肉", "雞翼", "雞腿", "雞胸", "火腿", "臘肉", "腸", "丸", "扒", "腩", "柳", "雞", "豬", "牛", "羊", "鴨", "鵝"] },
  { cat: "海鮮", keywords: ["魚", "蝦", "蟹", "貝", "魷魚", "章魚", "帶子", "蠔", "蜆", "蛤", "鮑魚", "海參", "螺"] },
  { cat: "蛋奶", keywords: ["雞蛋", "蛋", "牛奶", "芝士", "牛油", "奶油", "奶"] },
  { cat: "主食", keywords: ["飯", "米", "麵", "粉絲", "米粉", "河粉", "烏冬", "意粉", "通粉", "麵包", "餃子", "雲吞"] },
  { cat: "調味料", keywords: ["鹽", "糖", "油", "醬油", "生抽", "老抽", "豉油", "蠔油", "麻油", "胡椒粉", "黑椒粉", "醋", "料酒", "米酒", "紹酒", "紹興酒", "雞粉", "味精", "生粉", "粟粉", "太白粉", "蒜蓉", "薑蓉", "蔥花", "八角", "花椒", "五香粉", "味醂"] },
  { cat: "乾貨", keywords: ["冬菇", "木耳", "金針", "蝦米", "瑤柱", "蓮子", "百合", "紅棗", "枸杞", "臘腸", "鹹蛋", "皮蛋", "腐乳", "乾"] },
];

const DISH_NAME_MARKERS = ["飯", "麵", "湯", "煲", "扒", "排", "餸", "料理", "菜式", "粥", "點心", "火鍋"];

/** 判斷係咪調味料（避開菜式詞） */
function isSeasoning(name: string): boolean {
  const n = name.toLowerCase();
  if (DISH_NAME_MARKERS.some((m) => n.includes(m))) return false;
  return CATEGORY_RULES[5].keywords.some((kw) => n.includes(kw));
}

/** 分類單一食材 */
export function categorizeIngredientName(name: string): string {
  const n = String(name || "").toLowerCase();
  for (const rule of CATEGORY_RULES) {
    for (const kw of rule.keywords) {
      if (n.includes(kw)) return rule.cat;
    }
  }
  return "其他";
}

/** 拆開「一欄多樣」：name 用 / 、 ； 分隔多樣食材（括號入面嘅唔拆） */
function splitMultiName(name: string): string[] {
  const n = String(name || "");
  // 先保護括號（…）入面嘅內容，避免「滷包（八角/花椒）」被拆
  const protectedParts: string[] = [];
  const withoutParens = n.replace(/（[^）]*）|\([^)]*\)/g, (m) => {
    protectedParts.push(m);
    return `\u0000${protectedParts.length - 1}\u0000`;
  });
  const chunks = withoutParens.split(/[/、；;|，]/).map((s) => s.trim()).filter(Boolean);
  return chunks.map((c) => c.replace(/\u0000(\d+)\u0000/g, (_, i) => protectedParts[Number(i)]));
}

/** 由 quantity 抽「每樣份量」：「各30克」→ 30 克；「少許」→ 少許 */
function perItemQty(rawQty: string, totalParts: number): { quantity: string; unit: string } {
  const q = String(rawQty || "").trim();
  if (!q) return { quantity: "", unit: "" };
  if (/^各/.test(q)) {
    // 「各30克」→ 30 克；「各50 克」→ 50 克；「各1湯匙」→ 1 湯匙
    const rest = q.replace(/^各/, "").trim();
    const m = rest.match(/^([\d.]+)\s*([^\d\s]*)$/);
    if (m) return { quantity: m[1], unit: m[2] || "" };
    // 有空格：「各50 克」→ rest = "50 克" → match 唔到（因為中間有空格），逐段處理
    const mm = rest.match(/^([\d.]+)\s*(\S+)?$/);
    if (mm) return { quantity: mm[1], unit: mm[2] || "" };
    return { quantity: rest, unit: "" };
  }
  if (/^(少許|適量|適量調味|調味)$/.test(q)) return { quantity: q, unit: "" };
  // 其他：保留原樣（唔好亂拆，避免數量錯）
  return { quantity: q, unit: "" };
}

/**
 * 主入口：將 ingredient array normalize。
 * 每個 ingredient：name 若含分隔符 → 拆開；每樣重新分類 + 分份量。
 */
export function normalizeRecipeIngredients(
  ingredients: Array<{ name: string; quantity?: string; unit?: string; category?: string }>
): NormalizedIngredient[] {
  if (!Array.isArray(ingredients)) return [];
  const out: NormalizedIngredient[] = [];
  for (const ing of ingredients) {
    const rawName = String(ing?.name ?? "").trim();
    if (!rawName) continue;
    const parts = splitMultiName(rawName);
    if (parts.length <= 1) {
      // 單一食材：保留，重新分類（若無 category 或 category 係「其他」但實際分到類）
      const cat = ing?.category && ing.category !== "其他" ? ing.category : categorizeIngredientName(rawName);
      out.push({ name: rawName, quantity: String(ing?.quantity ?? ""), unit: String(ing?.unit ?? ""), category: cat });
      continue;
    }
    // 一欄多樣：拆開
    const per = perItemQty(String(ing?.quantity ?? ""), parts.length);
    for (const p of parts) {
      out.push({ name: p, quantity: per.quantity, unit: per.unit, category: categorizeIngredientName(p) });
    }
  }
  return out;
}
