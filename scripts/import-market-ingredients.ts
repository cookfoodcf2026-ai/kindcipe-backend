/**
 * Import market-item ingredients (extracted from the FEHD booklet
 * "Common Food/Goods Items and Service Trades in Public Markets")
 * into the common_ingredients dictionary.
 *
 * Usage:
 *   npx tsx scripts/import-market-ingredients.ts            # dry-run (default)
 *   npx tsx scripts/import-market-ingredients.ts --commit   # actually insert
 *
 * Data file: scripts/data/market-items-fehd.json
 *   [{ categoryKey, nameYue, nameZh, nameEn, nameFil, nameId, aliases? }]
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../server/db";
import { commonIngredients } from "../drizzle/schema";

type Row = {
  categoryKey: string;
  nameYue: string;
  nameZh: string;
  nameEn: string;
  nameFil?: string | null;
  nameId?: string | null;
  aliases?: string[];
};

const COMMIT = process.argv.includes("--commit");
const __dirname = dirname(fileURLToPath(import.meta.url));

function norm(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, "").trim();
}

async function main() {
  const dataPath = join(__dirname, "data", "market-items-fehd.json");
  const rows: Row[] = JSON.parse(readFileSync(dataPath, "utf8"));

  const db = await getDb();
  const existing = await db
    .select({ nameZh: commonIngredients.nameZh, nameYue: commonIngredients.nameYue, nameEn: commonIngredients.nameEn })
    .from(commonIngredients);

  const have = new Set<string>();
  for (const r of existing) {
    for (const v of [r.nameZh, r.nameYue, r.nameEn]) {
      const n = norm(v);
      if (n) have.add(n);
    }
  }

  const toInsert: Row[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const key = norm(r.nameZh);
    const aliases = (r.aliases ?? []).map(norm).filter(Boolean);
    if (!key || seen.has(key) || have.has(key) || aliases.some((a) => have.has(a))) {
      skipped.push(r.nameZh);
      continue;
    }
    seen.add(key);
    toInsert.push(r);
  }

  console.log(`data file      : ${dataPath}`);
  console.log(`rows in file   : ${rows.length}`);
  console.log(`already present: ${skipped.length}`);
  console.log(`to insert      : ${toInsert.length}`);
  console.log(`dict size now  : ${existing.length}`);

  const byCat: Record<string, number> = {};
  for (const r of toInsert) byCat[r.categoryKey] = (byCat[r.categoryKey] ?? 0) + 1;
  console.log("by categoryKey :", JSON.stringify(byCat));

  console.log("\nsample (first 10):");
  for (const r of toInsert.slice(0, 10)) {
    console.log(`  ${r.nameZh} | ${r.nameEn} | ${r.nameFil ?? "-"} | ${r.nameId ?? "-"}  [${r.categoryKey}]`);
  }

  if (!COMMIT) {
    console.log("\nDRY-RUN. Re-run with --commit to insert.");
    return;
  }

  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += 100) {
    const chunk = toInsert.slice(i, i + 100);
    const values = chunk.map((r) => ({
      categoryKey: r.categoryKey,
      defaultUnitKey: null,
      nameYue: r.nameYue,
      nameZh: r.nameZh,
      nameEn: r.nameEn,
      nameFil: r.nameFil ?? null,
      nameId: r.nameId ?? null,
      isActive: true,
      sortOrder: 100,
    }));
    const res = await db.insert(commonIngredients).values(values).returning({ id: commonIngredients.id });
    inserted += res.length;
    console.log(`  inserted batch ${i / 100 + 1}: ${res.length}`);
  }
  console.log(`\nDONE. inserted ${inserted}. dict size now ${existing.length + inserted}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
