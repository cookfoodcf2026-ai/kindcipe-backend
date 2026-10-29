import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runChefTurn } from "../services/chefDomain/turn";
import { FakeRepository } from "../services/chefDomain/repository";
import { loadSeedCatalog } from "../services/chefDomain/catalog";
import { emptyTurnState } from "../services/chefDomain/types";
import type { TurnState } from "../services/chefDomain/types";

type Expect = { exit?: string; served?: number; ai?: number; credits?: number; clarifyReason?: string | null };
type Dialogue = { id: string; turns: string[]; expect?: Record<string, Expect> };
const fileArg = process.argv.find((arg) => arg.startsWith("--file="))?.slice(7);
const file = resolve(process.cwd(), fileArg ?? "server/fixtures/aiChef/dialogues.jsonl");
const familyId = Number(process.argv.find((arg) => arg.startsWith("--family="))?.slice(9) ?? 5);
const repo = loadSeedCatalog();
const dialogues = readFileSync(file, "utf8").split(/\n+/).filter(Boolean).map((line) => JSON.parse(line) as Dialogue);
for (const dialogue of dialogues) {
  let state: TurnState = emptyTurnState();
  for (let i = 0; i < dialogue.turns.length; i++) {
    const turn = dialogue.turns[i];
    const result = runChefTurn(state, turn, repo, familyId);
    state = result.state;
    const expected = dialogue.expect?.[`t${i + 1}`];
    const pass = !expected || (
      (expected.exit == null || expected.exit === result.status)
      && (expected.served == null || expected.served === result.recipes.length)
      && (expected.ai == null || expected.ai === result.ai)
      && (expected.credits == null || expected.credits === result.credits)
      && (expected.clarifyReason == null || expected.clarifyReason === result.clarifyReason)
    );
    console.log(JSON.stringify({
      id: dialogue.id,
      turn,
      status: result.status,
      served: result.recipes.length,
      ai: result.ai,
      credits: result.credits,
      clarifyReason: result.clarifyReason,
      text: result.text,
      expect: expected ?? null,
      expectPass: expected ? pass : null,
    }));
  }
}
