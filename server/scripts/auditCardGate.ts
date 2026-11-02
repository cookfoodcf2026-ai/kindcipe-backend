import postgres from "postgres";

type Ingredient = { name?: unknown; quantity?: unknown; unit?: unknown };
type Step = string | { instruction?: unknown };
type Row = {
  id: number;
  source: "official" | "custom";
  name: string;
  dish_type: string | null;
  recipe_category: string | null;
  ingredients: string | null;
  steps: string | null;
};

const url = process.env.DATABASE_URL ?? "postgres://mavisng@localhost:5432/kindcipe_restore_test";
const sql = postgres(url, { max: 1 });
await sql`set default_transaction_read_only = on`;
const custom = await sql<Row[]>`select id, 'custom'::text source, name, dish_type, recipe_category, ingredients, steps from custom_recipes where coalesce(is_draft, false) = false order by id`;
const official = await sql<Row[]>`select id, 'official'::text source, name, dish_type, recipe_category, ingredients, steps from official_recipes where is_active = true order by id`;
const rows = [...official, ...custom];

const parse = (value: string | null): unknown[] => {
  try { return JSON.parse(value || "[]"); } catch { return []; }
};
const clean = (value: string) => String(value ?? "").replace(/\s+/g, "").replace(/[，。、；：！？,.;:!?（）()「」『』\-—…]/g, "");
const names = (ingredients: unknown[]) => (ingredients as Ingredient[]).filter((ingredient) => String(ingredient?.name ?? "").trim()).length;
const stepsOf = (steps: unknown[]) => (steps as Step[])
  .map((step) => typeof step === "string" ? step : String(step?.instruction ?? ""))
  .map((step) => step.trim())
  .filter(Boolean);
const unitSet = new Set(["克", "g", "公斤", "kg", "毫升", "ml", "公升", "l", "湯匙", "大匙", "tbsp", "茶匙", "小匙", "tsp", "隻", "只", "條", "杯", "碗", "個", "颗", "顆", "片", "塊", "块", "粒", "束", "把", "斤", "兩", "两", "安士", "oz", "磅", "lb", "包", "罐", "盒"]);
const numeric = /^(?:\d+(?:\.\d+)?|[一二兩两三四五六七八九十百半]+)$/;
const timeHeat = /(?:\d+(?:\.\d+)?|[一二兩两三四五六七八九十百半]+)\s*(?:分鐘|分|秒|小時|小时|鐘|钟|hr|min|sec|hour)|(?:小火|中火|大火|中小火|中大火|文火|旺火|慢火)/i;
const soupDessert = (row: Row) => {
  const text = `${row.dish_type ?? ""} ${row.recipe_category ?? ""} ${row.name}`;
  return /(?:^|\s)(?:soup|dessert)(?:\s|$)/i.test(row.dish_type ?? "")
    || /湯|羹|糖水|甜品|甜點|甜点|蛋糕|布甸|布丁|雪糕|西米露|芝麻糊|紅豆沙|綠豆沙|楊枝甘露|芋圓/.test(text);
};

function evaluate(row: Row) {
  const ingredients = parse(row.ingredients) as Ingredient[];
  const steps = stepsOf(parse(row.steps));
  const ingredientCount = names(ingredients);
  const measuredA = ingredients.filter((i) => String(i?.name ?? "").trim() && String(i?.unit ?? "").trim()).length;
  const measuredB = ingredients.filter((i) => numeric.test(String(i?.quantity ?? "").trim()) && unitSet.has(String(i?.unit ?? "").trim().toLowerCase())).length;
  const timed = steps.filter((step) => timeHeat.test(step)).length;
  const short = steps.filter((step) => clean(step).length < 8).length;
  const reasonsA: string[] = [];
  if (steps.length < 3) reasonsA.push("steps<3");
  if (short > 0) reasonsA.push("step<8chars");
  if (timed < 2) reasonsA.push("timed<2");
  if (measuredA < 3) reasonsA.push("qty+unit<3");
  const reasonsB: string[] = [];
  if (steps.length < 3) reasonsB.push("steps<3");
  if (short > 0) reasonsB.push("step<8chars");
  if (timed < 2) reasonsB.push("timed<2");
  if (measuredB < 3) reasonsB.push("qty+unit<3");
  const currentLibrary = steps.length >= 1 && ingredientCount >= 2;
  const currentAi = steps.length >= (soupDessert(row) ? 4 : 5);
  return {
    row, ingredients, steps, ingredientCount, measuredA, measuredB, timed, short,
    currentLibrary, currentAi, a: reasonsA.length === 0, b: reasonsB.length === 0,
    reasonsA: [...new Set(reasonsA)], reasonsB: [...new Set(reasonsB)],
  };
}

const evaluated = rows.map(evaluate);
const summarize = (items: typeof evaluated) => {
  const total = items.length;
  const count = (fn: (item: (typeof items)[number]) => boolean) => items.filter(fn).length;
  const reasons = (key: "reasonsA" | "reasonsB") => {
    const out: Record<string, number> = {};
    for (const item of items) for (const reason of item[key]) out[reason] = (out[reason] ?? 0) + 1;
    return out;
  };
  return {
    total,
    currentLibrary: count((x) => x.currentLibrary),
    currentAi: count((x) => x.currentAi),
    candidateA: count((x) => x.a),
    candidateB: count((x) => x.b),
    reasonsA: reasons("reasonsA"),
    reasonsB: reasons("reasonsB"),
    aButNotAi: count((x) => x.a && !x.currentAi),
    bButNotAi: count((x) => x.b && !x.currentAi),
    aiButNotA: count((x) => x.currentAi && !x.a),
    aiButNotB: count((x) => x.currentAi && !x.b),
  };
};
const example = evaluated.filter((item) => !item.a && item.currentAi).slice(0, 5).map((item) => ({
  source: item.row.source, id: item.row.id, name: item.row.name,
  steps: item.steps.length, stepLengths: item.steps.map((step) => clean(step).length),
  reasonsA: item.reasonsA,
}));
const output = {
  database: url.replace(/\/\/[^@]+@/, "//***@"),
  official: summarize(evaluated.filter((x) => x.row.source === "official")),
  custom: summarize(evaluated.filter((x) => x.row.source === "custom")),
  combined: summarize(evaluated),
  examplesARejectedAiPassed: example,
};
console.log(JSON.stringify(output, null, 2));
await sql.end();
