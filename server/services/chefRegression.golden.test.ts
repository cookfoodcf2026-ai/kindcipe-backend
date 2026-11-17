import assert from "node:assert/strict";
import test from "node:test";

delete process.env.DATABASE_URL;

import { processAIChefChat } from "../routers/aiRecipe";
import { isVegetarianRow } from "../utils/vegetarian";
import {
  CHEF_FIXTURE_POOL,
  fixtureSearch,
  withSeededRandom,
} from "./chefSelector.fixtures";

type Flags = Parameters<typeof processAIChefChat>[9];
type Search = NonNullable<Parameters<typeof processAIChefChat>[5]>;

type Snapshot = {
  clarifyReason: string | null;
  recipes: Array<{
    name: string;
    source: string;
    dishType: string | null;
    officialId: number | null;
    recycled: boolean;
    isVegetarian: boolean;
  }>;
};

function snapshot(result: Awaited<ReturnType<typeof processAIChefChat>>): Snapshot {
  return {
    clarifyReason: result.clarifyReason ?? null,
    recipes: result.recipes.map((recipe) => ({
      name: recipe.name,
      source: recipe.source ?? "ai",
      dishType: recipe.dishType ?? null,
      officialId: recipe.officialId ?? null,
      recycled: recipe.recycled === true,
      isVegetarian: isVegetarianRow({ name: recipe.name, ingredients: recipe.ingredients }),
    })),
  };
}

function assertNoDuplicateIds(result: Awaited<ReturnType<typeof processAIChefChat>>) {
  const ids = result.recipes
    .map((recipe) => recipe.officialId)
    .filter((id): id is number => typeof id === "number");
  assert.equal(new Set(ids).size, ids.length, "duplicate officialId in one response");
  const names = result.recipes.map((recipe) => recipe.name);
  assert.equal(new Set(names).size, names.length, "duplicate recipe name in one response");
}

function assertNonEmpty(result: Awaited<ReturnType<typeof processAIChefChat>>) {
  assert.ok(result.recipes.length > 0, "must not serve 0 cards");
}

/**
 * Soft report only: sequence / card names are logged, never asserted. A future
 * selector change may legitimately pick a different card; only the invariants
 * below are allowed to fail.
 */
function report(label: string, snap: Snapshot) {
  console.log(`REPORT ${label} ${JSON.stringify(snap)}`);
}

let nextFamily = 7100;

async function run(params: {
  text: string;
  mode?: "chat" | "library";
  search?: Search;
  avoid?: string[];
  flags?: Flags;
}) {
  nextFamily += 1;
  const familyId = nextFamily;
  const result = await withSeededRandom(424242, () =>
    processAIChefChat(
      [{ role: "user", content: params.text }],
      familyId,
      undefined,
      params.mode ?? "chat",
      [],
      params.search,
      "zh-TW",
      params.avoid ?? [],
      false,
      params.flags ?? {},
      "replace",
      true,
      true,
      fixtureSearch,
    ),
  );
  return { familyId, result, snap: snapshot(result) };
}

test("golden 1: 三餸一湯 (4 cards, exactly one soup, no duplicate) + peanut allergen never appears", async () => {
  const { result, snap } = await run({ text: "三餸一湯", mode: "library" });
  assert.equal(result.recipes.length, 4, "must serve 4 cards");
  const soups = result.recipes.filter((recipe) => recipe.dishType === "soup");
  assert.equal(soups.length, 1, "must serve exactly one soup");
  const mains = result.recipes.filter((recipe) => recipe.dishType !== "soup");
  assert.equal(mains.length, 3, "must serve exactly three non-soup mains");
  assertNoDuplicateIds(result);
  report("meal", snap);

  const allergy = await run({ text: "三餸一湯", mode: "library", avoid: ["花生"] });
  assertNonEmpty(allergy.result);
  assert.equal(allergy.result.recipes.filter((recipe) => recipe.dishType === "soup").length, 1);
  for (const recipe of allergy.result.recipes) {
    const hasPeanut = recipe.ingredients.some((ingredient) => String(ingredient.name).includes("花生"));
    assert.equal(hasPeanut, false, `peanut must never appear: ${recipe.name}`);
  }
  assertNoDuplicateIds(allergy.result);
  report("meal-peanut-avoid", allergy.snap);
});

test("golden 2: 素食 (every card isVegetarianRow === true)", async () => {
  const { result, snap } = await run({ text: "素食", mode: "chat" });
  assertNonEmpty(result);
  assert.ok(
    result.recipes.every((recipe) => isVegetarianRow({ name: recipe.name, ingredients: recipe.ingredients })),
    "every served card must be vegetarian",
  );
  assertNoDuplicateIds(result);
  report("vegetarian", snap);
});

test("golden 3: 單卡食譜搜尋 (swap marker, same dishType, never a veg card)", async () => {
  const { result, snap } = await run({
    text: "換一張 庫內搜尋：海鮮；同類別：seafood",
    mode: "library",
  });
  assert.equal(result.recipes.length, 1, "single-card search must serve exactly 1");
  const card = result.recipes[0]!;
  assert.equal(card.dishType, "seafood", "seafood swap must stay seafood");
  assert.equal(
    isVegetarianRow({ name: card.name, ingredients: card.ingredients }),
    false,
    "seafood swap must never serve a vegetarian card",
  );
  assertNoDuplicateIds(result);
  report("singleCard", snap);
});

test("golden 4: 熱門場景 quick (scenario=quick, library only)", async () => {
  const { result, snap } = await run({
    text: "快手",
    mode: "library",
    search: { scenario: "quick", count: 1 },
  });
  assert.equal(result.recipes.length, 1, "quick scenario must serve 1 card");
  const row = CHEF_FIXTURE_POOL.find((candidate) => candidate.name === result.recipes[0]?.name);
  assert.ok(row?.scenarioTags.includes("quick"), "served card must carry scenarioTags quick");
  assertNoDuplicateIds(result);
  report("quickScenario", snap);
});

test("golden 5: pantry 我有青菜、洋蔥、豆腐 (library hit, never 0)", async () => {
  const { result, snap } = await run({ text: "用以下食材煮餸：青菜、洋蔥、豆腐" });
  assertNonEmpty(result);
  assertNoDuplicateIds(result);
  report("pantry", snap);
});
