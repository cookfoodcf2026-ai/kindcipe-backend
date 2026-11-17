/**
 * Single source of truth for "is this row vegetarian?".
 *
 * Both the retrieval path (`isVegetarianRow` in AI Chef) and the write path
 * (`deriveScenarios` in scenario.ts) must agree, otherwise a row can carry the
 * `vegetarian` tag but be rejected by retrieval (or worse, the reverse).
 *
 * hardIsMeat is deliberately conservative and word-list based. The extra
 * scenario terms preserve the older write-path exclusions (gelatin, offal cuts,
 * English fish names…) that hardIsMeat does not cover; they only make the
 * predicate stricter, so the invariant `tag ⇒ retrieval accepts` still holds.
 */

const HARD_MEAT_RE = /豬|牛|羊|雞|鴨|鵝|魚|蝦|蟹|蜆|蠔|花甲|蛤|蛤蜊|蛤蠣|蚌|象拔蚌|青口|響螺|花螺|海螺|田螺|石螺|螺肉|螺片|螺螄|沙白|蟶|蛏|帶子|瑤柱|火腿|煙肉|臘腸|排骨|肉|chicken|beef|pork|lamb|mutton|duck|goose|turkey|bacon|ham|sausage|meat|steak|fish|shrimp|prawn|crab|shellfish|oyster|clam|squid|octopus|tuna|salmon|mackerel|cod|sardine|seafood/i;

const VEGETARIAN_SAFE_WORDS_RE = /豬仔包|豬腸粉|豬籠草|猪仔包|猪肠粉|猪笼草|肉桂|肉豆蔻|肉荳蔻|肉蓯蓉|肉苁蓉|果肉|希臘|希腊|牛油果|牛蒡|牛肝菌|牛肝蕈|牛至|牛奶|牛油|奶油|牛角包|魚香|魚腥草|海鮮醬|海鲜酱|蒸魚豉油|蒸鱼豉油|螺絲粉|羊肚菌|羊栖菜|雞腿菇|雞髀菇|雞脾菇|雞樅菌|雞油菌|蟹味菇|蠔菇|蚝菇|蝦夷蔥|素鮑魚|齋鮑魚|雞蛋|皮蛋|鹹蛋|鹹鴨蛋|鴨蛋|鵪鶉蛋|蛋黃|蛋白|椰漿|椰奶|chicken of the woods|oyster mushroom|chicken eggs?|duck eggs?|quail eggs?|meatless|plant-based meat|vegan meat/gi;

// Kept from the previous scenario.ts predicate. Stripped before the extra scan
// so plant names that merely contain a meat character stay vegetarian.
const EXTRA_SAFE_WORDS_RE = /豬仔包|豬腸粉|豬籠草|猪仔包|猪肠粉|猪笼草|雞髀菇|鸡髀菇|雞腿菇|鸡腿菇|牛油果|牛肝菌|羊肚菌|肉桂|肉蓯蓉|肉苁蓉|腸粉|肠粉|貝果|贝果|海鮮醬|海鲜酱|蒸魚豉油|蒸鱼豉油|螺絲粉|魚腥草|鱼腥草|蟹味菇|蠔菇|蚝菇|果肉|oyster mushroom|chicken of the woods|chicken eggs?|duck eggs?|quail eggs?|meatless|plant-based meat|vegan meat/gi;

// Terms the older write-path predicate rejected but hardIsMeat does not cover.
const EXTRA_MEAT_RE =
  /豬|猪|牛(?!奶|油|肝菌|至|角|蒡)|羊(?!奶|肚菌)|雞(?!蛋|湯|汤|粉|精|汁)|鸡(?!蛋|汤|粉|精|汁)|鴨(?!蛋)|鸭(?!蛋)|鵝(?!蛋)|鹅(?!蛋)|火雞(?!蛋)|火鸡(?!蛋)|肉(?!桂|豆蔻|蓯蓉|苁蓉)|排骨|腩|扒|腸|肠|火腿|煙肉|烟肉|臘|腊|海鮮|海鲜|魚|鱼|蝦|虾|蟹|貝(?!果)|贝(?!果)|蜆|蚬|花甲|蛤|蛤蜊|蛤蠣|蚌|象拔蚌|響螺|花螺|海螺|田螺|石螺|螺肉|螺片|螺螄|沙白|蟶|蛏|帶子|带子|蠔|蚝|魷魚|鱿鱼|墨魚|墨鱼|八爪魚|八爪鱼|魚蛋|鱼蛋|魚片|鱼片|魚柳|鱼柳|魚塊|鱼块|魚條|鱼条|龍脷|龙脷|斑塊|斑块|石斑|倉魚|仓鱼|黃花魚|黄花鱼|鯪魚|鲮鱼|鰂魚|鲗鱼|鯇魚|鲩鱼|桂花魚|桂花鱼|牙帶|牙带|馬友|马友|秋刀魚|秋刀鱼|沙甸|紅衫魚|红衫鱼|白身魚|白身鱼|魚粉|鱼粉|柴魚|柴鱼|鰹魚|鲣鱼|anchovy|蝦米|虾米|瑤柱|瑶柱|蠔豉|蚝豉|海參|海参|鮑魚|鲍鱼|龍蝦|龙虾|青口|扇貝|扇贝|貽貝|贻贝|魚露|鱼露|蠔油|蚝油|雞湯|鸡汤|豬油|猪油|雞粉|鸡粉|xo醬|xo酱|worcestershire|喼汁|明膠|明胶|gelatin|gelatine|rennet|動物性|动物性|魚膠|鱼胶|吉利丁|dashi|bonito|fish\s*sauce|oyster\s*sauce|chicken\s*(stock|broth|powder)|lard|shrimp\s*paste|dried\s*shrimp|xo\s*sauce|pork|beef|lamb|mutton|chicken|duck|goose|turkey|bacon|ham|sausage|meat|steak|ribs|fish|sole|halibut|tilapia|bass|trout|shrimp|prawn|crab|shellfish|oyster|clam|squid|octopus|cuttlefish|tuna|salmon|mackerel|cod|sardine|scallop/i;

function trimmedName(raw: unknown): string {
  return String(raw ?? "").trim();
}

function stripSafeWords(raw: string): string {
  return raw.replace(VEGETARIAN_SAFE_WORDS_RE, " ").replace(EXTRA_SAFE_WORDS_RE, " ");
}

/** Exported for the recompute script's trigger reporting. */
export function isNonVegetarianName(raw: unknown): boolean {
  const name = trimmedName(raw);
  if (!name) return false;
  // 「素／齋」開頭一律當植物性（素鮑魚／齋鮑魚／素雞／素肉…）。
  if (/^[素齋]/.test(name)) return false;
  if (/素(蠔油|肉|雞|魚|蝦|排骨|火腿)/.test(name)) return false;
  if (hardIsMeat(name)) return true;
  return EXTRA_MEAT_RE.test(stripSafeWords(name).normalize("NFKC").toLowerCase());
}

export function hardIsMeat(raw: unknown): boolean {
  const name = trimmedName(raw);
  if (!name) return false;
  if (/^[素齋]/.test(name)) return false;
  if (/素(蠔油|肉|雞|魚|蝦|排骨|火腿)/.test(name)) return false;
  // Strip vegetarian-safe words that contain a meat character before testing.
  // 菇菌／植物名誤殺：羊肚菌、雞腿菇、魚腥草、蟹味菇、蠔菇。
  return HARD_MEAT_RE.test(name.replace(VEGETARIAN_SAFE_WORDS_RE, ""));
}

export function rowIngredientNames(row: Record<string, unknown>): string[] {
  const ingredients = Array.isArray(row.ingredients) ? row.ingredients : [];
  return ingredients.map((ingredient: any) =>
    typeof ingredient === "string" ? ingredient : String(ingredient?.name ?? ""),
  );
}

/**
 * A row is vegetarian only when BOTH its name and its ingredient names carry no
 * meat/seafood word. Tag-based vegetarian lies in production (tag says
 * vegetarian but ingredients include 雞湯／魚露／蠔油). hardIsMeat already
 * keeps vegetarian-safe words (素蠔油／素雞／雞蛋／牛奶／牛油果) out of the check.
 */
export function isVegetarianRow(row: Record<string, unknown>): boolean {
  if (isNonVegetarianName(row.name)) return false;
  return !rowIngredientNames(row).some(isNonVegetarianName);
}
