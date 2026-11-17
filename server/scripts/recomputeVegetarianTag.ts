/**
 * One-off recompute of the `vegetarian` scenario tag ONLY.
 *
 *   npx tsx server/scripts/recomputeVegetarianTag.ts            # dry-run (default)
 *   npx tsx server/scripts/recomputeVegetarianTag.ts --apply    # write (transaction)
 *
 * Invariants:
 *  - Every other tag (unknown strings, order, duplicates) is preserved byte-for-byte.
 *  - `scenario_tags_user` is never read or written.
 *  - The tag is derived from CURRENT DB name + ingredients, never from the old tag.
 *  - `--replace` is rejected (we never rebuild the whole tag array).
 */
import { execSync } from "node:child_process";
import postgres from "postgres";

type SqlClient = ReturnType<typeof postgres>;
type TxClient = postgres.TransactionSql;
import { isNonVegetarianName, isVegetarianRow } from "../utils/vegetarian";

type TableName = "official_recipes" | "custom_recipes";
type Mode = "bidirectional" | "add-only";

type Row = {
  id: number;
  name: string | null;
  ingredients: string | null;
  scenario_tags: string | null;
  family_id?: number;
};

type Scope = {
  label: string;
  table: TableName;
  mode: Mode;
  rows: Row[];
};

type Change = {
  table: TableName;
  mode: Mode;
  id: number;
  name: string;
  original: string | null;
  before: unknown[];
  after: unknown[];
  beforeHas: boolean;
  afterHas: boolean;
  triggers: string[];
};

type ScopeSummary = {
  scope: Scope;
  total: number;
  vegBefore: number;
  vegAfter: number;
  added: number;
  removed: number;
  changes: Change[];
};

function parseJsonArray(value: string | null, context: string): unknown[] {
  if (value == null || value.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${context}: scenario_tags is not valid JSON`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${context}: scenario_tags is not a JSON array`);
  return parsed;
}

function parseIngredients(value: string | null): unknown[] {
  if (value == null || value.trim() === "") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function ingredientNames(ingredients: unknown[]): string[] {
  return ingredients.map((ingredient: any) =>
    typeof ingredient === "string" ? ingredient : String(ingredient?.name ?? ""),
  );
}

function otherTags(tags: unknown[]): unknown[] {
  return tags.filter((tag) => tag !== "vegetarian");
}

function assertOnlyVegetarianChanged(before: unknown[], after: unknown[], context: string): void {
  if (JSON.stringify(otherTags(before)) !== JSON.stringify(otherTags(after))) {
    throw new Error(`${context}: non-vegetarian tags changed`);
  }
}

function transformTags(
  rawTags: unknown[],
  derivedVeg: boolean,
  mode: Mode,
  context: string,
): { before: unknown[]; after: unknown[]; beforeHas: boolean; afterHas: boolean; changed: boolean } {
  const before = rawTags;
  const beforeHas = before.includes("vegetarian");
  let after = before;

  if (mode === "bidirectional") {
    if (derivedVeg && !beforeHas) after = [...before, "vegetarian"];
    else if (!derivedVeg && beforeHas) after = before.filter((tag) => tag !== "vegetarian");
  } else if (derivedVeg && !beforeHas) {
    after = [...before, "vegetarian"];
  }

  const afterHas = after.includes("vegetarian");
  assertOnlyVegetarianChanged(before, after, context);
  if (derivedVeg !== afterHas) {
    throw new Error(`${context}: vegetarian invariant violated after transform`);
  }
  return { before, after, beforeHas, afterHas, changed: beforeHas !== afterHas };
}

function derivedVegetarian(row: Row): boolean {
  return isVegetarianRow({ name: row.name ?? "", ingredients: parseIngredients(row.ingredients) });
}

const TRIGGER_TERMS_RE =
  /豬肉|豬扒|豬排|豬手|豬腳|豬骨|豬油|豬腸|豬仔包|牛肉|牛扒|牛排|牛腩|牛油|羊肉|羊扒|羊排|雞肉|雞胸|雞翼|雞腿|雞湯|雞粉|雞蛋|鴨肉|鴨蛋|鵝肉|魚露|魚蛋|魚片|魚柳|魚肚|魚肉|蝦米|蝦仁|蝦子|蝦|蟹|蠔油|蠔豉|蠔|蜆|帶子|瑤柱|火腿|煙肉|臘腸|臘肉|排骨|肥肉|瘦肉|肉碎|肉片|肉絲|肉丸|肉類|海鮮|海參|鮑魚|龍蝦|青口|扇貝|貽貝|魷魚|墨魚|八爪魚|明膠|明胶|吉利丁|動物性|动物性|xo醬|xo酱|喼汁|dashi|bonito|anchovy|gelatin|gelatine|rennet|lard|ribs|scallop|cuttlefish|oyster\s*sauce|fish\s*sauce|chicken\s*(?:stock|broth|powder)|shrimp|prawn|crab|oyster|clam|squid|octopus|tuna|salmon|mackerel|sardine|halibut|tilapia|trout|sole/i;

function triggersFor(row: Row): string[] {
  const names = [String(row.name ?? ""), ...ingredientNames(parseIngredients(row.ingredients))];
  const hits = new Set<string>();
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed || !isNonVegetarianName(trimmed)) continue;
    const matches = trimmed.match(TRIGGER_TERMS_RE);
    if (matches && matches.length > 0) {
      for (const match of matches) hits.add(match);
    } else {
      hits.add(trimmed);
    }
  }
  return [...hits];
}

function summarize(scope: Scope): ScopeSummary {
  let vegBefore = 0;
  let vegAfter = 0;
  let added = 0;
  let removed = 0;
  const changes: Change[] = [];

  for (const row of scope.rows) {
    const context = `${scope.table}#${row.id}`;
    const tags = parseJsonArray(row.scenario_tags, context);
    const result = transformTags(tags, derivedVegetarian(row), scope.mode, context);
    if (result.beforeHas) vegBefore++;
    if (result.afterHas) vegAfter++;
    if (!result.beforeHas && result.afterHas) added++;
    if (result.beforeHas && !result.afterHas) removed++;
    if (result.changed) {
      changes.push({
        table: scope.table,
        mode: scope.mode,
        id: row.id,
        name: String(row.name ?? ""),
        original: row.scenario_tags,
        before: result.before,
        after: result.after,
        beforeHas: result.beforeHas,
        afterHas: result.afterHas,
        triggers: triggersFor(row),
      });
    }
  }

  return { scope, total: scope.rows.length, vegBefore, vegAfter, added, removed, changes };
}

function printSummary(summary: ScopeSummary): void {
  const { scope } = summary;
  console.log(`\n=== ${scope.label} (table=${scope.table}, mode=${scope.mode}) ===`);
  console.log(
    `total=${summary.total} veg_before=${summary.vegBefore} veg_after=${summary.vegAfter} added=${summary.added} removed=${summary.removed}`,
  );
  if (summary.changes.length === 0) {
    console.log("changed rows: (none)");
    return;
  }
  console.log("changed rows:");
  for (const change of summary.changes) {
    console.log(
      `  ${change.table}#${change.id} name=${JSON.stringify(change.name)} ` +
        `before=${JSON.stringify(change.before)} after=${JSON.stringify(change.after)} ` +
        `triggers=${change.triggers.length ? change.triggers.join("、") : "—"}`,
    );
  }
}

async function loadScopes(sql: SqlClient | TxClient): Promise<Scope[]> {
  const official = await sql<Row[]>`
    select id, name, ingredients, scenario_tags
    from official_recipes
    where is_active = true
    order by id
  `;
  const customOwned = await sql<Row[]>`
    select id, family_id, name, ingredients, scenario_tags
    from custom_recipes
    where coalesce(is_draft, false) = false and family_id in (0, 13)
    order by id
  `;
  const customOther = await sql<Row[]>`
    select id, family_id, name, ingredients, scenario_tags
    from custom_recipes
    where coalesce(is_draft, false) = false and family_id not in (0, 13)
    order by id
  `;

  return [
    { label: "official_recipes", table: "official_recipes", mode: "bidirectional", rows: official },
    { label: "custom_recipes family_id in (0,13)", table: "custom_recipes", mode: "bidirectional", rows: customOwned },
    { label: "custom_recipes family_id not in (0,13)", table: "custom_recipes", mode: "add-only", rows: customOther },
  ];
}

function baseSha(): string {
  try {
    return execSync("git rev-parse --short=7 HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function maskDatabase(url: string): string {
  return url.replace(/^(postgres(?:ql)?:\/\/)[^@]*@/, "$1***@");
}

function printHeader(mode: "DRY-RUN" | "APPLY", database: string): void {
  console.log(`mode=${mode}`);
  console.log(`database=${maskDatabase(database)}`);
  console.log(`base=${baseSha()}`);
}

async function applyChanges(tx: TxClient, summaries: ScopeSummary[]): Promise<number> {
  let applied = 0;
  for (const summary of summaries) {
    for (const change of summary.changes) {
      const payload = JSON.stringify(change.after);
      const result = change.table === "official_recipes"
        ? await tx`update official_recipes set scenario_tags = ${payload} where id = ${change.id} and scenario_tags = ${change.original}`
        : await tx`update custom_recipes set scenario_tags = ${payload} where id = ${change.id} and scenario_tags = ${change.original}`;
      if (result.count !== 1) {
        throw new Error(
          `${change.table}#${change.id}: optimistic lock failed (expected 1 row, got ${result.count})`,
        );
      }
      applied++;
    }
  }
  return applied;
}

async function postCheck(tx: TxClient, before: ScopeSummary[], expectedApplied: number): Promise<void> {
  const fresh = (await loadScopes(tx)).map(summarize);

  let applied = 0;
  for (let i = 0; i < fresh.length; i++) {
    const pre = before[i];
    const post = fresh[i];
    const context = `${post.scope.table} scope ${post.scope.label}`;

    if (post.total !== pre.total) {
      throw new Error(`${context}: row count changed (${pre.total} → ${post.total})`);
    }
    if (post.vegAfter !== pre.vegAfter || post.added !== pre.added || post.removed !== pre.removed) {
      throw new Error(
        `${context}: counts mismatch (veg_after ${post.vegAfter}/${pre.vegAfter}, added ${post.added}/${pre.added}, removed ${post.removed}/${pre.removed})`,
      );
    }
    if (post.changes.length !== 0) {
      throw new Error(`${context}: still has ${post.changes.length} pending changes after apply`);
    }
    applied += pre.changes.length;

    const preById = new Map(pre.scope.rows.map((row) => [row.id, row]));
    for (const row of post.scope.rows) {
      const preRow = preById.get(row.id);
      if (!preRow) throw new Error(`${context}: row ${row.id} disappeared`);
      const preTags = parseJsonArray(preRow.scenario_tags, `${post.scope.table}#${row.id} before`);
      const postTags = parseJsonArray(row.scenario_tags, `${post.scope.table}#${row.id} after`);
      assertOnlyVegetarianChanged(preTags, postTags, `${post.scope.table}#${row.id} post-check`);
    }
  }

  if (applied !== expectedApplied) {
    throw new Error(`post-check applied count mismatch (${applied} vs ${expectedApplied})`);
  }
  console.log(`\nPOST-CHECK ok applied=${applied}`);
}

async function main(): Promise<void> {
  if (process.argv.includes("--replace")) {
    console.error("--replace is not accepted: this script only edits the vegetarian tag");
    process.exit(1);
  }

  const apply = process.argv.includes("--apply");
  const database = process.env.DATABASE_URL ?? "postgres://mavisng@localhost:5432/kindcipe_restore_test";
  const sql = postgres(database, { max: 1 });

  try {
    printHeader(apply ? "APPLY" : "DRY-RUN", database);

    if (!apply) {
      await sql`set default_transaction_read_only = on`;
      const summaries = (await loadScopes(sql)).map(summarize);
      for (const summary of summaries) printSummary(summary);
      return;
    }

    await sql.begin(async (tx) => {
      const summaries = (await loadScopes(tx)).map(summarize);
      for (const summary of summaries) printSummary(summary);
      const expected = summaries.reduce((sum, summary) => sum + summary.changes.length, 0);
      const applied = await applyChanges(tx, summaries);
      await postCheck(tx, summaries, expected);
      console.log(`\nAPPLIED updates=${applied}`);
    });
  } catch (error) {
    console.error(`\nROLLBACK: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.includes("recomputeVegetarianTag")) {
  void main();
}
