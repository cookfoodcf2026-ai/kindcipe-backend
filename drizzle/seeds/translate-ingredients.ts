/**
 * Translate common ingredient English names → Filipino + Indonesian (nameFil / nameId).
 * Reads drizzle/seeds/common-ingredients.json, batch-translates via DashScope (qwen3.7-flash),
 * and writes back a new JSON with nameFil/nameId filled.
 *
 * Run:  npx tsx drizzle/seeds/translate-ingredients.ts   (from ../kindcipe-backend)
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_KEY = process.env.DASHSCOPE_API_KEY ?? "";
const BASE_URL = process.env.DASHSCOPE_BASE_URL ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const MODEL = "qwen3.7-flash";
const BATCH = 20;
const CONCURRENCY = 5;

const jsonPath = path.join(__dirname, "common-ingredients.json");
const items = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

const todo = items.filter((it: any) => (!it.nameFil || !it.nameId) && it.nameEn);

async function translateBatch(englishNames: string[]) {
  const prompt = `You are a food-ingredient translator for a HK family app.
Translate the following English ingredient names to (1) Filipino and (2) Indonesian.
Return ONLY a JSON array, no extra text, exactly this shape:
[{"en":"Tomato","fil":"Kamatis","id":"Tomat"}, ...]
Ingredients:
${englishNames.map((n) => `- ${n}`).join("\n")}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 120000);
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 4000,
          temperature: 0.2,
        }),
        signal: controller.signal,
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content ?? "";
      const m = content.match(/\[[\s\S]*\]/);
      if (!m) throw new Error("No JSON array in LLM output: " + content.slice(0, 200));
      return JSON.parse(m[0]);
    } catch (e) {
      console.warn(`    attempt ${attempt} failed: ${(e as any)?.message}`);
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error("unreachable");
}

async function main() {
  if (!API_KEY) throw new Error("DASHSCOPE_API_KEY not set");
  console.log(`To translate: ${todo.length} items (batch ${BATCH}, concurrency ${CONCURRENCY})`);

  const results = new Map<string, { fil: string; id: string }>();
  const batches: string[][] = [];
  for (let i = 0; i < todo.length; i += BATCH) {
    batches.push(todo.slice(i, i + BATCH).map((x: any) => x.nameEn));
  }

  let done = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < batches.length) {
      const idx = cursor++;
      const names = batches[idx];
      try {
        const arr = await translateBatch(names);
        for (const r of arr) {
          if (r.en && r.fil && r.id) results.set(String(r.en).toLowerCase(), { fil: r.fil, id: r.id });
        }
        applyResults();
      } catch (e) {
        console.warn(`  batch ${idx + 1}/${batches.length} FAILED: ${(e as any)?.message}`);
      }
      done++;
      console.log(`  batch ${idx + 1}/${batches.length} done (${done}/${batches.length})`);
    }
  }

  function applyResults() {
    let filled = 0;
    for (const it of items) {
      const hit = results.get(String(it.nameEn).toLowerCase());
      if (hit && (!it.nameFil || !it.nameId)) {
        it.nameFil = hit.fil;
        it.nameId = hit.id;
        filled++;
      }
    }
    fs.writeFileSync(jsonPath, JSON.stringify(items, null, 2) + "\n");
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  applyResults();
  const remain = items.filter((it: any) => !it.nameFil || !it.nameId).length;
  console.log(`Done. Filled fil/id. Remaining null fil/id: ${remain}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
