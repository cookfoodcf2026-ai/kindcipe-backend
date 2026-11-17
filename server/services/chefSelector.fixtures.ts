/**
 * In-memory, deterministic recipe pool for selector tests and baseline
 * measurement. Never touches the production DB.
 *
 * Covers all six dish types the swap/meal selectors care about, plus the
 * deliberate hard cases: vegetarian cards, a peanut-allergy card, seafood,
 * soups, and multiple cards per type.
 */

export type ChefFixtureRow = {
  id: number;
  name: string;
  source: "official";
  dishType: "meat" | "seafood" | "vegetable" | "soup" | "carb" | "dessert";
  ingredients: Array<{ name: string; quantity: string; unit: string }>;
  steps: string[];
  cookTime: number;
  servings: number;
  tags: string[];
  scenarioTags: string[];
  hasMedia: boolean;
  popularity?: number;
};

const ing = (...names: string[]) =>
  names.map((name) => ({ name, quantity: "1", unit: "份" }));

const row = (
  id: number,
  name: string,
  dishType: ChefFixtureRow["dishType"],
  ingredients: string[],
  extra: Partial<ChefFixtureRow> = {},
): ChefFixtureRow => ({
  id,
  name,
  source: "official",
  dishType,
  ingredients: ing(...ingredients),
  steps: ["備料", "烹調", "上碟"],
  cookTime: 20,
  servings: 4,
  // Chinese type labels keep the fixture provider searchable by the same
  // queries the production search uses (海鮮／肉／菜／湯／甜品／麵).
  tags: [],
  scenarioTags: [],
  hasMedia: id % 2 === 0,
  ...extra,
});

export const CHEF_FIXTURE_POOL: ChefFixtureRow[] = [
  // ── seafood (4) ───────────────────────────────────────────────────────────
  row(1, "清蒸鱸魚", "seafood", ["鱸魚", "薑", "蔥"], { tags: ["海鮮"], scenarioTags: ["quick", "healthy"], cookTime: 25, popularity: 98 }),
  row(2, "蒜蓉蒸蝦", "seafood", ["蝦", "蒜", "蔥"], { tags: ["海鮮"], scenarioTags: ["quick", "kids"], cookTime: 15, popularity: 91 }),
  row(3, "香煎三文魚", "seafood", ["三文魚", "檸檬"], { tags: ["海鮮"], scenarioTags: ["quick", "highProtein"], cookTime: 18 }),
  row(4, "豉椒炒蜆", "seafood", ["蜆", "豆豉", "青椒"], { tags: ["海鮮"], scenarioTags: ["guest"], cookTime: 20 }),

  // ── meat (4) ──────────────────────────────────────────────────────────────
  row(5, "紅燒肉", "meat", ["五花肉", "冰糖", "豉油"], { tags: ["肉"], scenarioTags: ["guest"], cookTime: 90 }),
  row(6, "蜜汁叉燒", "meat", ["梅頭肉", "蜜糖"], { tags: ["肉"], scenarioTags: ["guest", "kids"], cookTime: 60 }),
  row(7, "黑椒牛柳", "meat", ["牛柳", "黑椒", "洋蔥"], { tags: ["肉"], scenarioTags: ["guest"], cookTime: 25 }),
  // Deliberate peanut-allergy fixture.
  row(8, "宮保雞丁", "meat", ["雞肉", "花生", "乾辣椒"], { tags: ["肉"], scenarioTags: ["guest"], cookTime: 25 }),

  // ── vegetable (4, all vegetarian) ─────────────────────────────────────────
  row(9, "青菜洋蔥豆腐小炒", "vegetable", ["青菜", "洋蔥", "豆腐", "蒜"], { tags: ["蔬菜"], scenarioTags: ["quick", "healthy", "vegetarian"], cookTime: 10, popularity: 95 }),
  row(10, "洋蔥炒蛋", "vegetable", ["洋蔥", "雞蛋"], { tags: ["蔬菜"], scenarioTags: ["quick", "kids", "vegetarian"], cookTime: 12 }),
  row(11, "麻婆豆腐", "vegetable", ["豆腐", "豆瓣醬", "花椒"], { tags: ["蔬菜"], scenarioTags: ["vegetarian"], cookTime: 15 }),
  row(12, "清炒西蘭花", "vegetable", ["西蘭花", "蒜"], { tags: ["蔬菜"], scenarioTags: ["quick", "healthy", "vegetarian"], cookTime: 10 }),

  // ── soup (4) ──────────────────────────────────────────────────────────────
  row(13, "番茄豆腐湯", "soup", ["番茄", "豆腐", "蔥"], { tags: ["湯水"], scenarioTags: ["quick", "vegetarian"], cookTime: 20 }),
  row(14, "冬瓜排骨湯", "soup", ["冬瓜", "排骨", "薑"], { tags: ["湯水"], scenarioTags: ["healthy"], cookTime: 90 }),
  row(15, "紫菜蛋花湯", "soup", ["紫菜", "雞蛋", "蔥"], { tags: ["湯水"], scenarioTags: ["quick", "vegetarian"], cookTime: 10 }),
  row(16, "粟米紅蘿蔔湯", "soup", ["粟米", "紅蘿蔔", "腰果"], { tags: ["湯水"], scenarioTags: ["vegetarian"], cookTime: 60 }),

  // ── carb (4) ──────────────────────────────────────────────────────────────
  row(17, "揚州炒飯", "carb", ["白飯", "雞蛋", "蝦仁"], { tags: ["麵食"], scenarioTags: ["quick"], cookTime: 15 }),
  row(18, "番茄蛋花麵", "carb", ["麵", "番茄", "雞蛋"], { tags: ["麵食"], scenarioTags: ["quick", "vegetarian"], cookTime: 15 }),
  row(19, "蔥油拌麵", "carb", ["麵", "蔥", "豉油"], { tags: ["麵食"], scenarioTags: ["quick", "vegetarian"], cookTime: 10 }),
  row(20, "乾炒牛河", "carb", ["河粉", "牛肉", "芽菜"], { tags: ["麵食"], scenarioTags: ["guest"], cookTime: 15 }),

  // ── dessert (4) ───────────────────────────────────────────────────────────
  row(21, "芒果布甸", "dessert", ["芒果", "牛奶", "魚膠粉"], { tags: ["甜品"], scenarioTags: ["kids", "vegetarian"], cookTime: 30 }),
  row(22, "紅豆沙", "dessert", ["紅豆", "冰糖"], { tags: ["甜品"], scenarioTags: ["vegetarian"], cookTime: 60 }),
  row(23, "楊枝甘露", "dessert", ["芒果", "西柚", "椰奶"], { tags: ["甜品"], scenarioTags: ["kids", "vegetarian"], cookTime: 20 }),
  row(24, "芝麻糊", "dessert", ["黑芝麻", "米", "冰糖"], { tags: ["甜品"], scenarioTags: ["vegetarian"], cookTime: 30 }),
];

const QUERY_ALIASES: Record<string, string[]> = {
  海鮮: ["seafood", "海鮮", "魚", "蝦", "蜆"],
  seafood: ["seafood", "海鮮", "魚", "蝦", "蜆"],
  肉: ["meat", "肉", "豬", "牛", "雞"],
  meat: ["meat", "肉", "豬", "牛", "雞"],
  菜: ["vegetable", "蔬菜", "青菜", "西蘭花", "洋蔥", "豆腐"],
  vegetable: ["vegetable", "蔬菜", "青菜", "西蘭花", "洋蔥", "豆腐"],
  湯: ["soup", "湯水", "湯"],
  soup: ["soup", "湯水", "湯"],
  甜品: ["dessert", "甜品", "糖水"],
  dessert: ["dessert", "甜品", "糖水"],
  麵: ["carb", "麵食", "麵"],
  carb: ["carb", "麵食", "麵"],
};

/** In-memory search stand-in for `searchOverride`; never touches the DB. */
export async function fixtureSearch(
  query: string,
  limit: number,
  _cookTimeMax?: number,
): Promise<Record<string, unknown>[]> {
  const q = String(query ?? "").trim();
  if (!q) return CHEF_FIXTURE_POOL.slice(0, Math.max(0, limit)).map((r) => ({ ...r }));
  const aliases = QUERY_ALIASES[q] ?? [q];
  const hits = CHEF_FIXTURE_POOL.filter((r) => {
    const haystack = [
      r.name,
      r.dishType,
      ...r.tags,
      ...r.ingredients.map((i) => i.name),
    ].join(" ");
    return aliases.some((term) => haystack.includes(term));
  });
  return hits.slice(0, Math.max(0, limit)).map((r) => ({ ...r }));
}

/** Deterministic LCG so shuffle-based selectors are reproducible in tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function withSeededRandom<T>(seed: number, fn: () => Promise<T>): Promise<T> {
  const original = Math.random;
  Math.random = mulberry32(seed);
  return fn().finally(() => {
    Math.random = original;
  });
}
