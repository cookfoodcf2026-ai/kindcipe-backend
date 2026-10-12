/**
 * check-i18n-coverage: every user-visible "name" column must have localized
 * siblings (name_en / name_fil / name_id) so non-Chinese users never see Chinese.
 *
 * Reads drizzle/schema.ts (no DB needed). Allowlist = intentionally exempt
 * (free-text or hidden features).
 *
 * Usage: node scripts/check-i18n-coverage.js   (exit 1 on violations)
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const schema = fs.readFileSync(path.join(ROOT, "drizzle", "schema.ts"), "utf8");

// db table names exempt from the invariant (free-text / hidden / non-display).
const ALLOW = new Set([
  "pantry_items", "purchase_history", "recipe_notes", "shopping_templates",
  "recipe_events", "ai_chef_seen_recipes", "price_watch", "user_recipe_collections",
  "email_verification_codes", "family_join_requests", "user_identities",
  // User-authored / free-text / derived labels (not translatable):
  "users", "families", "favorite_items", "ai_chat_sessions",
]);

// Map a *base* name column key -> its localized sibling keys.
const NAME_BASES = [
  { base: "name", siblings: ["nameEn", "nameFil", "nameId"] },
  { base: "recipeName", siblings: ["recipeNameEn", "recipeNameFil", "recipeNameId"] },
  { base: "fromRecipeName", siblings: [] }, // resolved via dictionary at render
  { base: "title", siblings: ["titleEn", "titleFil", "titleId"] },
];

// Split schema into per-table segments.
const segs = [];
const re = /pgTable\("([a-z_]+)"/g;
let m;
const idxs = [];
while ((m = re.exec(schema))) idxs.push({ name: m[1], start: m.index });
for (let i = 0; i < idxs.length; i++) {
  const end = i + 1 < idxs.length ? idxs[i + 1].start : schema.length;
  segs.push({ name: idxs[i].name, body: schema.slice(idxs[i].start, end) });
}

const violations = [];
for (const { name, body } of segs) {
  if (ALLOW.has(name)) continue;
  for (const { base, siblings } of NAME_BASES) {
    if (siblings.length === 0) continue;
    const hasBase = new RegExp(`\\b${base}:\\s`).test(body);
    if (!hasBase) continue;
    const missing = siblings.filter((s) => !new RegExp(`\\b${s}:\\s`).test(body));
    if (missing.length > 0) {
      violations.push(`${name}.${base}  missing: ${missing.join(", ")}`);
    }
  }
}

if (violations.length) {
  console.error(`\n❌ i18n coverage: ${violations.length} name column(s) without localized siblings:\n`);
  violations.forEach((v) => console.error("  " + v));
  console.error("\n→ Add name_en/name_fil/name_id columns, resolve via dictionary, or add to ALLOW.\n");
  process.exit(1);
}
console.log(`✅ i18n coverage: all name columns have localized siblings (${segs.length} tables checked).`);
