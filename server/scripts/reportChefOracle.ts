import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runChefTurn } from "../services/chefDomain/turn";
import { loadSeedCatalog } from "../services/chefDomain/catalog";
import { emptyTurnState } from "../services/chefDomain/types";
import type { TurnState } from "../services/chefDomain/types";

type Expect = { exit?: string; served?: number; ai?: number; credits?: number; clarifyReason?: string | null; allowedCards?: string[]; forbiddenCards?: string[] };
type Dialogue = { id: string; turns: string[]; expect?: Record<string, Expect>; classes?: Record<string, string> };
const file = resolve(process.cwd(), process.argv.find((arg) => arg.startsWith("--file="))?.slice(7) ?? "server/fixtures/aiChef/dialogues.jsonl");
const familyId = Number(process.argv.find((arg) => arg.startsWith("--family="))?.slice(9) ?? 5);
const extraArg = process.argv.find((arg) => arg.startsWith("--extra="))?.slice(8);
const extras = extraArg ? resolve(process.cwd(), extraArg) : resolve(process.cwd(), "server/fixtures/aiChef/ask_resolve_ours.jsonl");
const dialogues = readFileSync(file, "utf8").split(/\n+/).filter(Boolean).map((line) => JSON.parse(line) as Dialogue);
try {
  dialogues.push(...readFileSync(extras, "utf8").split(/\n+/).filter(Boolean).map((line) => JSON.parse(line) as Dialogue));
} catch { /* extras are optional */ }
const repo = loadSeedCatalog();
let total = 0, pass = 0;
let resolved = 0, unresolved = 0, abandoned = 0, safety = 0;
const failures: string[] = [];
for (const dialogue of dialogues) {
  let state: TurnState = emptyTurnState();
  const results: Array<{ status: string; names: string[]; reason: string | null; expect?: Expect }> = [];
  for (let i = 0; i < dialogue.turns.length; i++) {
    const result = runChefTurn(state, dialogue.turns[i], repo, familyId);
    state = result.state;
    const expect = dialogue.expect?.[`t${i + 1}`];
    results.push({ status: result.status, names: result.recipes.map((card) => card.name), reason: result.clarifyReason, expect });
    if (!expect) continue;
    total += 1;
    const names = result.recipes.map((card) => card.name);
    const allowed = expect.allowedCards?.length ? names.every((name) => expect.allowedCards!.includes(name)) : true;
    const forbidden = expect.forbiddenCards?.length ? names.every((name) => !expect.forbiddenCards!.includes(name)) : true;
    const ok = (expect.exit == null || expect.exit === result.status)
      && (expect.served == null || expect.served === result.recipes.length)
      && (expect.ai == null || expect.ai === result.ai)
      && (expect.credits == null || expect.credits === result.credits)
      && (expect.clarifyReason == null || expect.clarifyReason === result.clarifyReason)
      && allowed && forbidden;
    if (ok) pass += 1;
    else failures.push(`${dialogue.id}/${dialogue.turns[i]} actual=${result.status}/${result.recipes.length} expected=${JSON.stringify(expect)}`);
  }
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const expected = r.expect;
    if (!expected || expected.exit !== "ask") continue;
    if (dialogue.classes?.[`t${i + 1}`] === "safety" || expected.clarifyReason === "safety") { safety += 1; continue; }
    if (i + 1 >= results.length) abandoned += 1;
    const next = results.slice(i + 1, i + 4);
    const cards = next.flatMap((item) => item.names);
    const allowed = expected.allowedCards ?? [];
    const resolvedByAllowed = allowed.length > 0 && cards.some((name) => allowed.includes(name));
    if (resolvedByAllowed) resolved += 1; else unresolved += 1;
  }
}
console.log(JSON.stringify({ pass, total, fail: total - pass, failures, askResolution_ux: { resolved, unresolved, abandoned, safety, denominator: resolved + unresolved } }, null, 2));
if (pass !== total) process.exitCode = 1;
