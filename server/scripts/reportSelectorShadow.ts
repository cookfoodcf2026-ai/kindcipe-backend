/**
 * Read the local selector shadow log (JSONL) and report overlap / diversity /
 * exhausted counts. No DB, no network, no writes.
 *
 * Run: npx tsx server/scripts/reportSelectorShadow.ts [path]
 * Default path: $AI_CHEF_SELECTOR_SHADOW_LOG or ./logs/selector-shadow.jsonl
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

type ShadowLine = {
  ts?: string;
  path?: string;
  reason?: "ok" | "exhausted";
  overlapRatio?: number;
  distinctRatio?: number;
  poolSize?: number;
  newPickedIds?: string[];
  legacyPickedIds?: string[];
};

function logPath(): string {
  return process.argv[2] || process.env.AI_CHEF_SELECTOR_SHADOW_LOG || join(process.cwd(), "logs", "selector-shadow.jsonl");
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function main(): void {
  const file = logPath();
  let raw = "";
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    console.error(`[selector-shadow] cannot read ${file}: ${(error as Error)?.message}`);
    process.exit(1);
  }

  const lines: ShadowLine[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      lines.push(JSON.parse(trimmed) as ShadowLine);
    } catch {
      console.warn(`[selector-shadow] skip malformed line: ${trimmed.slice(0, 120)}`);
    }
  }

  if (lines.length === 0) {
    console.log(`[selector-shadow] no rows in ${file}`);
    return;
  }

  const byPath = new Map<string, ShadowLine[]>();
  for (const row of lines) {
    const key = row.path ?? "(unknown)";
    const bucket = byPath.get(key) ?? [];
    bucket.push(row);
    byPath.set(key, bucket);
  }

  const summary = {
    file,
    rows: lines.length,
    avgOverlapRatio: Number(mean(lines.map((row) => Number(row.overlapRatio ?? 0))).toFixed(4)),
    avgDistinctRatio: Number(mean(lines.map((row) => Number(row.distinctRatio ?? 0))).toFixed(4)),
    exhaustedCount: lines.filter((row) => row.reason === "exhausted").length,
    avgPoolSize: Number(mean(lines.map((row) => Number(row.poolSize ?? 0))).toFixed(2)),
    byPath: [...byPath.entries()].map(([path, rows]) => ({
      path,
      rows: rows.length,
      avgOverlapRatio: Number(mean(rows.map((row) => Number(row.overlapRatio ?? 0))).toFixed(4)),
      avgDistinctRatio: Number(mean(rows.map((row) => Number(row.distinctRatio ?? 0))).toFixed(4)),
      exhaustedCount: rows.filter((row) => row.reason === "exhausted").length,
    })),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main();
