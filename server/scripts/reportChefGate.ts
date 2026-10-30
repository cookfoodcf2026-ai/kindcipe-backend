import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runChefTurn } from "../services/chefDomain/turn";
import { FakeRepository } from "../services/chefDomain/repository";
import { loadSeedCatalog } from "../services/chefDomain/catalog";
import { emptyTurnState } from "../services/chefDomain/types";
import { claimsRecipeCards } from "../services/chefResponse";
import { shouldChargeChefRequest } from "../services/aiChefPolicy";
import type { QueryPlan, RecipeCard, TurnResult, TurnState } from "../services/chefDomain/types";

type Expect = {
  exit?: string;
  served?: number;
  ai?: number;
  credits?: number;
  clarifyReason?: string | null;
  allowedCards?: string[];
  forbiddenCards?: string[];
};
type Dialogue = {
  id: string;
  turns: string[];
  expect?: Record<string, Expect>;
  classes?: Record<string, string>;
};
type HardCase = {
  id: string;
  kind: "safety" | "avoid" | "zero_card";
  turns: string[];
  expectReason?: string;
  avoidTerms?: string[];
};
type GatePolicy = {
  version: string;
  lifeDeath: { rule: string; hardInvariants: Array<{ id: string; description: string }> };
  trend: {
    askResolution: {
      blocking: boolean;
      target: number;
      minResolvable: number;
      denominator: string;
    };
  };
  frozenInputs: Record<string, string>;
};

const ROOT = process.cwd();
const FIXTURES = resolve(ROOT, "server/fixtures/aiChef");
const policy = readJson<GatePolicy>(resolve(FIXTURES, "gate_policy.json"));
const hard = readJson<{ version: string; cases: HardCase[] }>(resolve(FIXTURES, "hard_invariants.json"));
const repo = loadSeedCatalog();

type Violation = { invariant: string; caseId: string; detail: string };

const violations: Violation[] = [];
const invariantCounts: Record<string, number> = {};

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(resolve(ROOT, file))).digest("hex");
}

function count(invariant: string): void {
  invariantCounts[invariant] = (invariantCounts[invariant] ?? 0) + 1;
}

function violate(invariant: string, caseId: string, detail: string): void {
  count(invariant);
  violations.push({ invariant, caseId, detail });
}

function runDialogue(dialogue: Dialogue, familyId = 5): Array<{ result: TurnResult; expect?: Expect }> {
  let state: TurnState = emptyTurnState();
  return dialogue.turns.map((turn, index) => {
    const result = runChefTurn(state, turn, repo, familyId);
    state = result.state;
    return { result, expect: dialogue.expect?.[`t${index + 1}`] };
  });
}

function loadDialogues(): Dialogue[] {
  const files = ["dialogues.jsonl", "ask_resolve_ours.jsonl"];
  return files.flatMap((name) =>
    readFileSync(resolve(FIXTURES, name), "utf8")
      .split(/\n+/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Dialogue),
  );
}

function checkTurnInvariants(caseId: string, result: TurnResult): void {
  const served = result.recipes.length;
  const aiCards = result.ai;

  if (served === 0 && result.credits !== 0) {
    violate("zero_card_charge", caseId, `served=0 but credits=${result.credits}`);
  }
  if (served === 0 && claimsRecipeCards(result.text)) {
    violate("zero_card_promise", caseId, `served=0 but text promises cards: ${result.text}`);
  }
  if (aiCards > served) {
    violate("ai_credit_mismatch", caseId, `aiCards=${aiCards} exceeds served=${served}`);
  }
  const expectedCredits = shouldChargeChefRequest({ served, aiCards }) ? 1 : 0;
  if (result.credits !== expectedCredits) {
    violate(
      "ai_credit_mismatch",
      caseId,
      `served=${served} aiCards=${aiCards} expectedCredits=${expectedCredits} actual=${result.credits}`,
    );
  }
}

function checkSafetyCase(testCase: HardCase): void {
  const results = runDialogue({ id: testCase.id, turns: testCase.turns });
  const last = results[results.length - 1].result;
  if (last.recipes.length !== 0) {
    violate("safety", testCase.id, `served=${last.recipes.length} cards on safety input`);
  }
  if (last.clarifyReason !== (testCase.expectReason ?? "safety")) {
    violate("safety", testCase.id, `clarifyReason=${String(last.clarifyReason)} expected=safety`);
  }
  if (last.credits !== 0) {
    violate("safety", testCase.id, `credits=${last.credits} expected=0`);
  }
  if (claimsRecipeCards(last.text)) {
    violate("safety", testCase.id, `safety text promises cards: ${last.text}`);
  }
  for (const { result } of results) checkTurnInvariants(testCase.id, result);
}

function checkAvoidCase(testCase: HardCase): void {
  const results = runDialogue({ id: testCase.id, turns: testCase.turns });
  const last = results[results.length - 1].result;
  if (last.recipes.length === 0) {
    violate("avoid_ingredients", testCase.id, "follow-up served 0 cards; cannot verify avoid filter");
    return;
  }
  const terms = testCase.avoidTerms ?? [];
  for (const card of last.recipes) {
    const haystack = `${card.name} ${card.ingredients.join(" ")}`;
    for (const term of terms) {
      if (haystack.includes(term)) {
        violate("avoid_ingredients", testCase.id, `card "${card.name}" contains avoided term "${term}"`);
      }
    }
  }
  for (const { result } of results) checkTurnInvariants(testCase.id, result);
}

function checkZeroCardCase(testCase: HardCase): void {
  const results = runDialogue({ id: testCase.id, turns: testCase.turns });
  const last = results[results.length - 1].result;
  if (last.recipes.length !== 0) {
    violate("zero_card_charge", testCase.id, `served=${last.recipes.length} expected=0`);
  }
  if (last.credits !== 0) {
    violate("zero_card_charge", testCase.id, `credits=${last.credits} expected=0`);
  }
  if (claimsRecipeCards(last.text)) {
    violate("zero_card_promise", testCase.id, `zero-card text promises cards: ${last.text}`);
  }
  for (const { result } of results) checkTurnInvariants(testCase.id, result);
}

function checkReplayArithmetic(): void {
  // record-30 covers every replay turn. Source/credit arithmetic and zero-card
  // copy must both be internally consistent; no turn is excluded.
  const rows = readFileSync(resolve(FIXTURES, "record-30.jsonl"), "utf8")
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as {
      id: string;
      turn: string;
      exit: string;
      served: number;
      lib: number;
      ai: number;
      credits: number;
      replyText?: string;
    });
  for (const row of rows) {
    const caseId = `record/${row.id}/${row.turn}`;
    if (row.served === 0 && claimsRecipeCards(row.replyText ?? "")) {
      violate("zero_card_promise", caseId, `zero-card text promises cards: ${row.replyText}`);
    }
    if (row.ai > row.served) {
      violate("ai_credit_mismatch", caseId, `ai=${row.ai} exceeds served=${row.served}`);
    }
    const expectedCredits = shouldChargeChefRequest({ served: row.served, aiCards: row.ai }) ? 1 : 0;
    if (row.credits !== expectedCredits) {
      violate(
        "ai_credit_mismatch",
        caseId,
        `served=${row.served} ai=${row.ai} expectedCredits=${expectedCredits} actual=${row.credits}`,
      );
    }
    if ((row.exit === "cards" || row.exit === "partial_cards") && row.lib + row.ai !== row.served) {
      violate("ai_credit_mismatch", caseId, `sourceTotal=${row.lib + row.ai} served=${row.served}`);
    }
  }
}

function checkPrivateIsolation(): void {
  const plan: QueryPlan = { dishTypes: ["meat"], scenarios: [], tags: [], avoid: [], text: "" };
  const synthetic = new FakeRepository([
    card("iso-own", "iso own", "private", 5, ["iso"]),
    card("iso-other", "iso other", "private", 6, ["iso"]),
    card("iso-public", "iso public", "public", 0, ["iso"]),
  ]);
  const visible = new Map<string, string[]>();
  visible.set("search", synthetic.search(plan, 5).map((row) => row.id));
  visible.set("byNames", synthetic.byNames(["iso own", "iso other", "iso public"], 5).map((row) => row.id));
  visible.set("byFacets", synthetic.byFacets(["iso"], 5, ["meat"]).map((row) => row.id));

  for (const [method, ids] of visible) {
    if (ids.includes("iso-other")) {
      violate("private_isolation", `synthetic/${method}`, "family 5 can see family 6 private recipe");
    }
    if (!ids.includes("iso-own")) {
      violate("private_isolation", `synthetic/${method}`, "family 5 cannot see its own private recipe");
    }
  }

  const allPlan: QueryPlan = { dishTypes: [], scenarios: [], tags: [], avoid: [], text: "" };
  for (const familyId of [5, 6, 7]) {
    const rows = repo.search(allPlan, familyId);
    for (const row of rows) {
      if (row.visibility === "private" && row.familyId !== familyId) {
        violate("private_isolation", `catalog/family-${familyId}`, `sees private recipe ${row.id} owned by family ${row.familyId}`);
      }
    }
  }
}

function card(
  id: string,
  name: string,
  visibility: RecipeCard["visibility"],
  familyId: number,
  facets: string[],
): RecipeCard {
  return {
    id,
    name,
    dishType: "meat",
    ingredients: ["水"],
    tags: [],
    facets,
    cookTime: 10,
    visibility,
    familyId,
  };
}

function computeAskResolution(dialogues: Dialogue[]): {
  resolved: number;
  unresolved: number;
  abandoned: number;
  safety: number;
  denominator: number;
  rate: number;
  target: number;
  minResolvable: number;
  comparable: boolean;
  blocking: false;
} {
  let resolved = 0;
  let unresolved = 0;
  let abandoned = 0;
  let safety = 0;

  for (const dialogue of dialogues) {
    const results = runDialogue(dialogue);
    for (let i = 0; i < results.length; i++) {
      const expected = results[i].expect;
      if (!expected || expected.exit !== "ask") continue;
      if (dialogue.classes?.[`t${i + 1}`] === "safety" || expected.clarifyReason === "safety") {
        safety += 1;
        continue;
      }
      if (i + 1 >= results.length) {
        abandoned += 1;
        continue;
      }
      const allowed = expected.allowedCards ?? [];
      if (allowed.length === 0) {
        abandoned += 1;
        continue;
      }
      const next = results.slice(i + 1, i + 4);
      const names = next.flatMap((item) => item.result.recipes.map((recipe) => recipe.name));
      if (names.length > 0 && names.every((name) => allowed.includes(name))) resolved += 1;
      else unresolved += 1;
    }
  }

  const denominator = resolved + unresolved;
  return {
    resolved,
    unresolved,
    abandoned,
    safety,
    denominator,
    rate: denominator === 0 ? 0 : Number((resolved / denominator).toFixed(4)),
    target: policy.trend.askResolution.target,
    minResolvable: policy.trend.askResolution.minResolvable,
    comparable: denominator >= policy.trend.askResolution.minResolvable,
    blocking: false,
  };
}

function checkFrozenInputs(): { status: "match" | "drift"; files: Array<{ file: string; expected: string; actual: string }>; changed: string[] } {
  const files = Object.entries(policy.frozenInputs).map(([file, expected]) => ({
    file,
    expected,
    actual: sha256(file),
  }));
  const changed = files.filter((item) => item.expected !== item.actual).map((item) => item.file);
  return { status: changed.length === 0 ? "match" : "drift", files, changed };
}

const dialogues = loadDialogues();
for (const dialogue of dialogues) {
  for (const { result } of runDialogue(dialogue)) checkTurnInvariants(dialogue.id, result);
}
for (const testCase of hard.cases) {
  if (testCase.kind === "safety") checkSafetyCase(testCase);
  else if (testCase.kind === "avoid") checkAvoidCase(testCase);
  else checkZeroCardCase(testCase);
}
checkPrivateIsolation();
checkReplayArithmetic();

const hardInvariantDiff = violations.length;
const report = {
  gate: policy.version,
  blocking: policy.lifeDeath.rule,
  hardInvariantDiff,
  hardInvariants: policy.lifeDeath.hardInvariants.map((invariant) => ({
    id: invariant.id,
    violations: invariantCounts[invariant.id] ?? 0,
  })),
  violations,
  askResolution: computeAskResolution(dialogues),
  frozenPool: checkFrozenInputs(),
};

console.log(JSON.stringify(report, null, 2));
if (hardInvariantDiff > 0) process.exitCode = 1;
