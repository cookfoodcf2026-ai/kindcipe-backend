/**
 * Backfill high-frequency cooking ingredients that are missing from
 * common_ingredients, using the recipe corpus as the source of truth.
 *
 * For each missing ingredient name it asks the LLM for English / Filipino /
 * Indonesian names plus a category key, then inserts into common_ingredients.
 *
 * Usage:
 *   npx tsx scripts/backfill-recipe-ingredients.ts                # dry-run, top 200
 *   npx tsx scripts/backfill-recipe-ingredients.ts --commit       # insert
 *   npx tsx scripts/backfill-recipe-ingredients.ts --limit 300 --commit
 */
import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
import { commonIngredients } from "../drizzle/schema";

const API_KEY = process.env.DASHSCOPE_API_KEY ?? "";
const BASE_URL = process.env.DASHSCOPE_BASE_URL ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const MODEL = "qwen3.7-flash";
const BATCH = 25;
const CONCURRENCY = 4;

const COMMIT = process.argv.includes("--commit");
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? Number(process.argv[i + 1]) || 200 : 200;
})();

const STOP = new Set(["適量", "少許", "些許", "調味", "配料", "自選", "隨意", "optional"]);

function cleanName(raw: string): string {
  let s = (raw ?? "").trim();
  s = s.replace(/^調味料\s*[:：]\s*/, "");
  s = s.replace(/^材料\s*[:：]\s*/, "");
  s = s.replace(/^[（(].*?[）)]$/, "");
  return s.trim();
}

async function translateBatch(names: string[]): Promise<Record<string, { en: string; fil: string; id: string; cat: string }>> {
  const prompt = `You are a Hong Kong grocery/ingredient translator for a family cooking app.
For each Chinese ingredient name below return:
- "en": natural English name
- "fil": common Filipino/Tagalog market name (if there is no common Filipino name, repeat the English name)
- "id": common Indonesian market name (if there is no common Indonesian name, repeat the English name)
- "cat": exactly one of: vegetables, fruits, meat, seafood, dairy, seasoning, dryGoods, staple, beverage, snacks, household, other
Return ONLY a JSON array, no prose, no markdown: [{"zh":"蒜蓉","en":"Minced garlic","fil":"Tinadtad na bawang","id":"Bawang cincang","cat":"seasoning"}]
Ingredients:
${names.map((n) => `- ${n}`).join("\n")}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 120000);
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: prompt }], max_tokens: 4000, temperature: 0.2 }),
        signal: controller.signal,
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`LLM ${res.status}`);
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content ?? "";
      const m = content.match(/\[[\s\S]*\]/);
      if (!m) throw new Error("no array");
      const arr = JSON.parse(m[0]) as Array<{ zh: string; en: string; fil: string; id: string; cat: string }>;
      const out: Record<string, { en: string; fil: string; id: string; cat: string }> = {};
      for (const r of arr) {
        if (r.zh && r.en) out[r.zh] = { en: r.en, fil: r.fil || r.en, id: r.id || r.en, cat: r.cat || "other" };
      }
      return out;
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  return {};
}

async function main() {
  if (!API_KEY) throw new Error("DASHSCOPE_API_KEY not set");
  const db = await getDb();

  const q = sql`
    with all_ing as (
      select jsonb_array_elements(ingredients::jsonb)->>${"name"} as ing from official_recipes where ingredients is not null
      union all
      select jsonb_array_elements(ingredients::jsonb)->>${"name"} as ing from custom_recipes where ingredients is not null
    )
    select a.ing as name, count(*)::int as n
    from all_ing a
    left join common_ingredients ci on ci.name_zh = a.ing or ci.name_yue = a.ing
    where ci.id is null and a.ing is not null and a.ing <> ${""}
    group by a.ing order by n desc limit ${LIMIT}`;
  const raw: any = await db.execute(q);
  const rows: Array<{ name: string; n: number }> = raw.rows ?? raw;

  // existing dict names (for post-clean collision check)
  const ex: any = await db.execute(sql`select name_zh, name_yue from common_ingredients`);
  const have = new Set<string>();
  for (const r of (ex.rows ?? ex)) {
    for (const v of [r.name_zh, r.name_yue]) {
      const n = (v ?? "").replace(/\s+/g, "").trim();
      if (n) have.add(n);
    }
  }

  // clean + dedupe + drop stop-words + drop names already in dict after cleaning
  const seen = new Set<string>();
  const targets: Array<{ zh: string; n: number }> = [];
  for (const r of rows) {
    const zh = cleanName(r.name);
    const key = zh.replace(/\s+/g, "");
    if (!zh || STOP.has(zh) || seen.has(key) || have.has(key)) continue;
    seen.add(key);
    targets.push({ zh, n: r.n });
  }
  console.log(`candidates: ${rows.length} -> cleaned targets: ${targets.length}`);

  const batches: Array<Array<{ zh: string; n: number }>> = [];
  for (let i = 0; i < targets.length; i += BATCH) batches.push(targets.slice(i, i + BATCH));

  const results = new Map<string, { en: string; fil: string; id: string; cat: string }>();
  let cursor = 0;
  async function worker() {
    while (cursor < batches.length) {
      const idx = cursor++;
      const batch = batches[idx];
      try {
        const out = await translateBatch(batch.map((b) => b.zh));
        for (const k of Object.keys(out)) results.set(k, out[k]);
        console.log(`  batch ${idx + 1}/${batches.length} done`);
      } catch (e) {
        console.warn(`  batch ${idx + 1}/${batches.length} FAILED: ${(e as any)?.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const final = targets
    .filter((t) => results.has(t.zh))
    .map((t) => {
      const r = results.get(t.zh)!;
      return { categoryKey: r.cat, nameYue: t.zh, nameZh: t.zh, nameEn: r.en, nameFil: r.fil, nameId: r.id, freq: t.n };
    });
  console.log(`translated: ${final.length}`);
  for (const f of final.slice(0, 15)) console.log(`  ${f.nameZh} | ${f.nameEn} | ${f.nameFil} | ${f.nameId} [${f.categoryKey}] (${f.freq})`);

  if (!COMMIT) {
    console.log("\nDRY-RUN. Re-run with --commit to insert.");
    return;
  }

  let inserted = 0;
  for (let i = 0; i < final.length; i += 100) {
    const chunk = final.slice(i, i + 100).map((f) => ({
      categoryKey: f.categoryKey,
      defaultUnitKey: null,
      nameYue: f.nameYue,
      nameZh: f.nameZh,
      nameEn: f.nameEn,
      nameFil: f.nameFil,
      nameId: f.nameId,
      isActive: true,
      sortOrder: 200,
    }));
    const res = await db.insert(commonIngredients).values(chunk).returning({ id: commonIngredients.id });
    inserted += res.length;
    console.log(`  inserted batch ${i / 100 + 1}: ${res.length}`);
  }
  console.log(`\nDONE. inserted ${inserted}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
