/**
 * Translate recipe dish names (official + custom) to nameEn / nameFil / nameId.
 * Batch-translates via DashScope (qwen3.7-flash), concurrency pool, incremental save.
 * Idempotent: only processes recipes missing any bilingual name.
 *
 * Run:  npx tsx scripts/translate-recipe-names.ts   (from ../kindcipe-backend)
 */
import "dotenv/config";
import { getDb } from "../server/db";
import { eq } from "drizzle-orm";
import { officialRecipes, customRecipes } from "../drizzle/schema";

const API_KEY = process.env.DASHSCOPE_API_KEY ?? "";
const BASE_URL = process.env.DASHSCOPE_BASE_URL ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const MODEL = "qwen3.7-flash";
const BATCH = 30;
const CONCURRENCY = 5;

type Target = { table: "official" | "custom"; id: number; name: string };

async function translateBatch(names: string[]): Promise<Record<string, { en: string; fil: string; id: string }>> {
  const prompt = `You are a food-recipe translator for a HK family app.
Translate the following Chinese dish names to (1) English, (2) Filipino, (3) Indonesian.
Return ONLY a JSON array, no extra text: [{"name":"番茄炒蛋","en":"Tomato Scrambled Eggs","fil":"Itlog na may Kamatis","id":"Telur Dadar Tomat"}, ...]
Dish names:
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
      const arr = JSON.parse(m[0]);
      const out: Record<string, { en: string; fil: string; id: string }> = {};
      for (const r of arr) if (r.name && r.en && r.fil && r.id) out[r.name] = { en: r.en, fil: r.fil, id: r.id };
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
  if (!db) throw new Error("DB unavailable");

  const official = await db.select({ id: officialRecipes.id, name: officialRecipes.name, nameEn: officialRecipes.nameEn, nameFil: officialRecipes.nameFil, nameId: officialRecipes.nameId }).from(officialRecipes);
  const custom = await db.select({ id: customRecipes.id, name: customRecipes.name, nameEn: customRecipes.nameEn, nameFil: customRecipes.nameFil, nameId: customRecipes.nameId }).from(customRecipes);

  const targets: Target[] = [];
  for (const r of official) if (r.name && (!r.nameEn || !r.nameFil || !r.nameId)) targets.push({ table: "official", id: r.id, name: r.name });
  for (const r of custom) if (r.name && (!r.nameEn || !r.nameFil || !r.nameId)) targets.push({ table: "custom", id: r.id, name: r.name });
  console.log(`To translate: ${targets.length} recipes (batch ${BATCH}, concurrency ${CONCURRENCY})`);

  const batches: Target[][] = [];
  for (let i = 0; i < targets.length; i += BATCH) batches.push(targets.slice(i, i + BATCH));

  const results = new Map<string, { en: string; fil: string; id: string }>();
  let cursor = 0;
  async function worker() {
    while (cursor < batches.length) {
      const idx = cursor++;
      const batch = batches[idx];
      const names = batch.map((b) => b.name);
      try {
        const out = await translateBatch(names);
        for (const k of Object.keys(out)) results.set(k, out[k]);
        // incremental save
        let updated = 0;
        for (const b of batch) {
          const hit = results.get(b.name);
          if (!hit) continue;
          if (b.table === "official") await db.update(officialRecipes).set({ nameEn: hit.en, nameFil: hit.fil, nameId: hit.id }).where(eq(officialRecipes.id, b.id));
          else await db.update(customRecipes).set({ nameEn: hit.en, nameFil: hit.fil, nameId: hit.id }).where(eq(customRecipes.id, b.id));
          updated++;
        }
        console.log(`  batch ${idx + 1}/${batches.length} done (${updated} updated)`);
      } catch (e) {
        console.warn(`  batch ${idx + 1}/${batches.length} FAILED: ${(e as any)?.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
