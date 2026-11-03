import { readFileSync } from "node:fs";
import { deriveRecipeTags } from "../server/services/chefDerivedTags";

const rows = JSON.parse(readFileSync(process.argv[2] ?? "/tmp/official_dump.json", "utf8"));
const toNames = (v: any) => (Array.isArray(v) ? v : JSON.parse(v ?? "[]")).map((i: any) => String(i?.name ?? i ?? "")).filter(Boolean);

let chickenSeafood = 0, emptyProtein = 0;
const examples: string[] = [];
for (const r of rows) {
  const tags: string[] = (deriveRecipeTags as any)({ name: r.name, ingredients: toNames(r.ingredients).map((n) => ({ name: n })), dishType: r.dish_type, cookTime: r.cook_time, difficulty: r.difficulty, tags: toNames(r.tags) });
  const hasChicken = tags.includes("protein:chicken");
  const hasSeafood = tags.includes("protein:seafood") || tags.includes("protein:fish");
  if (hasChicken && hasSeafood) { chickenSeafood++; if (examples.length < 5) examples.push(r.name); }
  if (!tags.some((t) => t.startsWith("protein:"))) emptyProtein++;
}
const target = rows.find((r: any) => String(r.name).includes("時蔬") && String(r.name).includes("雞胸"));
let targetTags: string[] = [];
if (target) targetTags = (deriveRecipeTags as any)({ name: target.name, ingredients: toNames(target.ingredients).map((n) => ({ name: n })) });
console.log(JSON.stringify({ rows: rows.length, chickenWithSeafood: chickenSeafood, emptyProtein, examples, target: target?.name ?? null, targetTags }, null, 1));
