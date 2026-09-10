import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "..", "drizzle", "migrations");

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });

// 已 apply 嘅 migration 名（用 schema_migrations 表記住，令 script 可重現 + idempotent）
async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamp DEFAULT now() NOT NULL
    )
  `;
}

async function appliedNames() {
  const rows = await sql`SELECT name FROM schema_migrations`;
  return new Set(rows.map((r) => r.name));
}

// 過濾「重複建立/重複欄位」呢類已存在錯誤，令 script 對已有 schema 都安全（idempotent）
function isAlreadyExistsError(msg) {
  return /already exists|duplicate column|duplicate key|42P07|42701|42710/i.test(msg || "");
}

async function main() {
  await ensureTable();
  const applied = await appliedNames();
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let ran = 0;
  for (const file of files) {
    const name = file.replace(/\.sql$/, "");
    if (applied.has(name)) continue;
    const content = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    // drizzle 用 `--> statement-breakpoint` 分隔 statements
    const statements = content.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
    let ok = true;
    for (const stmt of statements) {
      try {
        await sql.unsafe(stmt);
      } catch (e) {
        if (isAlreadyExistsError(String(e?.message || e))) continue; // 已存在 → 安全跳過
        console.error(`[db:migrate] FAILED on ${name}: ${e?.message}`);
        ok = false;
        break;
      }
    }
    if (ok) {
      await sql`INSERT INTO schema_migrations (name) VALUES (${name}) ON CONFLICT DO NOTHING`;
      console.log(`[db:migrate] ✅ ${name}`);
      ran++;
    }
  }
  console.log(`[db:migrate] 完成。新 apply: ${ran}`);
  await sql.end();
}

main().catch(async (e) => {
  console.error("[db:migrate] ERROR:", e?.message || e);
  await sql.end().catch(() => {});
  process.exit(1);
});
