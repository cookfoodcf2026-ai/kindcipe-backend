/**
 * Translate recipe steps (official + AI-tagged custom) to stepsEn / stepsFil / stepsId.
 * Batch-translates via DashScope (qwen3.7-flash), concurrency pool, incremental save.
 * Skips custom recipes that are NOT AI-generated (test-account imports, no "AI 生成" tag).
 *
 * Run:  npx tsx scripts/translate-recipe-steps.ts   (from ../kindcipe-backend)
 */
import "dotenv/config";
import { getDb } from "../server/db";
import { eq, isNull, like, or, inArray } from "drizzle-orm";
import { officialRecipes, customRecipes } from "../drizzle/schema";

const API_KEY = process.env.DASHSCOPE_API_KEY ?? "";
const BASE_URL = process.env.DASHSCOPE_BASE_URL ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const MODEL = "qwen3.7-flash";
const BATCH = 8;
const CONCURRENCY = 4;

type Target = { table: "official" | "custom"; id: number; name: string; steps: string[] };

function parseSteps(raw: string | null): string[] {
  if (!raw) return [];
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p.map(String) : []; } catch { return []; }
}

async function translateBatch(items: { name: string; steps: string[] }[]): Promise<Map<string, { en: string[]; fil: string[]; id: string[] }>> {
  const prompt = `You are a cooking-recipe translator for a HK family app. For each dish, translate its cooking STEPS (Chinese) to (1) English, (2) Filipino, (3) Indonesian.
Keep the SAME number of steps, same order, same quantities/times (e.g. "蒸12分鐘" → "Steam for 12 minutes"). Keep it clear and simple for a home helper.
Return ONLY a JSON array (one object per dish), no extra text:
[{"name":"番茄炒蛋","steps":["先落油...","炒蛋..."],"stepsEn":["...","..."],"stepsFil":["...","..."],"stepsId":["...","..."]}, ...]
Dishes:
${JSON.stringify(items.map((it) => ({ name: it.name, steps: it.steps })))}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 150000);
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: prompt }], max_tokens: 6000, temperature: 0.3 }),
        signal: controller.signal,
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`LLM ${res.status}`);
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content ?? "";
      const m = content.match(/\[[\s\S]*\]/);
      if (!m) throw new Error("no array");
      const arr = JSON.parse(m[0]);
      const out = new Map<string, { en: string[]; fil: string[]; id: string[] }>();
      for (const r of arr) if (r.name && r.stepsEn && r.stepsFil && r.stepsId) out.set(r.name, { en: r.stepsEn, fil: r.stepsFil, id: r.stepsId });
      return out;
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  return new Map();
}

async function main() {
  if (!API_KEY) throw new Error("DASHSCOPE_API_KEY not set");
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const official = await db.select({ id: officialRecipes.id, name: officialRecipes.name, steps: officialRecipes.steps, stepsEn: officialRecipes.stepsEn }).from(officialRecipes);
  const custom = await db.select({ id: customRecipes.id, name: customRecipes.name, steps: customRecipes.steps, stepsEn: customRecipes.stepsEn, tags: customRecipes.tags, sourceType: customRecipes.sourceType }).from(customRecipes).where(or(like(customRecipes.tags, "%AI 生成%"), inArray(customRecipes.sourceType, ["kol", "instagram", "youtube", "xiaohongshu", "threads", "tiktok"])));

  const targets: Target[] = [];
  for (const r of official) if (r.name && r.steps && !r.stepsEn) targets.push({ table: "official", id: r.id, name: r.name, steps: parseSteps(r.steps) });
  for (const r of custom) if (r.name && r.steps && !r.stepsEn) targets.push({ table: "custom", id: r.id, name: r.name, steps: parseSteps(r.steps) });

  // Filter out recipes with too few steps (skip noisy)
  const todo = targets.filter((t) => t.steps.length >= 1 && t.steps.length <= 15);
  console.log(`To translate: ${todo.length} recipes (official ${targets.filter(t=>t.table==='official').length} + AI-custom ${targets.filter(t=>t.table==='custom').length}), batch ${BATCH}, concurrency ${CONCURRENCY}`);

  const batches: Target[][] = [];
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));

  let cursor = 0;
  async function worker() {
    while (cursor < batches.length) {
      const idx = cursor++;
      const batch = batches[idx];
      try {
        const out = await translateBatch(batch.map((b) => ({ name: b.name, steps: b.steps })));
        let updated = 0;
        for (const b of batch) {
          const hit = out.get(b.name);
          if (!hit) continue;
          const val = { stepsEn: JSON.stringify(hit.en), stepsFil: JSON.stringify(hit.fil), stepsId: JSON.stringify(hit.id) };
          if (b.table === "official") await db.update(officialRecipes).set(val).where(eq(officialRecipes.id, b.id));
          else await db.update(customRecipes).set(val).where(eq(customRecipes.id, b.id));
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
