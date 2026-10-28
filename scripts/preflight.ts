import postgres from "postgres";

type Check = { ok: boolean; value?: string; error?: string };
type Result = {
  target: "railway";
  database: string;
  migration: string;
  tables: Record<string, Check>;
  columns: Record<string, Check>;
  health: number | null;
  ok: boolean;
  errors: string[];
};

const BASE_TABLES = [
  "llm_cost_events",
  "llm_cost_monthly",
  "llm_budget_reservations",
  "ai_chef_flags",
] as const;
const MIGRATION_0047_TABLES = ["ai_chef_requests"] as const;
const MIGRATION_0047_INDEXES = ["ai_chef_requests_family_chat_client_message_unique"] as const;
const REQUIRED_COLUMNS = [
  { table: "family_usage_monthly", column: "llm_reserved_micros" },
] as const;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function fail(errors: string[], result?: Partial<Result>): never {
  console.error(JSON.stringify({ ...result, ok: false, errors }, null, 2));
  process.exit(1);
}

const urlValue = process.env.DATABASE_URL;
if (!urlValue) fail(["DATABASE_URL missing"]);
const url = new URL(urlValue);
const database = url.pathname.replace(/^\//, "");
const target: "railway" = "railway";

if (url.hostname.toLowerCase().includes("supabase")) {
  fail([`Refusing Supabase target (${url.hostname}); Railway is canonical`]);
}
if (database !== "railway") {
  fail([`Refusing database "${database}"; expected "railway"`]);
}

const migration = arg("--migration", "0046_ai_chef_cost_safety");
const port = process.env.PORT ?? "8080";
const requiredTables = migration.startsWith("0047_")
  ? [...BASE_TABLES, ...MIGRATION_0047_TABLES]
  : [...BASE_TABLES];
const requiredIndexes = migration.startsWith("0047_") ? [...MIGRATION_0047_INDEXES] : [];
const result: Result & { indexes?: Record<string, Check> } = {
  target,
  database,
  migration,
  tables: {},
  columns: {},
  indexes: {},
  health: null,
  ok: false,
  errors: [],
};

try {
  const sql = postgres(urlValue, { ssl: "require", max: 1, connect_timeout: 10 });
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe("SET TRANSACTION READ ONLY");
      const [migrationRow] = await tx`select name from schema_migrations where name = ${migration} limit 1`;
      if (!migrationRow) result.errors.push(`missing migration: ${migration}`);
      const tableRows = await tx`select table_name from information_schema.tables where table_schema='public' and table_name in ${tx(requiredTables)}`;
      const presentTables = new Set(tableRows.map((r: any) => String(r.table_name)));
      for (const table of requiredTables) {
        const ok = presentTables.has(table);
        result.tables[table] = { ok };
        if (!ok) result.errors.push(`missing table: ${table}`);
      }
      for (const { table, column } of REQUIRED_COLUMNS) {
        const [columnRow] = await tx`select column_name from information_schema.columns where table_schema='public' and table_name=${table} and column_name=${column} limit 1`;
        const ok = Boolean(columnRow);
        result.columns[`${table}.${column}`] = { ok };
        if (!ok) result.errors.push(`missing column: ${table}.${column}`);
      }
      if (requiredIndexes.length > 0) {
        const indexRows = await tx`select indexname from pg_indexes where schemaname='public' and indexname in ${tx(requiredIndexes)}`;
        const presentIndexes = new Set(indexRows.map((r: any) => String(r.indexname)));
        for (const index of requiredIndexes) {
          const ok = presentIndexes.has(index);
          result.indexes![index] = { ok };
          if (!ok) result.errors.push(`missing index: ${index}`);
        }
      }
      const [dbRow] = await tx`select current_database() as db`;
      result.database = String(dbRow?.db ?? database);
      if (result.database !== "railway") result.errors.push(`connected database is "${result.database}", expected "railway"`);
    });
  } finally {
    await sql.end({ timeout: 3 }).catch(() => {});
  }

  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(5000) });
    result.health = response.status;
    if (response.status !== 200) result.errors.push(`health returned ${response.status}, expected 200`);
  } catch (error) {
    result.health = null;
    result.errors.push(`health check failed: ${(error as Error)?.message || error}`);
  }

  result.ok = result.errors.length === 0;
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  fail([`preflight failed: ${(error as Error)?.message || error}`], result);
}
