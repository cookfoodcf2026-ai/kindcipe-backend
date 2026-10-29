import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runChefTurn } from "../services/chefDomain/turn";
import { loadSeedCatalog } from "../services/chefDomain/catalog";
import { emptyTurnState } from "../services/chefDomain/types";
import type { TurnState } from "../services/chefDomain/types";

type Expect = { exit?: string; served?: number; ai?: number; credits?: number; clarifyReason?: string | null };
type Dialogue = { id: string; turns: string[]; classes?: Record<string, string>; expect?: Record<string, Expect> };
const file = resolve(process.cwd(), process.argv.find((arg) => arg.startsWith("--file="))?.slice(7) ?? "server/fixtures/aiChef/dialogues.jsonl");
const familyId = Number(process.argv.find((arg) => arg.startsWith("--family="))?.slice(9) ?? 5);
const repo = loadSeedCatalog();
const dialogues = readFileSync(file, "utf8").split(/\n+/).filter(Boolean).map((line) => JSON.parse(line) as Dialogue);
let pass = 0, total = 0, safety = 0, resolved = 0, unresolved = 0, abandoned = 0, wrong = 0;
for (const dialogue of dialogues) {
  let state: TurnState = emptyTurnState();
  const results: Array<{ status: string; served: number; clarifyReason: string | null; class: string; expectPass: boolean | null }> = [];
  for (let i = 0; i < dialogue.turns.length; i++) {
    const result = runChefTurn(state, dialogue.turns[i], repo, familyId);
    state = result.state;
    const key = `t${i + 1}`;
    const expected = dialogue.expect?.[key];
    const ok = !expected || (
      (expected.exit == null || expected.exit === result.status)
      && (expected.served == null || expected.served === result.recipes.length)
      && (expected.ai == null || expected.ai === result.ai)
      && (expected.credits == null || expected.credits === result.credits)
      && (expected.clarifyReason == null || expected.clarifyReason === result.clarifyReason)
    );
    if (expected) { total += 1; if (ok) pass += 1; }
    results.push({ status: result.status, served: result.recipes.length, clarifyReason: result.clarifyReason, class: dialogue.classes?.[key] ?? "unknown", expectPass: expected ? ok : null });
  }
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status !== "ask") continue;
    if (r.class === "safety" || r.clarifyReason === "safety") { safety += 1; continue; }
    if (i + 1 >= results.length) { abandoned += 1; continue; }
    const next = results.slice(i + 1, i + 4);
    if (next.some((x) => x.served > 0)) resolved += 1; else unresolved += 1;
  }
}
console.log(JSON.stringify({
  file, familyId, oracle: { pass, total, passRate: total ? pass / total : 0 },
  askResolution_ux: { resolved, unresolved, abandoned, safety, rate: resolved + unresolved ? resolved / (resolved + unresolved) : 0 },
}, null, 2));
