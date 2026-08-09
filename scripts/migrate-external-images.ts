/**
 * Migration script: Rehost external images (Instagram CDN, etc.) to R2
 * Run with: npx tsx scripts/migrate-external-images.ts
 */

import { getDb } from "../server/db";
import { storagePut } from "../server/storage";
import { customRecipes } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const EXTERNAL_PATTERNS = [
  "instagram.com",
  "cdninstagram.com",
  "scontent-",
  ".fbcdn.net",
];

function isExternalImage(url: string): boolean {
  if (!url) return false;
  const isR2 =
    url.includes(".r2.cloudflarestorage.com/") ||
    url.startsWith("/r2-storage/") ||
    (process.env.R2_PUBLIC_URL && url.startsWith(process.env.R2_PUBLIC_URL));
  if (isR2) return false;
  return EXTERNAL_PATTERNS.some(pattern => url.includes(pattern));
}

async function rehostExternalImage(imageUrl: string): Promise<string> {
  if (!imageUrl) return "";
  // Decode HTML entities that break fetch (especially Instagram's &amp;)
  imageUrl = imageUrl.replace(/&amp;/g, "&");
  
  const isR2 = imageUrl.includes(".r2.cloudflarestorage.com/") ||
    (process.env.R2_PUBLIC_URL && imageUrl.startsWith(process.env.R2_PUBLIC_URL)) ||
    imageUrl.startsWith("/r2-storage/");
  if (isR2) return imageUrl;
  try {
    const resp = await fetch(imageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Referer": "https://www.instagram.com/",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Sec-Fetch-Site": "cross-site",
        "Sec-Fetch-Mode": "no-cors",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return imageUrl;
    const contentType = resp.headers.get("content-type") || "image/jpeg";
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const arrayBuf = await resp.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    const key = `recipe-thumbnails/external-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { url } = await storagePut(key, buf, contentType);
    const backendHost = process.env.RAILWAY_PUBLIC_DOMAIN;
    const fullUrl = url.startsWith("/") && backendHost ? `https://${backendHost}${url}` : url;
    return fullUrl;
  } catch {
    return imageUrl;
  }
}

async function main() {
  console.log("🚀 Starting external image migration...");

  const db = await getDb();
  if (!db) {
    console.error("❌ Failed to connect to database");
    process.exit(1);
  }

  const allRecipes = await db.select().from(customRecipes);
  console.log(`📊 Found ${allRecipes.length} custom recipes`);

  let migrated = 0;
  let failed = 0;
  let skipped = 0;

  for (const recipe of allRecipes) {
    const needsMigration = isExternalImage(recipe.image || "") || isExternalImage(recipe.thumbnailUrl || "");

    if (!needsMigration) {
      skipped++;
      continue;
    }

    console.log(`🔄 Migrating recipe ${recipe.id}: ${recipe.name}`);

    try {
      const newImage = recipe.image ? await rehostExternalImage(recipe.image) : "";
      const newThumbnail = recipe.thumbnailUrl ? await rehostExternalImage(recipe.thumbnailUrl) : newImage || "";

      await db.update(customRecipes)
        .set({
          image: newImage,
          thumbnailUrl: newThumbnail,
          updatedAt: new Date(),
        })
        .where(eq(customRecipes.id, recipe.id));

      migrated++;
      console.log(`✅ Migrated recipe ${recipe.id}`);

      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      failed++;
      console.error(`❌ Failed to migrate recipe ${recipe.id}:`, error);
    }
  }

  console.log("\n📈 Migration complete!");
  console.log(`✅ Migrated: ${migrated}`);
  console.log(`⏭️  Skipped (already R2 or no image): ${skipped}`);
  console.log(`❌ Failed: ${failed}`);
}

main().catch(console.error);