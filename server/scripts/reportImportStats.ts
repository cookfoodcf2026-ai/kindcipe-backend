import { readFileSync } from "node:fs";

type Event = {
  event?: string;
  source?: string;
  result?: string;
  hasCaption?: boolean;
  captionChars?: number;
  hasIngredients?: boolean;
  ingredientCount?: number;
  stepCount?: number;
  stepsSource?: string;
  stageMs?: Record<string, number>;
  familyId?: number;
};

const file = process.argv[2] && process.argv[2] !== "-" ? process.argv[2] : "";
const raw = file ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
const events: Event[] = [];
for (const line of raw.split(/\r?\n/)) {
  const start = line.indexOf("{");
  if (start < 0) continue;
  try {
    const parsed = JSON.parse(line.slice(start));
    if (parsed?.event === "import_parse") events.push(parsed);
  } catch { /* ignore non-JSON log lines */ }
}
const group = new Map<string, Record<string, number>>();
for (const event of events) {
  const source = String(event.source ?? "unknown");
  const result = String(event.result ?? "unknown");
  if (!group.has(source)) group.set(source, {});
  const row = group.get(source)!;
  row[result] = (row[result] ?? 0) + 1;
  row.total = (row.total ?? 0) + 1;
}
console.log(`import_parse events: ${events.length}`);
for (const [source, counts] of [...group.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const total = counts.total ?? 0;
  const pct = (n: number) => total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "0.0%";
  const parts = Object.entries(counts)
    .filter(([key]) => key !== "total")
    .sort(([, a], [, b]) => b - a)
    .map(([key, value]) => `${key}=${value} (${pct(value)})`)
    .join(" ");
  console.log(`${source}: total=${total} ${parts}`);
}
