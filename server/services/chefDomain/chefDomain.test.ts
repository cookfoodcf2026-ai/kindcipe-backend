import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runChefTurn } from "./turn";
import { FakeRepository } from "./repository";
import { loadSeedCatalog } from "./catalog";
import { emptyTurnState } from "./types";
import type { TurnState } from "./types";

const repo = loadSeedCatalog();

function runDialogue(turns: string[], familyId = 5) {
  let state: TurnState = emptyTurnState();
  return turns.map((turn) => {
    const result = runChefTurn(state, turn, repo, familyId);
    state = result.state;
    return result;
  });
}

test("c01 deterministic cards and zero AI/credits", () => {
  const [first, second, third] = runDialogue(["三送一湯", "再一套", "唔要湯"]);
  assert.equal(first.status, "cards");
  assert.equal(first.recipes.length, 4);
  assert.equal(second.recipes.length, 4);
  assert.equal(third.recipes.length, 3);
  for (const result of [first, second, third]) {
    assert.equal(result.ai, 0);
    assert.equal(result.credits, 0);
  }
});

test("safety, non-food, and private family isolation", () => {
  const allergy = runChefTurn(emptyTurnState(), "我海鮮敏感，想食魚", repo, 5);
  assert.equal(allergy.status, "ask");
  assert.equal(allergy.recipes.length, 0);
  assert.equal(allergy.clarifyReason, "safety");
  assert.equal(allergy.credits, 0);
  assert.equal(allergy.recipes.length, 0);

  const booking = runChefTurn(emptyTurnState(), "幫我訂機票去東京", repo, 5);
  assert.equal(booking.status, "text");
  assert.equal(booking.recipes.length, 0);
  assert.equal(booking.credits, 0);
  assert.doesNotMatch(booking.text, /卡片|已準備|已出卡/);

  const familyA = repo.search({ dishTypes: [], scenarios: [], tags: [], avoid: [], text: "" }, 5);
  const privateIds = familyA.filter((card) => card.visibility === "private").map((card) => card.id);
  assert.ok(privateIds.length > 0);
  const familyB = repo.search({ dishTypes: [], scenarios: [], tags: [], avoid: [], text: "" }, 6);
  assert.equal(familyB.some((card) => privateIds.includes(card.id)), false);
});

test("avoid filter prevents excluded ingredients", () => {
  const repoWithChicken = new FakeRepository([
    { id: "chicken", name: "chicken", dishType: "meat", ingredients: ["雞"], tags: [], cookTime: 10, visibility: "official", familyId: 0 },
    { id: "tofu", name: "tofu", dishType: "vegetable", ingredients: ["豆腐"], tags: [], cookTime: 10, visibility: "official", familyId: 0 },
  ]);
  const result = runChefTurn(emptyTurnState(), "唔要雞，想食菜", repoWithChicken, 5);
  assert.equal(result.recipes.some((card) => card.ingredients.includes("雞")), false);
  assert.equal(result.credits, 0);
});

test("30 fixtures are deterministic across two isolated runs", () => {
  const file = resolve(process.cwd(), "server/fixtures/aiChef/dialogues.jsonl");
  const dialogues = readFileSync(file, "utf8").split(/\n+/).filter(Boolean).map((line) => JSON.parse(line) as { id: string; turns: string[] });
  for (const dialogue of dialogues) {
    const a = runDialogue(dialogue.turns).map((result) => ({ status: result.status, served: result.recipes.length, ai: result.ai, credits: result.credits, text: result.text }));
    const b = runDialogue(dialogue.turns).map((result) => ({ status: result.status, served: result.recipes.length, ai: result.ai, credits: result.credits, text: result.text }));
    assert.deepEqual(a, b, dialogue.id);
  }
});

test("hidden A can run in isolation and is deterministic", () => {
  const hidden = resolve(process.cwd(), "../hidden_A.jsonl");
  const dialogues = readFileSync(hidden, "utf8").split(/\n+/).filter(Boolean).map((line) => JSON.parse(line) as { id: string; turns: string[] });
  assert.equal(dialogues.length, 10);
  for (const dialogue of dialogues) {
    const a = runDialogue(dialogue.turns, 5);
    const b = runDialogue(dialogue.turns, 5);
    assert.equal(a.length, b.length, dialogue.id);
    assert.deepEqual(a.map((r) => [r.status, r.recipes.length, r.ai, r.credits]), b.map((r) => [r.status, r.recipes.length, r.ai, r.credits]));
  }
});
