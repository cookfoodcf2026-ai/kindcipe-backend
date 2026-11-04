import assert from "node:assert/strict";
import test from "node:test";
import { recipeSortOrder } from "./recipeSort";

test("newest sorts by createdAt then id", () => {
  assert.deepEqual(recipeSortOrder("newest"), {
    official: ["createdAt", "id"],
    custom: ["createdAt", "id"],
  });
});

test("updated uses updatedAt for custom recipes, createdAt for official", () => {
  assert.deepEqual(recipeSortOrder("updated"), {
    official: ["createdAt", "id"],
    custom: ["updatedAt", "id"],
  });
});

test("popular keeps the legacy order and adds an id tiebreaker", () => {
  assert.deepEqual(recipeSortOrder("popular"), {
    official: ["popularity", "createdAt", "id"],
    custom: ["popularity", "createdAt", "id"],
  });
});

test("every mode ends with id so offset paging is stable", () => {
  for (const mode of ["popular", "newest", "updated"] as const) {
    const { official, custom } = recipeSortOrder(mode);
    assert.equal(official.at(-1), "id", `${mode} official must end with id`);
    assert.equal(custom.at(-1), "id", `${mode} custom must end with id`);
  }
});

test("two recipes created in the same second still have a total order", () => {
  // Same key for the primary column → only id can break the tie.
  const rows = [
    { id: 7, createdAt: 1000 },
    { id: 9, createdAt: 1000 },
    { id: 8, createdAt: 1000 },
  ];
  const keys = recipeSortOrder("newest").custom;
  const sorted = [...rows].sort((a, b) => {
    for (const key of keys) {
      if (key === "id" || key === "createdAt") {
        const diff = (b[key] as number) - (a[key] as number);
        if (diff !== 0) return diff;
      }
    }
    return 0;
  });
  assert.deepEqual(
    sorted.map((r) => r.id),
    [9, 8, 7],
  );

  // paging: page 1 + page 2 must cover every row exactly once
  const page1 = sorted.slice(0, 2).map((r) => r.id);
  const page2 = sorted.slice(2, 4).map((r) => r.id);
  assert.deepEqual([...page1, ...page2], [9, 8, 7]);
});
