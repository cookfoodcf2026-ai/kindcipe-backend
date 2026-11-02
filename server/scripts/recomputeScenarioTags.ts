import postgres from "postgres";
import { ALL_SCENARIOS, deriveScenarios, type Scenario } from "../utils/scenario";

type Row = {
  source: "official" | "custom";
  id: number;
  name: string | null;
  description: string | null;
  cook_time: number | null;
  difficulty: string | null;
  dish_type: string | null;
  recipe_category: string | null;
  tags: string | null;
  ingredients: string | null;
  steps: string | null;
  scenario_tags: string | null;
};

function parseJson(value: string | null): unknown {
  try { return JSON.parse(value || "[]"); } catch { return []; }
}
function parseArray(value: string | null): unknown[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed : [];
}
function scenarioSet(value: string | null): Scenario[] {
  return parseArray(value).map(String).filter((s): s is Scenario => (ALL_SCENARIOS as string[]).includes(s));
}
function sorted(values: Scenario[]): string {
  return JSON.stringify([...new Set(values)].sort());
}

export function diffScenarioTags(row: Row, mode: "replace" | "union" = "replace"): { before: Scenario[]; after: Scenario[]; changed: boolean } {
  const before = scenarioSet(row.scenario_tags);
  const derived = deriveScenarios({
    name: row.name,
    description: row.description,
    cookTime: row.cook_time,
    difficulty: row.difficulty,
    dishType: row.dish_type,
    recipeCategory: row.recipe_category,
    tags: parseArray(row.tags) as string[],
    ingredients: parseArray(row.ingredients) as Array<{ name?: string | null }>,
    steps: parseArray(row.steps) as Array<string | { instruction?: string | null }>,
  });
  const after = mode === "union" ? [...new Set([...before, ...derived])] : derived;
  return { before, after, changed: sorted(before) !== sorted(after) };
}

type Summary = {
  total: number;
  changed: number;
  percent: number;
  added: Record<Scenario, number>;
  removed: Record<Scenario, number>;
  examples: Array<{ id: number; name: string; before: Scenario[]; after: Scenario[] }>;
};

function summarize(rows: Row[], mode: "replace" | "union"): Summary {
  const added = Object.fromEntries(ALL_SCENARIOS.map((scenario) => [scenario, 0])) as Record<Scenario, number>;
  const removed = Object.fromEntries(ALL_SCENARIOS.map((scenario) => [scenario, 0])) as Record<Scenario, number>;
  const examples: Summary["examples"] = [];
  let changed = 0;
  for (const row of rows) {
    const diff = diffScenarioTags(row, mode);
    if (!diff.changed) continue;
    changed++;
    for (const s of diff.after) if (!diff.before.includes(s)) added[s]++;
    for (const s of diff.before) if (!diff.after.includes(s)) removed[s]++;
    if (examples.length < 5) examples.push({ id: row.id, name: String(row.name ?? ""), before: diff.before, after: diff.after });
  }
  return { total: rows.length, changed, percent: rows.length > 0 ? Math.round((changed / rows.length) * 1000) / 10 : 0, added, removed, examples };
}

function printSummary(label: string, summary: Summary): void {
  console.log(`\n=== ${label} ===`);
  console.log(`total=${summary.total} changed=${summary.changed} (${summary.percent}%)`);
  console.log(`added   ${JSON.stringify(summary.added)}`);
  console.log(`removed ${JSON.stringify(summary.removed)}`);
  console.log("examples:");
  for (const example of summary.examples) {
    console.log(`  id=${example.id} name=${example.name} before=${JSON.stringify(example.before)} after=${JSON.stringify(example.after)}`);
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const replace = process.argv.includes("--replace");
  const mode = replace ? "replace" : "union";
  const url = process.env.DATABASE_URL ?? "postgres://mavisng@localhost:5432/kindcipe_restore_test";
  const sql = postgres(url, { max: 1 });
  try {
    if (!apply) await sql`set default_transaction_read_only = on`;
    const official = await sql<Row[]>`
      select 'official'::text source, id, name, description, cook_time, difficulty, dish_type, recipe_category, tags, ingredients, steps, scenario_tags
      from official_recipes where is_active = true order by id
    `;
    const custom = await sql<Row[]>`
      select 'custom'::text source, id, name, description, cook_time, difficulty, dish_type, recipe_category, tags, ingredients, steps, scenario_tags
      from custom_recipes where coalesce(is_draft, false) = false order by id
    `;
    console.log(`mode=${apply ? "APPLY" : "DRY-RUN"} tags=${mode} database=${url.replace(/\/\/[^@]+@/, "//***@")}`);
    printSummary("official_recipes", summarize(official, mode));
    printSummary("custom_recipes", summarize(custom, mode));
    if (apply) {
      let updates = 0;
      for (const row of [...official, ...custom]) {
        const diff = diffScenarioTags(row, mode);
        if (!diff.changed) continue;
        const table = row.source === "official" ? "official_recipes" : "custom_recipes";
        await sql.unsafe(`update ${table} set scenario_tags = $1 where id = $2`, [JSON.stringify(diff.after), row.id]);
        updates++;
      }
      console.log(`\nAPPLIED updates=${updates}`);
    }
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.includes("recomputeScenarioTags")) {
  void main().catch((error) => { console.error(error); process.exit(1); });
}
