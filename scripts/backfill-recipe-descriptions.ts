/**
 * Backfill descriptionEn / descriptionFil / descriptionId for existing
 * official_recipes + custom_recipes (batched, cheap — descriptions only).
 *
 * Usage:
 *   npx tsx scripts/backfill-recipe-descriptions.ts           # dry-run
 *   npx tsx scripts/backfill-recipe-descriptions.ts --commit
 */
import "dotenv/config";
import { getDb } from "../server/db";
import { eq } from "drizzle-orm";
import { invokeLLM, extractJSON } from "../server/_core/llm";
import { officialRecipes, customRecipes } from "../drizzle/schema";

const COMMIT = process.argv.includes("--commit");
const BATCH = 8;
const CONCURRENCY = 1;

type Item = { table: "official" | "custom"; id: number; description: string };

async function translateBatch(items: Item[]): Promise<Record<number, { en: string; fil: string; id: string }>> {
  const prompt = `Translate each Chinese recipe description into English, Filipino and Indonesian.
Return ONLY a JSON array, no prose: [{"i":0,"en":"...","fil":"...","id":"..."}, ...]
Keep each translation short and natural (it is a one-line blurb).
Items:
${items.map((it, i) => `${i}. ${it.description}`).join("\n")}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await invokeLLM({
        messages: [{ role: "user", content: prompt }],
        maxTokens: 3000,
        temperature: 0.2,
        timeoutMs: 45000,
        responseFormat: { type: "json_object" },
      });
      const raw = resp.choices?.[0]?.message?.content || "[]";
      let list: any;
      try {
        list = JSON.parse(raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
      } catch {
        const p: any = extractJSON(raw);
        list = Array.isArray(p) ? p : (p?.items ?? p?.data ?? []);
      }
      if (!Array.isArray(list)) list = [];
      const out: Record<number, { en: string; fil: string; id: string }> = {};
      for (const r of list) {
        const idx = Number(r.i ?? r.index ?? r.id);
        if (!Number.isNaN(idx) && items[idx] && r.en) {
          out[idx] = { en: String(r.en), fil: String(r.fil || r.en), id: String(r.id || r.en) };
        }
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
  const db = await getDb();

  const official = await db
    .select({ id: officialRecipes.id, description: officialRecipes.description, descriptionEn: officialRecipes.descriptionEn })
    .from(officialRecipes);
  const custom = await db
    .select({ id: customRecipes.id, description: customRecipes.description, descriptionEn: customRecipes.descriptionEn })
    .from(customRecipes);

  const items: Item[] = [];
  for (const r of official) {
    const d = (r.description ?? "").trim();
    if (d && !r.descriptionEn) items.push({ table: "official", id: r.id, description: d });
  }
  for (const r of custom) {
    const d = (r.description ?? "").trim();
    if (d && !r.descriptionEn) items.push({ table: "custom", id: r.id, description: d });
  }
  console.log(`missing descriptions: official=${official.filter((r) => (r.description ?? "").trim() && !r.descriptionEn).length} custom=${custom.filter((r) => (r.description ?? "").trim() && !r.descriptionEn).length}`);
  console.log(`total to translate  : ${items.length}`);

  if (!COMMIT) {
    console.log("\nDRY-RUN. Re-run with --commit to apply.");
    return;
  }

  const batches: Item[][] = [];
  for (let i = 0; i < items.length; i += BATCH) batches.push(items.slice(i, i + BATCH));

  let done = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < batches.length) {
      const idx = cursor++;
      const batch = batches[idx];
      try {
        const out = await translateBatch(batch);
        for (const [k, v] of Object.entries(out)) {
          const it = batch[Number(k)];
          if (!it) continue;
          const patch = { descriptionEn: v.en, descriptionFil: v.fil, descriptionId: v.id };
          if (it.table === "official") await db.update(officialRecipes).set(patch).where(eq(officialRecipes.id, it.id));
          else await db.update(customRecipes).set(patch).where(eq(customRecipes.id, it.id));
          done++;
        }
        console.log(`  batch ${idx + 1}/${batches.length} done (${Object.keys(out).length} rows)`);
      } catch (e) {
        console.warn(`  batch ${idx + 1}/${batches.length} FAILED: ${(e as Error)?.message}`);
      }
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`\nDONE. updated ${done}/${items.length}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
