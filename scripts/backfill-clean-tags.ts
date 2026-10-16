/**
 * Backfill: clean junk tags (e.g. "x4e0a" HTML-entity decode artifacts) in
 * custom_recipes and official_recipes. Dry-run by default.
 *   npx tsx scripts/backfill-clean-tags.ts
 *   npx tsx scripts/backfill-clean-tags.ts --commit
 */
import "dotenv/config";
import postgres from "postgres";

const COMMIT = process.argv.includes("--commit");
const sql = postgres(process.env.DATABASE_URL!);
const log = (s: string) => console.log((COMMIT ? "[COMMIT] " : "[DRY]    ") + s);

const TAG_JUNK_RE = /^x[0-9a-fA-F]{2,6}$/;
function cleanTags(tags: any): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tags) {
    const s = String(t ?? "").replace(/^#/, "").trim();
    if (!s) continue;
    if (TAG_JUNK_RE.test(s)) continue;
    if (/^[\d\s.,;:()（）]+$/.test(s)) continue;
    if (s.length > 24) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out.slice(0, 20);
}

async function run(table: string) {
  const rows = await sql.unsafe(`select id, tags from "${table}" where tags is not null and tags <> '' and tags <> '[]'`);
  let changed = 0;
  for (const r of rows) {
    let parsed: any;
    try { parsed = JSON.parse(r.tags); } catch { continue; }
    if (!Array.isArray(parsed)) continue;
    const cleaned = cleanTags(parsed);
    if (cleaned.length !== parsed.length) {
      changed++;
      if (changed <= 5) log(`${table}#${r.id}: ${parsed.length} -> ${cleaned.length} (removed: ${parsed.filter((x: string) => !cleaned.includes(x)).slice(0, 8).join(", ")})`);
      if (COMMIT) await sql.unsafe(`update "${table}" set tags=$1 where id=$2`, [JSON.stringify(cleaned), r.id]);
    }
  }
  log(`${table}: ${changed} rows changed (of ${rows.length})`);
}

async function main() {
  await run("custom_recipes");
  await run("official_recipes");
  console.log(COMMIT ? "✅ Done." : "ℹ️  Dry-run. Add --commit to apply.");
  await sql.end();
}
main().catch(async (e) => { console.error("Failed:", e); await sql.end(); process.exit(1); });
