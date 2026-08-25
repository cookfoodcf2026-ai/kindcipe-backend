/**
 * Batch upload official recipe cover images to R2 & update DB
 *
 * Flow:
 *  1. Load .env (R2 + DATABASE_URL)
 *  2. Read scripts/recipe-image-map.json (recipe name -> asset filename)
 *  3. Query officialRecipes from DB
 *  4. For each recipe: find local PNG, compress to JPEG (max 800px), upload to R2
 *  5. Store full URL (backend-hosted /r2-storage/{key}) in image + thumbnailUrl
 *
 * Run (from backend root):
 *  npx tsx scripts/upload-recipe-images.ts
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });

import { readFileSync, existsSync } from "fs";
import sharp from "sharp";
import { storagePut } from "../server/storage";
import { getDb } from "../server/db";
import { officialRecipes } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const ASSETS_DIR = resolve(process.cwd(), "../kindcipe-app-4/assets/recipes");
const MAP_PATH = resolve(process.cwd(), "scripts/recipe-image-map.json");
// Backend proxy host (R2 has no public URL, so images are served via this)
const BACKEND_HOST =
  process.env.BACKEND_PUBLIC_URL ?? "https://kindcipe-backend-production.up.railway.app";

const MAX_WIDTH = 800;
const JPEG_QUALITY = 78;

interface ImageMap {
  [name: string]: string;
}

/** Strip regional/cooking-method prefixes to match asset filenames (e.g. 港式乾炒牛河 → 乾炒牛河). */
const PREFIX_RE =
  /^(港式|日式|韓式|泰式|西式|意式|台式|電飯煲|經典|正宗|傳統|風味|大牌檔風味)\s*/;

function lookupFile(name: string, map: ImageMap): string | undefined {
  if (map[name]) return map[name];
  const cleaned = name.replace(PREFIX_RE, "").replace(/\s*\([^)]+\)\s*$/, "").trim();
  return cleaned !== name ? map[cleaned] : undefined;
}

async function main() {
  if (!existsSync(MAP_PATH)) {
    console.error(`MISSING ${MAP_PATH} — run script in app repo first.`);
    process.exit(1);
  }
  const nameMap: ImageMap = JSON.parse(readFileSync(MAP_PATH, "utf8"));
  console.log(`Recipe name→file map: ${Object.keys(nameMap).length} entries`);

  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const rows = await db.select().from(officialRecipes).where(eq(officialRecipes.isActive, true));
  console.log(`Official recipes in DB: ${rows.length}\n`);

  let ok = 0, skipped = 0, failed = 0, noMap = 0, noFile = 0;
  const results: string[] = [];

  for (const r of rows) {
    // Skip rows that already have a thumbnail pointing to R2
    if (r.thumbnailUrl && r.thumbnailUrl.includes("/r2-storage/")) {
      skipped++;
      continue;
    }

    const fileName = lookupFile(r.name, nameMap);
    if (!fileName) {
      noMap++;
      results.push(`❌ NO MAP: "${r.name}" (id=${r.id})`);
      continue;
    }
    const inputPath = `${ASSETS_DIR}/${fileName}`;
    if (!existsSync(inputPath)) {
      noFile++;
      results.push(`❌ NO FILE: "${r.name}" → ${fileName}`);
      continue;
    }

    try {
      // Compress in-memory: resize to max 800px wide, convert to JPEG
      const jpeg = await sharp(inputPath)
        .rotate()
        .resize({ width: MAX_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY, progressive: true })
        .toBuffer();

      const relKey = `recipe-thumbnails/official-${r.id}.jpg`;
      const { key } = await storagePut(relKey, jpeg, "image/jpeg");
      const url = `${BACKEND_HOST}/r2-storage/${key}`;

      await db.update(officialRecipes)
        .set({ image: url, thumbnailUrl: url, updatedAt: new Date() })
        .where(eq(officialRecipes.id, r.id));

      ok++;
      console.log(`✅ [${r.id}] ${r.name} → ${url} (${(jpeg.length / 1024).toFixed(0)} KB)`);
    } catch (e: any) {
      failed++;
      results.push(`❌ FAILED: "${r.name}" → ${e.message}`);
    }
  }

  console.log(`\n==== SUMMARY ====`);
  console.log(`✅ uploaded+updated: ${ok}`);
  console.log(`⏭  already had R2: ${skipped}`);
  console.log(`🚫 no name mapping: ${noMap}`);
  console.log(`🚫 file missing: ${noFile}`);
  console.log(`❌ errors: ${failed}`);
  results.forEach((r) => console.log(r));
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});