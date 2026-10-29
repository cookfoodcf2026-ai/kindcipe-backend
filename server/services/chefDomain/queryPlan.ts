import type { DomainDishType, DomainScenario, QueryPlan } from "./types";

const DISH_HINTS: Array<[RegExp, DomainDishType]> = [
  [/湯|汤|\bsoup\b|\bbroth\b/i, "soup"],
  [/海鮮|海鲜|魚|鱼|蝦|虾|蟹|\bseafood\b|\bfish\b|\bshrimp\b/i, "seafood"],
  [/蔬菜|菜|素|蔬|\bveg(?:etable|gie)?\b/i, "vegetable"],
  [/肉|豬|猪|牛|雞|鸡|羊|鴨|鸭|\bmeat\b|\bbeef\b|\bpork\b|\bchicken\b/i, "meat"],
  [/飯|饭|麵|面|粉|河|米線|米线|\brice\b|\bnoodle\b|\bramen\b|\budon\b|\bpasta\b/i, "carb"],
  [/甜品|甜點|甜点|糖水|\bdessert\b|\bsweet\b/i, "dessert"],
  [/飲品|飲料|飲|凉茶|涼茶|\bdrink\b|\bjuice\b/i, "drink"],
  [/前菜|小食|小吃|沙律|沙拉|\bappetizer\b|\bstarter\b|\bsalad\b/i, "appetizer"],
];

const SCENARIO_HINTS: Array<[RegExp, DomainScenario]> = [
  [/快煮|快手|半個鐘|半小時|快啲|快d|quick|30\s*分鐘|30\s*分钟/i, "quick"],
  [/清淡|健康|低卡|healthy|light/i, "healthy"],
  [/電飯煲|电饭煲|rice\s*cooker/i, "ricecooker"],
  [/小朋友|細路|兒童|儿童|kids?|children/i, "kids"],
  [/客人|宴客|派對|派对|guest|party/i, "guest"],
];

function push<T>(arr: T[], value: T): void {
  if (!arr.includes(value)) arr.push(value);
}

export function buildDomainQueryPlan(raw: string): QueryPlan {
  const text = String(raw ?? "").trim();
  const contexts = text.replace(/(?:唔要|不要|唔好整|不要整|走|no|without)\s*[^\s，,。；;]{1,12}/gi, " ");
  const dishTypes: DomainDishType[] = [];
  const scenarios: DomainScenario[] = [];
  const tags: string[] = [];
  const avoid: string[] = [];

  for (const [pattern, type] of DISH_HINTS) if (pattern.test(contexts)) push(dishTypes, type);
  if (/湯麵|汤面|湯粉|汤粉/i.test(contexts)) {
    push(dishTypes, "soup");
    push(dishTypes, "carb");
  }
  for (const [pattern, scenario] of SCENARIO_HINTS) if (pattern.test(contexts)) push(scenarios, scenario);
  if (/素食|吃素|食素|vegan|vegetarian/i.test(text)) push(tags, "素食");
  if (/清淡|healthy|light/i.test(text)) push(tags, "清淡");

  for (const match of text.matchAll(/(?:唔要|不要|唔好整|不要整|走|no|without)\s*([^\s，,。；;]{1,12})/gi)) {
    const term = String(match[1] ?? "").trim();
    if (term && !/^(?:湯|汤|soup|辣|spicy)$/i.test(term)) push(avoid, term);
  }

  const clean = text
    .replace(/[，,、；;：:。！？!?]/g, " ")
    .replace(/^(?:我想食|我想|想食|想要|要|有咩|有乜|推薦|推介|搵|找|食|煮|整|啲|的|呢|呀|啊|啦|嗎|吗|\s)+/giu, "")
    .replace(/(?:食譜|食谱|推介|推薦|嗎|吗|\s)+$/giu, "")
    .trim();
  const minutes = text.match(/(\d{1,3})\s*分鐘|(\d{1,3})\s*分钟/);
  const cookTimeMax = minutes ? Number(minutes[1] ?? minutes[2]) : /半個鐘|半小時/.test(text) ? 30 : undefined;

  return {
    dishTypes,
    scenarios,
    tags,
    avoid,
    ...(cookTimeMax ? { cookTimeMax } : {}),
    text: clean.length <= 1 ? "" : clean.slice(0, 80),
  };
}
