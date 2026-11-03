/**
 * Scenario (hotkey) derivation — deterministic, LLM-free.
 *
 * "Scenarios" mirror the AI Chef hotkey buttons (quick / healthy / ricecooker /
 * kids / guest). They are NOT stored as a single-choice category: a recipe can
 * belong to several scenarios, so this returns a multi-label list derived purely
 * from existing attributes (cookTime / difficulty / dishType / recipeCategory /
 * tags / ingredients / steps / name).
 *
 * Used on write (import / custom / official create) to populate
 * `scenarioTags`, and by the backfill script. Hotkey queries then match on this
 * stable label instead of brittle free-text search, so every recipe (official
 * OR user-imported) is reliably reachable.
 */

export type Scenario = "quick" | "healthy" | "ricecooker" | "kids" | "guest" | "highProtein" | "vegetarian";

export const ALL_SCENARIOS: Scenario[] = [
  "quick",
  "healthy",
  "ricecooker",
  "kids",
  "guest",
  "highProtein",
  "vegetarian",
];

export interface ScenarioInput {
  name?: string | null;
  description?: string | null;
  cookTime?: number | null;
  difficulty?: string | null;
  dishType?: string | null;
  recipeCategory?: string | null;
  tags?: string[] | string | null;
  ingredients?: Array<{ name?: string | null }> | string | null;
  steps?: Array<string | { instruction?: string | null }> | string | null;
}

function toText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    return v
      .map((x) =>
        typeof x === "string"
          ? x
          : x && typeof x === "object"
            ? String((x as any).name ?? (x as any).instruction ?? "")
            : String(x ?? "")
      )
      .join(" ");
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function toTags(v: ScenarioInput["tags"]): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((t) => String(t));
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p.map((t) => String(t)) : [];
  } catch {
    return String(v).split(/[,\s、]+/).filter(Boolean);
  }
}

const isQuick = (cookTime?: number | null, slowText = ""): boolean =>
  typeof cookTime === "number"
  && Number.isFinite(cookTime)
  && cookTime > 0
  && cookTime <= 30
  && !SLOW_COOK_RE.test(slowText);

const HEALTHY_TAGS = ["清淡", "少油", "低脂", "健康", "輕食", "轻食", "少鹽", "少盐", "蒸", "水煮", "清蒸", "白灼"];
// Equipment only. Braise words (燜/炆/慢燉) are a COOKING METHOD, not a one-pot
// dish; merging them is why 「慢燉牛肉寬粉」answered 「一鍋到底」.
const RICECOOKER_RE = /電飯煲|电饭煲|電子鍋|电子锅|壓力鍋|压力锅|一鍋|一锅|一鑊|一镬|煲仔/;
const SLOW_COOK_RE = /炆|燜|焖|燉|炖|煲|慢煮|醃過夜|腌过夜/;
const KIDS_TAGS = ["小朋友", "幼兒", "幼儿", "兒童", "儿童", "不辣", "親子", "亲子", "BB", "bb"];
const KIDS_NAME_RE = /兒童|儿童|親子|亲子/;
const GUEST_TAGS = ["宴客", "大菜", "喜慶", "喜庆", "節慶", "节庆", "招待", "過節", "过节", "party", "Party"];
const GUEST_RE = /宴客|大菜|喜慶|喜庆|節慶|节庆|招待|過節|过节/;
const SPICY_RE = /辣|麻辣|花椒|芥末|wasabi|chilli|chili/;
const FRIED_RE = /炸|油炸|deep.?fry|fried/;

function ingredientText(ingredients: ScenarioInput["ingredients"]): string {
  if (!ingredients) return "";
  if (typeof ingredients === "string") {
    try {
      const parsed = JSON.parse(ingredients);
      if (Array.isArray(parsed)) return ingredientText(parsed as ScenarioInput["ingredients"]);
    } catch {
      return ingredients;
    }
    return ingredients;
  }
  if (!Array.isArray(ingredients)) return "";
  return ingredients
    .map((ingredient) => {
      if (typeof ingredient === "string") return ingredient;
      if (!ingredient || typeof ingredient !== "object") return "";
      const row = ingredient as { name?: unknown; nameEn?: unknown };
      return [row.name, row.nameEn].filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .join(" ");
}

const QUANTITY_ONLY_NAME_RE =
  /^[\d\s\.\/半一二三四五六七八九十百]+(克|g|kg|毫升|ml|l|茶匙|湯匙|匙|瓣|個|隻|條|片|杯|碗|適量|少許)/i;

export function isValidIngredientName(name: string | null | undefined): boolean {
  const text = String(name ?? "").trim();
  if (!text) return false;
  return !QUANTITY_ONLY_NAME_RE.test(text);
}

function ingredientNames(ingredients: ScenarioInput["ingredients"]): string[] {
  if (!ingredients) return [];
  if (typeof ingredients === "string") {
    const text = ingredients.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return ingredientNames(parsed as ScenarioInput["ingredients"]);
      return [String(parsed ?? "")];
    } catch {
      return text.split(/[,\n、;；]+/).map((part) => part.trim()).filter(Boolean);
    }
  }
  if (!Array.isArray(ingredients)) return [];
  return ingredients.map((ingredient) => {
    if (typeof ingredient === "string") return ingredient;
    if (!ingredient || typeof ingredient !== "object") return "";
    return String((ingredient as { name?: unknown }).name ?? "");
  });
}

function hasUsableIngredientNames(ingredients: ScenarioInput["ingredients"]): boolean {
  const names = ingredientNames(ingredients);
  return names.length >= 2 && names.every(isValidIngredientName);
}

function proteinGroupCount(ingredients: ScenarioInput["ingredients"]): number {
  const text = String(ingredientText(ingredients)).normalize("NFKC").toLowerCase();
  if (!text.trim()) return 0;
  const groups = new Set<string>();

  const redMeat = /牛肉|牛扒|牛排|牛仔骨|牛腩|牛腱|牛柳|牛肋|牛丸|牛舌|牛雜|牛杂|豬肉|猪肉|豬扒|猪扒|豬排|猪排|豬手|猪手|豬腳|猪脚|叉燒|叉烧|燒肉|烧肉|煙肉|烟肉|培根|火腿|午餐肉|肉丸|肉腸|肉肠|羊肉|羊扒|羊排|羊腿|羊架|羊(?!奶)/;
  if (redMeat.test(text)) groups.add("redMeat");

  const poultryText = text.replace(/雞蛋|鸡蛋|鴨蛋|鸭蛋|鵪鶉蛋|鹌鹑蛋|皮蛋|鹹蛋|咸蛋|雞湯|鸡汤|雞粉|鸡粉|雞汁|鸡汁|雞精|鸡精/g, " ");
  if (/雞|鸡|鴨|鸭|鵝|鹅|火雞|火鸡/.test(poultryText)) groups.add("poultry");

  const fishText = text.replace(/魚露|鱼露/g, " ");
  if (/魚|鱼|三文魚|三文鱼|吞拿魚|吞拿鱼|鯖魚|鲭鱼|鱈魚|鳕鱼|鮭魚|鲑鱼|鯛魚|鲷鱼|鱸魚|鲈鱼|沙丁魚|沙丁鱼|比目魚|比目鱼/.test(fishText)) groups.add("fish");

  if (/蝦|虾|蟹|帶子|带子|帆立貝|帆立贝|蠔|蚝|蜆|蚬|魷魚|鱿鱼|章魚|章鱼|八爪魚|八爪鱼|龍蝦|龙虾|青口|扇貝|扇贝|貽貝|贻贝|鮑魚|鲍鱼|海參|海参/.test(text)) groups.add("seafood");

  const eggText = text.replace(/蛋白粉|乳清蛋白|蛋白質|蛋白质|蛋白霜|蛋糕|蛋撻|蛋挞|蛋卷|蛋捲/g, " ");
  if (/雞蛋|鸡蛋|鴨蛋|鸭蛋|鵪鶉蛋|鹌鹑蛋|皮蛋|鹹蛋|咸蛋|蛋/.test(eggText)) groups.add("egg");

  if (/豆腐|豆乾|豆干|腐竹|毛豆|黃豆|黄豆|豆類|豆类|豆漿|豆浆|豆奶|豆卜|豆皮|素雞|素鸡|天貝|天贝|紅豆|红豆|綠豆|绿豆|鷹嘴豆|鹰嘴豆|黑豆|黃豆芽|黄豆芽|tofu|soy|edamame|tempeh/.test(text)) groups.add("soy");

  if (/芝士|起司|乳酪|牛奶|希臘優格|希腊优格|優格|优格|酸奶|yogurt|yoghurt|cheese|cottage cheese|茅屋芝士|茅屋起司|奶油芝士|cream cheese/.test(text)) groups.add("dairy");

  if (/蛋白粉|乳清蛋白|whey|protein powder|蛋白飲|蛋白饮品|protein shake/.test(text)) groups.add("proteinPowder");

  return groups.size;
}

function isVegetarian(ingredients: ScenarioInput["ingredients"]): boolean {
  const text = String(ingredientText(ingredients)).normalize("NFKC").toLowerCase();
  if (!text.trim()) return false;

  const cleaned = text.replace(
    /豬仔包|豬腸粉|豬籠草|猪仔包|猪肠粉|猪笼草|雞髀菇|鸡髀菇|雞腿菇|鸡腿菇|牛油果|牛肝菌|羊肚菌|肉桂|肉蓯蓉|肉苁蓉|腸粉|肠粉|貝果|贝果|魚腥草|鱼腥草|蟹味菇|蠔菇|蚝菇|果肉|oyster mushroom|chicken of the woods|chicken eggs?|duck eggs?|quail eggs?|meatless|plant-based meat|vegan meat/g,
    " ",
  );

  const nonVegetarian =
    /豬|猪|牛(?!奶|油|肝菌|至|角|蒡)|羊(?!奶|肚菌)|雞(?!蛋|湯|汤|粉|精|汁)|鸡(?!蛋|汤|粉|精|汁)|鴨(?!蛋)|鸭(?!蛋)|鵝(?!蛋)|鹅(?!蛋)|火雞(?!蛋)|火鸡(?!蛋)|肉(?!桂|豆蔻|蓯蓉|苁蓉)|排骨|腩|扒|腸|肠|火腿|煙肉|烟肉|臘|腊|海鮮|海鲜|魚|鱼|蝦|虾|蟹|貝(?!果)|贝(?!果)|蜆|蚬|帶子|带子|蠔|蚝|魷魚|鱿鱼|墨魚|墨鱼|八爪魚|八爪鱼|魚蛋|鱼蛋|魚片|鱼片|魚柳|鱼柳|魚塊|鱼块|魚條|鱼条|龍脷|龙脷|斑塊|斑块|石斑|倉魚|仓鱼|黃花魚|黄花鱼|鯪魚|鲮鱼|鰂魚|鲗鱼|鯇魚|鲩鱼|桂花魚|桂花鱼|牙帶|牙带|馬友|马友|秋刀魚|秋刀鱼|沙甸|紅衫魚|红衫鱼|白身魚|白身鱼|魚粉|鱼粉|柴魚|柴鱼|鰹魚|鲣鱼|anchovy|蝦米|虾米|瑤柱|瑶柱|蠔豉|蚝豉|海參|海参|鮑魚|鲍鱼|龍蝦|龙虾|青口|扇貝|扇贝|貽貝|贻贝|魚露|鱼露|蠔油|蚝油|雞湯|鸡汤|豬油|猪油|雞粉|鸡粉|xo醬|xo酱|worcestershire|喼汁|明膠|明胶|gelatin|gelatine|rennet|動物性|动物性|魚膠|鱼胶|吉利丁|dashi|bonito|fish\s*sauce|oyster\s*sauce|chicken\s*(stock|broth|powder)|lard|shrimp\s*paste|dried\s*shrimp|xo\s*sauce|pork|beef|lamb|mutton|chicken|duck|goose|turkey|bacon|ham|sausage|meat|steak|ribs|fish|sole|halibut|tilapia|bass|trout|shrimp|prawn|crab|shellfish|oyster|clam|squid|octopus|cuttlefish|tuna|salmon|mackerel|cod|sardine|scallop/i;

  return !nonVegetarian.test(cleaned);
}

/**
 * Derive the multi-label scenario list for a recipe.
 * Deterministic — safe to run on every write and to backfill.
 */
export function deriveScenarios(input: ScenarioInput): Scenario[] {
  const name = String(input.name ?? "");
  const dishType = String(input.dishType ?? "");
  const tags = toTags(input.tags);
  const tagsText = tags.join(" ");
  const stepsText = toText(input.steps);
  const bodyText = `${name} ${String(input.description ?? "")} ${stepsText} ${toText(input.ingredients)} ${tagsText}`;
  const out = new Set<Scenario>();

  if (isQuick(input.cookTime, `${name} ${stepsText}`)) out.add("quick");

  // healthy: explicit tags, OR a light cooking method, OR a plain steamed veg dish
  if (HEALTHY_TAGS.some((t) => tagsText.includes(t))) out.add("healthy");
  if (dishType === "vegetable" && !FRIED_RE.test(bodyText)) out.add("healthy");
  if (dishType === "seafood" && /蒸|灼|白灼|清蒸|水煮/.test(bodyText)) out.add("healthy");

  // ricecooker / one-pot: tags, name, steps, or a soup
  if (RICECOOKER_RE.test(bodyText)) out.add("ricecooker");

  // kids: explicit tags, kid-named dishes, or non-spicy dessert/drink.
  // Difficulty alone must never imply a kids meal.
  if (KIDS_TAGS.some((t) => tagsText.includes(t))) out.add("kids");
  if (KIDS_NAME_RE.test(name)) out.add("kids");
  // A non-spicy dessert is NOT automatically a kids meal: that label used to make
  // every sugary dish answer a 小朋友 request. Kids must come from tags or a
  // kid-named dish, never from "it happens to be sweet".

  // guest: explicit tags, or festive name
  if (GUEST_TAGS.some((t) => tagsText.includes(t))) out.add("guest");
  if (GUEST_RE.test(name)) out.add("guest");

  const usableIngredientNames = hasUsableIngredientNames(input.ingredients);

  // highProtein: at least two distinct protein groups; ingredient names only.
  if (usableIngredientNames && proteinGroupCount(input.ingredients) >= 2) out.add("highProtein");

  // vegetarian: exclusion rule; eggs/dairy/cheese/butter are allowed (lacto-ovo).
  if (usableIngredientNames && isVegetarian(input.ingredients)) out.add("vegetarian");

  return ALL_SCENARIOS.filter((s) => out.has(s));
}

/** JSON string for storing in `scenario_tags` (empty array when none). */
export function computeScenarioTags(input: ScenarioInput): string {
  return JSON.stringify(deriveScenarios(input));
}

/** True if the recipe matches the given scenario (used by hotkey queries). */
export function matchesScenario(input: ScenarioInput, scenario: Scenario): boolean {
  return deriveScenarios(input).includes(scenario);
}

/** Serialize user-declared scenarios into `scenario_tags_user`. Empty array
 * stays `"[]"`, which the query layer treats as "fall back to derived". */
export function serializeUserScenarioTags(scenarios?: string[] | null): string | undefined {
  if (scenarios === undefined) return undefined;
  const unique = [...new Set((scenarios ?? []).map(String))].filter((scenario): scenario is Scenario =>
    (ALL_SCENARIOS as string[]).includes(scenario),
  );
  return JSON.stringify(unique);
}
