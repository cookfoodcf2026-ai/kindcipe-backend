import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadSeedCatalog } from "../services/chefDomain/catalog";
import { emptyTurnState } from "../services/chefDomain/types";
import { runChefTurn } from "../services/chefDomain/turn";
import type { TurnState } from "../services/chefDomain/types";

type Expect = {
  exit?: "cards" | "ask" | "text";
  clarifyReason?: string | null;
  served?: number;
  ai?: number;
  credits?: number;
  allowedCards?: string[];
  forbiddenCards?: string[];
};

type EvalCase = {
  id: string;
  gapClass?: string;
  turns: string[];
  expect?: Record<string, Expect>;
};

type Failure = {
  file: string;
  id: string;
  gapClass: string;
  query: string;
  expect: Expect;
  actual: {
    exit: string;
    clarifyReason: string | null;
    served: number;
    ai: number;
    credits: number;
    cards: string[];
  };
};

const dirArg = process.argv.find((arg) => arg.startsWith("--dir="))?.slice(6);
const familyArg = process.argv.find((arg) => arg.startsWith("--family="))?.slice(9);
const dir = resolve(process.cwd(), dirArg ?? "server/fixtures/aiChef/eval");
const familyId = Number(familyArg ?? 5);
const repo = loadSeedCatalog();

const files = readdirSync(dir).filter((name) => name.endsWith(".jsonl")).sort();
const failures: Failure[] = [];
const byGapClass: Record<string, { total: number; pass: number }> = {};
let total = 0;
let pass = 0;

function has(obj: Expect, key: keyof Expect): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function record(group: string, ok: boolean): void {
  const item = byGapClass[group] ?? { total: 0, pass: 0 };
  item.total += 1;
  if (ok) item.pass += 1;
  byGapClass[group] = item;
}

for (const file of files) {
  const cases = readFileSync(resolve(dir, file), "utf8")
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EvalCase);

  for (const testCase of cases) {
    let state: TurnState = emptyTurnState();
    for (let i = 0; i < testCase.turns.length; i++) {
      const query = testCase.turns[i];
      const result = runChefTurn(state, query, repo, familyId);
      state = result.state;
      const expect = testCase.expect?.[`t${i + 1}`];
      if (!expect) continue;

      total += 1;
      const names = result.recipes.map((card) => card.name);
      const allowed = expect.allowedCards?.length ? names.every((name) => expect.allowedCards!.includes(name)) : true;
      const forbidden = expect.forbiddenCards?.length ? names.every((name) => !expect.forbiddenCards!.includes(name)) : true;
      const ok = (expect.exit == null || expect.exit === result.status)
        && (expect.served == null || expect.served === result.recipes.length)
        && (expect.ai == null || expect.ai === result.ai)
        && (expect.credits == null || expect.credits === result.credits)
        && (!has(expect, "clarifyReason") || expect.clarifyReason === result.clarifyReason)
        && allowed
        && forbidden;

      record(testCase.gapClass ?? "uncategorized", ok);
      if (ok) {
        pass += 1;
      } else {
        failures.push({
          file,
          id: testCase.id,
          gapClass: testCase.gapClass ?? "uncategorized",
          query,
          expect,
          actual: {
            exit: result.status,
            clarifyReason: result.clarifyReason,
            served: result.recipes.length,
            ai: result.ai,
            credits: result.credits,
            cards: names,
          },
        });
      }
    }
  }
}

console.log(JSON.stringify({
  dir,
  files,
  total,
  pass,
  fail: total - pass,
  passRate: total === 0 ? 0 : Number((pass / total).toFixed(4)),
  byGapClass,
  failures,
}, null, 2));
if (pass !== total) process.exitCode = 1;
