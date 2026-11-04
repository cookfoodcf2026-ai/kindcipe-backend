import { existsSync, readFileSync } from "node:fs";
import { FOOD_TERM_FAMILIES, foodFamilyForTerm, findFoodTerm } from "../services/foodLexicon";

type RecordLike = {
  id?: string;
  turn?: string;
  query?: string;
  served?: number;
  cardNames?: string[];
  recipes?: Array<{ name?: string; ingredients?: Array<{ name?: string }> }>;
};

const args = process.argv.slice(2);
const arg = (name: string, fallback = "") => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const file = arg("--file", "server/fixtures/aiChef/record-30.jsonl");
const catalogFile = arg("--catalog", "server/fixtures/aiChef/catalog.json");
const records: RecordLike[] = readFileSync(file, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line) as RecordLike);
const catalog = existsSync(catalogFile)
  ? (JSON.parse(readFileSync(catalogFile, "utf8")) as Array<{ name?: string; ingredients?: Array<{ name?: string }> }>)
  : [];
const ingredientByName = new Map(catalog.map((row) => [String(row.name ?? ""), (row.ingredients ?? []).map((i) => String(i.name ?? ""))]));

const violations: Array<{ id: string; query: string; cards: string[]; missing: string }> = [];
let total = 0;
let hit = 0;
for (const record of records) {
  const served = Number(record.served ?? record.recipes?.length ?? 0);
  if (served <= 0) continue;
  const query = String(record.turn ?? record.query ?? "").trim();
  if (/(?:唔要|不要|唔食|不吃|走|免|no\s|without|雪櫃|冰箱|pantry|剩|得)/i.test(query)) continue;
  const term = findFoodTerm(query);
  if (!term) continue;
  total += 1;
  const family = foodFamilyForTerm(term);
  const aliases = family ? (FOOD_TERM_FAMILIES[family] ?? [term]) : [term];
  const cards = record.cardNames ?? (record.recipes ?? []).map((recipe) => String(recipe.name ?? ""));
  const cardText = cards.map((name) => `${name} ${(ingredientByName.get(name) ?? []).join(" ")}`).join(" ");
  const matched = aliases.some((alias) => cardText.includes(alias));
  if (matched) hit += 1;
  else violations.push({ id: String(record.id ?? "?"), query, cards, missing: term });
}
console.log(JSON.stringify({ file, total, hit, violations: violations.length, items: violations }, null, 2));
process.exit(violations.length > 0 ? 1 : 0);
