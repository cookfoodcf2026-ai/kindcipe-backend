import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rows = readFileSync(resolve(process.cwd(), "server/fixtures/aiChef/dialogues.jsonl"), "utf8")
  .split(/\n+/)
  .filter(Boolean)
  .map((line) => JSON.parse(line) as { id: string; turns: string[]; scores: Record<string, unknown> });

test("dialogue fixture has 30 unique cases", () => {
  assert.equal(rows.length, 30);
  assert.equal(new Set(rows.map((row) => row.id)).size, 30);
  assert.ok(rows.every((row) => row.turns.length >= 1 && row.turns.length <= 6));
  assert.ok(rows.every((row) => row.turns.every((turn) => typeof turn === "string" && turn.trim().length > 0)));
});

test("dialogue fixture has the four score fields", () => {
  const keys = ["understand", "natural", "ask", "coherent"];
  for (const row of rows) {
    assert.deepEqual(Object.keys(row.scores).sort(), keys.sort());
  }
});
