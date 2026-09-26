/**
 * backfill-recipe-classification.ts
 * 一次性修正舊食譜：recipeCategory（canonical 菜系）、dishType（9 類）、（可選）tags。
 *
 * 用法：
 *   npx tsx scripts/backfill-recipe-classification.ts --dry-run --limit=30
 *   npx tsx scripts/backfill-recipe-classification.ts --write --batch=5
 *   npx tsx scripts/backfill-recipe-classification.ts --only=official --write
 */
import { config } from "dotenv";
import { resolve } from "path";
import { writeFileSync, mkdirSync } from "fs";
config({ path: resolve(process.cwd(), ".env") });

const { eq } = await import("drizzle-orm");
const { getDb } = await import("../server/db");
const { customRecipes, officialRecipes } = await import("../drizzle/schema");
const { classifyRecipeDishTypeLLM } = await import("../server/utils/dishType");
const { invokeLLM, extractJSON } = await import("../server/_core/llm");

// ── canonical（同前端 lib/taxonomy.ts / lib/dishType.ts 對齊）──
const CUISINES = ["中菜", "西餐", "日式", "韓式", "東南亞", "港式", "台式", "泰式", "印度", "甜品", "飲品", "其他"] as const;
const DISH_TYPES = ["meat", "seafood", "vegetable", "soup", "carb", "appetizer", "dessert", "drink", "other"] as const;

// 後端舊 parse 值 / 非菜系值 → canonical（唔用 LLM 都對得返嘅）
const CATEGORY_MAP: Record<string, string> = {
  "粵菜": "中菜", "中式": "中菜", "中菜": "中菜",
  "西式": "西餐", "西餐": "西餐",
  "日式": "日式", "韓式": "韓式", "台式": "台式",
  "東南亞": "東南亞", "泰式": "泰式", "印度": "印度", "港式": "港式",
  "甜品": "甜品", "飲品": "飲品", "其他": "其他",
  // 非菜系（舊值）
  "快手菜": "其他", "湯水": "中菜", "素食": "其他",
};
const LEGACY_INGREDIENT_CATS = new Set(["poultry", "pork", "beef", "seafood", "vegetable", "egg", "carb", "mixed"]);

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
}
const isCanonCuisine = (v: string) => (CUISINES as readonly string[]).includes(v);
const isCanonDish = (v: string) => (DISH_TYPES as readonly string[]).includes(v);

async function classifyCuisineLLM(r: any): Promise<string | undefined> {
  try {
    const prompt =
      `你係香港食譜分類器。根據菜名/描述/食材，判斷食譜屬邊個菜系。\n` +
      `菜名：${r.name}\n描述：${(r.description || "").slice(0, 300)}\n` +
      `請回傳 JSON：{"recipeCategory":"..."}\n` +
      `只可以揀：${CUISINES.join(" / ")}\n只回傳 JSON。`;
    const resp = await invokeLLM({
      messages: [{ role: "user", content: prompt }],
      maxTokens: 30, temperature: 0, timeoutMs: 12000,
      responseFormat: { type: "json_object" },
    });
    const parsed = extractJSON<{ recipeCategory?: string }>(resp.choices?.[0]?.message?.content || "");
    return parsed?.recipeCategory && isCanonCuisine(parsed.recipeCategory) ? parsed.recipeCategory : undefined;
  } catch { return undefined; }
}

function parseArgs(argv: string[]) {
  const has = (f: string) => argv.includes(f) || argv.some((a) => a.startsWith(`${f}=`));
  const val = (f: string) => {
    const eqArg = argv.find((a) => a.startsWith(`${f}=`));
    if (eqArg) return eqArg.slice(f.length + 1);
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    write: has("--write"),
    limit: val("--limit") ? Number(val("--limit")) : null,
    batch: val("--batch") ? Number(val("--batch")) : 10,
    only: (val("--only") as "all" | "official" | "user") || "all",
    forceDish: has("--force-dish"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  console.log("Args:", args, args.write ? "⚠️ WRITE" : "DRY-RUN");

  const tables: Array<{ label: string; table: any; id: any }> = [];
  if (args.only === "all" || args.only === "user") tables.push({ label: "custom", table: customRecipes, id: customRecipes.id });
  if (args.only === "all" || args.only === "official") tables.push({ label: "official", table: officialRecipes, id: officialRecipes.id });

  const stats = { scanned: 0, cuisineChanged: 0, dishChanged: 0, failed: 0 };
  const distCuisine: Record<string, number> = {};
  const distDish: Record<string, number> = {};
  // 寫入前備份（可用嚟回滾）
  const snapshot: Array<{ table: string; id: any; recipeCategory: any; dishType: any }> = [];

  for (const { label, table, id } of tables) {
    let rows: any[] = await db.select().from(table);
    if (args.limit != null) rows = rows.slice(0, args.limit);
    console.log(`\n=== ${label}: ${rows.length} recipes ===`);

    for (const r of rows) {
      stats.scanned++;
      try {
        let newCat = String(r.recipeCategory || "").trim();
        let catReason = "";
        if (CATEGORY_MAP[newCat]) {
          const mapped = CATEGORY_MAP[newCat];
          if (mapped !== newCat) { catReason = `${newCat}→${mapped}(map)`; newCat = mapped; }
        } else if (!isCanonCuisine(newCat)) {
          const llm = await classifyCuisineLLM(r);
          const mapped = llm || (LEGACY_INGREDIENT_CATS.has(newCat.toLowerCase()) ? "其他" : "其他");
          catReason = `${newCat || "-"}→${mapped}(${llm ? "llm" : "fallback"})`;
          newCat = mapped;
        }

        let newDish = String(r.dishType || "").trim();
        if (args.forceDish || !isCanonDish(newDish)) {
          const t = await classifyRecipeDishTypeLLM({
            name: r.name, description: r.description,
            ingredients: (() => { try { return JSON.parse(r.ingredients || "[]"); } catch { return []; } })(),
            tags: parseTags(r.tags), category: newCat,
          });
          newDish = t || "other";
        }

        const catChanged = newCat !== String(r.recipeCategory || "").trim();
        const dishChanged = newDish !== String(r.dishType || "").trim();
        if (catChanged) stats.cuisineChanged++;
        if (dishChanged) stats.dishChanged++;
        distCuisine[newCat] = (distCuisine[newCat] || 0) + 1;
        distDish[newDish] = (distDish[newDish] || 0) + 1;

        if (catChanged || dishChanged) {
          console.log(`[${args.write ? "WRITE" : "DRY "}] ${r.id} ${r.name}\n` +
            `   cat : ${r.recipeCategory || "-"} → ${newCat} ${catReason}\n` +
            `   dish: ${r.dishType || "-"} → ${newDish}`);
          if (args.write) {
            snapshot.push({ table: label, id: r.id, recipeCategory: r.recipeCategory, dishType: r.dishType });
            await db.update(table).set({ recipeCategory: newCat, dishType: newDish }).where(eq(id, r.id));
          }
        }
      } catch (e) {
        stats.failed++;
        console.error(`[ERR] ${r.id} ${r.name}:`, (e as Error)?.message);
      }
    }
  }

  console.log("\n===== report =====");
  console.log(JSON.stringify({ stats, distCuisine, distDish }, null, 2));
  if (args.write && snapshot.length > 0) {
    try {
      mkdirSync(resolve(process.cwd(), "scripts/data"), { recursive: true });
      const path = resolve(process.cwd(), `scripts/data/classification-backup-${Date.now()}.json`);
      writeFileSync(path, JSON.stringify(snapshot, null, 2));
      console.log(`\n💾 Backup (before values) written: ${path} (${snapshot.length} rows)`);
    } catch (e) { console.warn("Backup write failed:", (e as Error).message); }
  }
  process.exit(0);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
