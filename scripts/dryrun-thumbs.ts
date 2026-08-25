import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });
import { readFileSync } from "fs";
import { getDb } from "../server/db";
import { officialRecipes } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const nameMap: Record<string, string> = JSON.parse(
  readFileSync(resolve(process.cwd(), "scripts/recipe-image-map.json"), "utf8")
);

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const rows = await db.select().from(officialRecipes).where(eq(officialRecipes.isActive, true));
  console.log(`official recipes (active): ${rows.length}`);
  let withMap = 0, withThumb = 0, r2Thumb = 0, noMap = 0;
  const noMapNames: string[] = [];
  for (const r of rows) {
    if (nameMap[r.name]) withMap++;
    else { noMap++; noMapNames.push(`${r.id}: ${r.name}`); }
    if (r.thumbnailUrl) withThumb++;
    if (r.thumbnailUrl && r.thumbnailUrl.includes("/r2-storage/")) r2Thumb++;
  }
  console.log(`with name->file mapping: ${withMap}`);
  console.log(`no mapping: ${noMap}`);
  console.log(`has thumbnailUrl: ${withThumb}`);
  console.log(`has R2 thumbnailUrl: ${r2Thumb}`);
  if (noMapNames.length > 0) {
    console.log("\n--- recipes WITHOUT map (first 30) ---");
    noMapNames.slice(0, 30).forEach((n) => console.log("  ", n));
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });