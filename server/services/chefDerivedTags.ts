import { deriveScenarios } from "../utils/scenario";

export type DerivedTagInput = {
  name?: string | null;
  description?: string | null;
  dishType?: string | null;
  recipeCategory?: string | null;
  cookTime?: number | null;
  difficulty?: string | null;
  ingredients?: Array<{ name?: string | null }> | string | null;
  steps?: Array<string | { instruction?: string | null }> | string | null;
  tags?: string[] | string | null;
};

export type DerivedTagFacets = {
  protein: string[];
  method: string[];
  diet: string[];
  tags: string[];
  main: string[];
};

function toText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === "string"
          ? item
          : item && typeof item === "object"
            ? String((item as any).name ?? (item as any).instruction ?? "")
            : String(item ?? ""),
      )
      .join(" ");
  }
  return String(value);
}

function ingredientNames(ingredients: DerivedTagInput["ingredients"]): string[] {
  if (!ingredients) return [];
  if (typeof ingredients === "string") {
    try {
      const parsed = JSON.parse(ingredients);
      return Array.isArray(parsed) ? ingredientNames(parsed) : [String(parsed ?? "")];
    } catch {
      return ingredients.split(/[,，\n、;；]+/).map((part) => part.trim()).filter(Boolean);
    }
  }
  return ingredients
    .map((ingredient) => String(ingredient?.name ?? "").trim())
    .filter((name) => name.length > 0 && name.length <= 16)
    .filter((name) => !/^[\d\s./半一二三四五六七八九十百]+(克|g|kg|毫升|ml|茶匙|湯匙|匙|瓣|個|隻|條|片|杯|碗|適量|少許)$/i.test(name));
}

function tagList(tags: DerivedTagInput["tags"]): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map(String);
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return String(tags).split(/[,，、;；\s]+/).filter(Boolean);
  }
}

const PROTEIN_PATTERNS: Array<[string, RegExp]> = [
  ["beef", /牛肉|牛扒|牛排|牛柳|牛腩|牛肩|牛肋|牛小排|和牛|西冷|牛仔骨|牛丸|牛腱|beef|steak/i],
  ["pork", /豬肉|猪肉|豬扒|猪扒|豬排|猪排|豬手|猪手|豬腳|猪脚|排骨|叉燒|叉烧|燒肉|烧肉|煙肉|烟肉|培根|火腿|午餐肉|肉丸|豬|pork|bacon|ham/i],
  ["chicken", /雞肉|鸡肉|雞扒|鸡扒|雞排|鸡排|雞腿|鸡腿|雞髀|鸡髀|雞翼|鸡翼|雞翅|鸡翅|雞胸|鸡胸|三黃雞|三黄鸡|雞|chicken|poultry/i],
  ["fish", /三文魚|三文鱼|鱸魚|鲈鱼|石斑|紅衫魚|红衫鱼|鯪魚|鲮鱼|鰂魚|鲗鱼|鯇魚|鲩鱼|桂花魚|桂花鱼|黃花魚|黄花鱼|白身魚|白身鱼|魚柳|鱼柳|魚扒|鱼扒|魚片|鱼片|魚塊|鱼块|魚|fish|salmon|bass|grouper|tilapia|sole|cod/i],
  ["seafood", /海鮮|海鲜|蝦|虾|蟹|蜆|蚬|蠔|蚝|帶子|带子|扇貝|扇贝|青口|魷魚|鱿鱼|墨魚|墨鱼|八爪魚|八爪鱼|龍蝦|龙虾|鮑魚|鲍鱼|海參|海参|花甲|蟶子|蛏子|seafood|shrimp|prawn|crab|squid|octopus|scallop|oyster|clam|mussel/i],
  ["egg", /雞蛋|鸡蛋|鴨蛋|鸭蛋|鵪鶉蛋|鹌鹑蛋|皮蛋|鹹蛋|咸蛋|蛋黃|蛋黄|(?<!高)蛋白(?!粉|霜|質|质)|egg/i],
  ["soy", /豆腐|豆卜|豆乾|豆干|腐竹|腐皮|豆皮|毛豆|黃豆|黄豆|豆漿|豆浆|豆奶|素雞|素鸡|天貝|天贝|tofu|soy|edamame|tempeh/i],
];

// Ingredients that mention a protein word but are not a protein main.
const PROTEIN_FALSE_POSITIVES: Array<[string, RegExp]> = [
  ["beef", /牛油|牛油果|牛角|牛蒡|牛奶|奶油|牛至/i],
  ["chicken", /雞蛋|鸡蛋|雞湯|鸡汤|雞粉|鸡粉|雞精|鸡精|雞油|鸡油/i],
  ["fish", /魚露|鱼露|魚腥草|鱼腥草|魚香|鱼香|木魚花|木鱼花|魚膠|鱼胶/i],
  ["pork", /豬仔包|猪仔包|豬腸粉|猪肠粉|豬籠草|猪笼草/i],
  ["seafood", /蠔油|蚝油|蝦米|虾米|瑤柱|瑶柱|蠔豉|蚝豉/i],
];

/** 菇／菌／素肉 呢類字會帶出「海鮮／雞」等假訊號，先剝走。 */
function neutraliseProteinNoise(text: string): string {
  return String(text ?? "")
    .replace(/[^\s，、]{0,3}(?:菇|菌)/g, " ")
    .replace(/素肉|素雞|素蠔|植物肉/g, " ")
    // 「高蛋白」係營養標籤，唔係蛋類食材
    .replace(/高蛋白|蛋白質|蛋白质|蛋白粉|蛋白霜/g, " ");
}

const PROTEIN_INGREDIENT_CATEGORIES = new Set(["肉類", "海鮮", "蛋奶"]);

type IngredientRow = { name: string; category: string };

function ingredientRows(ingredients: unknown): IngredientRow[] {
  const list = Array.isArray(ingredients) ? ingredients : [];
  return list
    .map((item: any) => ({
      name: String(item?.name ?? item ?? "").trim(),
      category: String(item?.category ?? "").trim(),
    }))
    .filter((row) => row.name.length > 0);
}

function hasProtein(text: string, protein: string): boolean {
  const pattern = PROTEIN_PATTERNS.find(([key]) => key === protein)?.[1];
  if (!pattern || !pattern.test(text)) return false;
  const falsePositive = PROTEIN_FALSE_POSITIVES.find(([key]) => key === protein)?.[1];
  if (!falsePositive) return true;
  const cleaned = text.replace(new RegExp(falsePositive.source, "gi"), " ");
  return pattern.test(cleaned);
}

const METHOD_PATTERNS: Array<[string, RegExp]> = [
  ["steam", /清蒸|蒸|steam/i],
  ["stirfry", /炒|煎|爆炒|快炒|stir.?fry|pan.?fry|saut[eé]/i],
  ["boil", /白灼|烚|灼|滾|滚|煲|煮|boil|poach/i],
  ["braise", /炆|燜|焖|燉|炖|滷|卤|紅燒|红烧|braise|stew/i],
  ["bake", /焗|烤|烘|bake|roast|grill/i],
  ["deepfry", /炸|油炸|deep.?fry|fried/i],
  ["cold", /涼拌|凉拌|冷盤|冷盘|刺身|沙律|沙拉|cold|salad/i],
];

function detectDishType(input: DerivedTagInput, body: string): string | undefined {
  const explicit = String(input.dishType ?? "").trim().toLowerCase();
  const mapped: Record<string, string> = {
    soup: "soup", meat: "stirfry", seafood: "stirfry", vegetable: "stirfry",
    carb: "noodle", appetizer: "snack", dessert: "snack", drink: "snack", other: "stirfry",
  };
  if (mapped[explicit]) return mapped[explicit];
  if (/湯|汤|羹|soup|broth/i.test(body)) return "soup";
  if (/麵|面|粉|米線|米线|河粉|烏冬|乌冬|意粉|通粉|noodle|ramen|udon|pasta/i.test(body)) return "noodle";
  if (/飯|饭|炒飯|炒饭|煲仔飯|煲仔饭|丼|rice/i.test(body)) return "rice";
  if (/蒸|steam/i.test(body)) return "steam";
  if (/炆|燜|焖|燉|炖|滷|卤|紅燒|红烧|braise|stew/i.test(body)) return "braise";
  if (/炒|煎|stir.?fry|pan.?fry/i.test(body)) return "stirfry";
  if (/小食|小吃|點心|点心|早餐|snack|dessert|甜品|糖水/i.test(body)) return "snack";
  return undefined;
}

const TAG_ALIASES: Array<[string, RegExp]> = [
  ["light", /清淡|清湯|清汤|少油|低脂|低卡|輕食|轻食|健康|少鹽|少盐|light|healthy/i],
  ["spicy", /辣|麻辣|辣椒|花椒|芥末|wasabi|chilli|chili|spicy/i],
  ["kids", /小朋友|細路|儿童|兒童|親子|亲子|幼兒|幼儿|kids|children/i],
  ["one-pot", /一鍋|一锅|電飯煲|电饭煲|電子鍋|电子锅|煲仔|燜|焖|炆|慢煮|壓力鍋|压力锅|one.?pot|rice.?cooker/i],
  ["high-protein", /高蛋白|蛋白質|蛋白质|增肌|健身|high.?protein|protein/i],
  ["guest", /宴客|大菜|喜慶|喜庆|節慶|节庆|招待|派對|派对|guest|party/i],
  ["breakfast", /早餐|早點|早点|breakfast|brunch/i],
  ["quick", /快煮|快手|快速|簡單|简单|半個鐘|半个钟|半小時|半小时|quick|easy/i],
];

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/** Deterministic facets used by the retrieval layer and stored in derived_tags. */
export function deriveRecipeFacets(input: DerivedTagInput): DerivedTagFacets {
  const ingredientText = ingredientNames(input.ingredients).join(" ");
  const tags = tagList(input.tags);
  const name = String(input.name ?? "");
  const body = `${name} ${String(input.description ?? "")} ${toText(input.steps)} ${ingredientText} ${tags.join(" ")}`;

  // Protein must be supported by ingredients or the dish name, not by prose
  // alone (a description can mention a dish it is not).
  // Name wins: 「煎雞胸」must stay chicken even if an ingredient says 海鮮菇.
  // Mushroom / plant-based words never carry protein on their own.
  const proteinName = neutraliseProteinNoise(name);
  // Structural, not lexical: an ingredient only counts as protein when its own
  // category says so (肉類 / 海鮮 / 蛋奶). Condiments, mushrooms, dried goods and
  // plant-based items are excluded by data, not by a word list.
  const proteinCategoryText = ingredientRows(input.ingredients)
    .filter((row) => PROTEIN_INGREDIENT_CATEGORIES.has(row.category))
    .map((row) => row.name)
    .join(" ");
  const fromName = uniq(PROTEIN_PATTERNS.map(([key]) => key).filter((key) => hasProtein(proteinName, key)));
  const proteinSource = proteinCategoryText || neutraliseProteinNoise(ingredientText);
  const fromIngredients = uniq(PROTEIN_PATTERNS.map(([key]) => key).filter((key) => hasProtein(proteinSource, key)));
  const protein = fromName.length > 0 ? fromName : fromIngredients;
  // Method comes from the dish name first (蔥油雞 is poached, not steamed just
  // because a step mentions 蒸); body text is only the fallback.
  const fromNameMethod = uniq(METHOD_PATTERNS.filter(([, pattern]) => pattern.test(name)).map(([key]) => key));
  const method = fromNameMethod.length > 0
    ? fromNameMethod
    : uniq(METHOD_PATTERNS.filter(([, pattern]) => pattern.test(body)).map(([key]) => key));
  const scenarios = deriveScenarios({
    name,
    description: input.description,
    cookTime: input.cookTime,
    difficulty: input.difficulty,
    dishType: input.dishType,
    recipeCategory: input.recipeCategory,
    tags,
    ingredients: input.ingredients,
    steps: input.steps,
  });
  const diet: string[] = [];
  if (scenarios.includes("vegetarian")) diet.push("vegetarian");
  const semanticTags = uniq([
    ...scenarios.map((scenario) => scenario === "highProtein" ? "high-protein" : scenario),
    ...TAG_ALIASES.filter(([, pattern]) => pattern.test(body)).map(([key]) => key),
  ]);
  const dishType = detectDishType(input, body);
  if (dishType) semanticTags.push(dishType);
  const main = uniq(ingredientNames(input.ingredients).slice(0, 5));

  return { protein, method, diet, tags: uniq(semanticTags), main };
}

/** Serialized `derived_tags` column value, e.g. ["protein:egg","method:steam"]. */
export function deriveRecipeTags(input: DerivedTagInput): string[] {
  const facets = deriveRecipeFacets(input);
  return uniq([
    ...facets.protein.map((value) => `protein:${value}`),
    ...facets.method.map((value) => `method:${value}`),
    ...facets.diet.map((value) => `diet:${value}`),
    ...facets.tags.map((value) => `tag:${value}`),
    ...facets.main.map((value) => `main:${value}`),
  ]);
}

export function computeDerivedTags(input: DerivedTagInput): string {
  return JSON.stringify(deriveRecipeTags(input));
}
