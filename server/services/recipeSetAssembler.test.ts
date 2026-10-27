import assert from "node:assert/strict";
import test from "node:test";
import { assembleRecipeSet, type RecipeCandidate } from "./recipeSetAssembler";
import type { RequestedRole } from "./chefIntent";

type R = { name: string; kind: RequestedRole; steps: number };

const rec = (name: string, kind: RequestedRole, steps = 5): R => ({ name, kind, steps });
const c = (recipe: R): RecipeCandidate<R> => ({ recipe, role: recipe.kind, source: "library" });
const valid = (r: R, role: RequestedRole) => {
  if (role === "any") return r.kind !== "soup" && r.kind !== "dessert";
  return r.kind === role && r.steps >= (role === "dessert" ? 4 : 5);
};

test("library fills one meat and one dessert", async () => {
  const result = await assembleRecipeSet<R>(
    { total: 2, roles: ["meat", "dessert"] },
    {
      pickLibrary: async (role) => role === "meat" ? [c(rec("Beef", "meat"))] : [c(rec("Mango", "dessert", 4))],
      generate: async () => [],
      validate: valid,
      nameOf: (r) => r.name,
    },
  );
  assert.deepEqual(result.cards.map((r) => r.name), ["Beef", "Mango"]);
  assert.equal(result.served, 2);
  assert.deepEqual(result.missingRoles, []);
  assert.deepEqual(result.sources, { library: 2, ai: 0 });
});

test("AI fills a missing role and library is not duplicated", async () => {
  const result = await assembleRecipeSet<R>(
    { total: 2, roles: ["meat", "dessert"] },
    {
      pickLibrary: async (role) => role === "meat"
        ? [c(rec("Beef", "meat")), c(rec("Beef", "meat"))]
        : [],
      generate: async (role) => [c({ ...rec("Mango", "dessert", 4), kind: role, source: undefined } as unknown as R)],
      validate: valid,
      nameOf: (r) => r.name,
    },
  );
  assert.equal(result.served, 2);
  assert.deepEqual(result.sources, { library: 1, ai: 1 });
});

test("partial result reports missing roles, never silent success", async () => {
  const result = await assembleRecipeSet<R>(
    { total: 2, roles: ["meat", "dessert"] },
    {
      pickLibrary: async (role) => role === "meat" ? [c(rec("Beef", "meat"))] : [],
      generate: async () => [],
      validate: valid,
      nameOf: (r) => r.name,
    },
  );
  assert.equal(result.served, 1);
  assert.deepEqual(result.missingRoles, ["dessert"]);
  assert.match(result.warnings[0], /missing_roles/);
});

test("invalid role candidates are rejected and retried", async () => {
  let attempts = 0;
  const result = await assembleRecipeSet<R>(
    { total: 1, roles: ["dessert"] },
    {
      pickLibrary: async () => [c(rec("Soup", "soup"))],
      generate: async () => {
        attempts++;
        return [c(rec("Mango", "dessert", 4))];
      },
      validate: valid,
      nameOf: (r) => r.name,
    },
  );
  assert.equal(result.served, 1);
  assert.equal(result.cards[0].name, "Mango");
  assert.equal(attempts, 1);
});

test("noodle and dessert are assembled as requested roles", async () => {
  const result = await assembleRecipeSet<R>(
    { total: 2, roles: ["noodle", "dessert"] },
    {
      pickLibrary: async (role) => role === "noodle"
        ? [c(rec("Ramen", "noodle"))]
        : [c(rec("Mango Sago", "dessert", 4))],
      generate: async () => [],
      validate: (r, role) => r.kind === role && r.steps >= (role === "dessert" ? 4 : 5),
      nameOf: (r) => r.name,
    },
  );
  assert.equal(result.served, 2);
  assert.deepEqual(result.missingRoles, []);
});
