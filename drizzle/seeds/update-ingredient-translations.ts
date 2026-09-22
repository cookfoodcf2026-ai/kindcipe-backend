/**
 * Push nameFil / nameId translations into the common_ingredients table.
 * Updates existing rows (UPSERT on nameYue). Idempotent.
 *
 * Run:  npx tsx drizzle/seeds/update-ingredient-translations.ts   (from ../kindcipe-backend)
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { updateCommonIngredientTranslations } from "../../server/db";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const jsonPath = path.join(__dirname, "common-ingredients.json");
const items = JSON.parse(fs.readFileSync(jsonPath, "utf8")).filter(
  (it: any) => it.nameFil && it.nameId && it.nameYue
);

async function main() {
  console.log(`Updating translations for ${items.length} ingredients...`);
  const updated = await updateCommonIngredientTranslations(items);
  console.log(`Updated ${updated} rows.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
