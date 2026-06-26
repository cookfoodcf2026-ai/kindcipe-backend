/**
 * Seed script for common_ingredients table.
 * Run with: npx tsx drizzle/seeds/seed-common-ingredients.ts
 *
 * Reads from drizzle/seeds/common-ingredients.json and inserts into the database.
 * Idempotent: skips items that already exist (ON CONFLICT DO NOTHING on nameYue).
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { commonIngredients } from "../schema";
import { insertCommonIngredients } from "../../server/db";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const jsonPath = path.join(__dirname, "common-ingredients.json");
  const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

  console.log(`[Seed] Loaded ${data.length} items from common-ingredients.json`);

  // Validate data
  const errors: string[] = [];
  const names = new Set<string>();
  const allowedCategories = new Set([
    "vegetables", "fruits", "meat", "seafood", "dairy",
    "seasoning", "dryGoods", "staple", "beverage", "snacks",
    "household", "cleaning", "personal", "baby", "pet", "other",
  ]);

  for (const item of data) {
    if (!item.nameYue || item.nameYue.trim() === "") {
      errors.push(`Empty nameYue: ${JSON.stringify(item)}`);
    }
    if (!item.nameEn || item.nameEn.trim() === "") {
      errors.push(`Empty nameEn: ${item.nameYue}`);
    }
    if (!allowedCategories.has(item.categoryKey)) {
      errors.push(`Invalid category "${item.categoryKey}" for "${item.nameYue}"`);
    }
    if (names.has(item.nameYue)) {
      errors.push(`Duplicate nameYue: "${item.nameYue}"`);
    }
    names.add(item.nameYue);
  }

  if (errors.length > 0) {
    console.error("[Seed] Validation errors:");
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  console.log("[Seed] Validation passed. Inserting...");

  const inserted = await insertCommonIngredients(data);
  console.log(`[Seed] Done. Inserted ${inserted} items (skipped duplicates).`);

  process.exit(0);
}

main().catch((err) => {
  console.error("[Seed] Failed:", err);
  process.exit(1);
});
