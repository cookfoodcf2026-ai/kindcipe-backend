/**
 * Add a curated list of missing ingredients (HK soup herbs + market items +
 * user-reported gaps) to common_ingredients, translating zh → en/fil/id via LLM.
 *
 * Usage:
 *   npx tsx scripts/add-curated-ingredients.ts            # dry-run
 *   npx tsx scripts/add-curated-ingredients.ts --commit
 */
import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
import { invokeLLM } from "../server/_core/llm";
import { commonIngredients } from "../drizzle/schema";

const API_KEY = process.env.DASHSCOPE_API_KEY ?? "";
const BASE_URL = process.env.DASHSCOPE_BASE_URL ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const MODEL = "qwen3.7-flash";
const COMMIT = process.argv.includes("--commit");
const BATCH = 20;

// [zh, categoryKey]
const CURATED: Array<[string, string]> = [
  // user-reported
  ["中蝦", "seafood"], ["韓國大醬", "seasoning"], ["大醬", "seasoning"], ["韓式大醬", "seasoning"],
  // Chinese soup herbs / dried goods
  ["茨實", "dryGoods"], ["圓肉", "dryGoods"], ["龍眼肉", "dryGoods"], ["羅漢果", "dryGoods"],
  ["花旗參", "dryGoods"], ["黨參", "dryGoods"], ["北芪", "dryGoods"], ["川芎", "dryGoods"],
  ["白朮", "dryGoods"], ["茯苓", "dryGoods"], ["沙參", "dryGoods"], ["玉竹", "dryGoods"],
  ["麥冬", "dryGoods"], ["霸王花", "dryGoods"], ["章魚", "seafood"],
  ["日月魚", "seafood"], ["蟲草花", "dryGoods"], ["猴頭菇", "dryGoods"], ["海底椰", "dryGoods"],
  ["生薏米", "dryGoods"], ["熟薏米", "dryGoods"], ["茯神", "dryGoods"], ["酸棗仁", "dryGoods"],
  ["柏子仁", "dryGoods"], ["菊花", "dryGoods"], ["桑寄生", "dryGoods"], ["蓮鬚", "dryGoods"],
  ["燈心花", "dryGoods"], ["甘草", "dryGoods"], ["桂枝", "dryGoods"], ["生薑", "vegetables"],
  ["黑棗", "dryGoods"], ["南棗", "dryGoods"], ["白扁豆", "dryGoods"], ["魚唇", "dryGoods"],
  ["豬𦟌", "meat"], ["大地魚", "dryGoods"], ["冬菜", "dryGoods"], ["青紅蘿蔔", "vegetables"],
  // market / shopping blind spots
  ["土豆", "vegetables"], ["味噌", "seasoning"], ["木魚花", "dryGoods"], ["髮菜", "dryGoods"],
  ["金蠔", "seafood"], ["蒲燒鰻魚", "seafood"], ["肥牛片", "meat"], ["豬五花薄片", "meat"],
  ["牛五花薄片", "meat"], ["小春雞", "meat"], ["手打魚丸", "snacks"], ["咖喱膽", "seasoning"],
  ["新鮮鱸魚", "seafood"], ["魚板", "snacks"], ["青豆", "vegetables"], ["全雞", "meat"],
  ["小排骨", "meat"], ["百里香", "seasoning"], ["迷迭香", "seasoning"], ["雞髀肉", "meat"],
  ["鮮蝦仁", "seafood"], ["雞湯", "seasoning"], ["高湯", "seasoning"], ["木魚", "dryGoods"],
  ["叉燒醬", "seasoning"], ["海鮮醬", "seasoning"], ["柱候醬", "seasoning"], ["叉燒", "meat"],
];

async function translate(names: string[]): Promise<Record<string, { en: string; fil: string; id: string }>> {
  const prompt = `You are a Hong Kong grocery/ingredient translator.
For each Chinese ingredient return its common English, Filipino (Tagalog) and Indonesian market name.
If there is no common Filipino/Indonesian name, repeat the English name.
Return ONLY a JSON array: [{"zh":"中蝦","en":"Medium shrimp","fil":"Katamtamang hipon","id":"Udang sedang"}, ...]
Ingredients:
${names.map((n) => `- ${n}`).join("\n")}`;
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: prompt }], max_tokens: 3000, temperature: 0.2 }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || "";
  const m = content.match(/\[[\s\S]*\]/);
  if (!m) throw new Error("no array");
  const arr = JSON.parse(m[0]);
  const out: Record<string, { en: string; fil: string; id: string }> = {};
  for (const r of arr) if (r.zh && r.en) out[r.zh] = { en: String(r.en), fil: String(r.fil || r.en), id: String(r.id || r.en) };
  return out;
}

async function main() {
  if (!API_KEY) throw new Error("DASHSCOPE_API_KEY not set");
  const db = await getDb();

  const ex: any = await db.execute(sql`select name_zh, name_yue from common_ingredients`);
  const have = new Set<string>();
  for (const r of (ex.rows ?? ex)) for (const v of [r.name_zh, r.name_yue]) if (v) have.add(String(v).trim());

  const todo = CURATED.filter(([zh]) => !have.has(zh));
  console.log(`curated: ${CURATED.length} | new: ${todo.length}`);
  todo.forEach(([zh, c]) => console.log(`  ${zh} [${c}]`));

  if (!COMMIT) {
    console.log("\nDRY-RUN. Re-run with --commit to translate + insert.");
    return;
  }

  const map: Record<string, { en: string; fil: string; id: string }> = {};
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH).map(([zh]) => zh);
    try {
      Object.assign(map, await translate(batch));
      console.log(`  batch ${i / BATCH + 1} done`);
    } catch (e) {
      console.warn(`  batch ${i / BATCH + 1} FAILED: ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 800));
  }

  const rows = todo
    .filter(([zh]) => map[zh])
    .map(([zh, cat]) => ({
      categoryKey: cat,
      defaultUnitKey: null,
      nameYue: zh,
      nameZh: zh,
      nameEn: map[zh].en,
      nameFil: map[zh].fil,
      nameId: map[zh].id,
      isActive: true,
      sortOrder: 300,
    }));
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const res = await db.insert(commonIngredients).values(rows.slice(i, i + 100)).returning({ id: commonIngredients.id });
    inserted += res.length;
  }
  console.log(`\nDONE. inserted ${inserted}.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
