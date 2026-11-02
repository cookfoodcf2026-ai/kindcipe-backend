import test from "node:test";
import assert from "node:assert/strict";
import { dedupeIngredients, markQuantityProvenance } from "./ingredientQuality";

test("dedupe merges synonyms (醬油 / しょうゆ) without summing quantities", () => {
  const out = dedupeIngredients([
    { name: "醬油", quantity: "2", unit: "湯匙" },
    { name: "しょうゆ", quantity: "1", unit: "湯匙" },
    { name: "雞蛋", quantity: "2", unit: "隻" },
  ]);
  assert.equal(out.length, 2);
  const soy = out.find((i) => String(i.name).includes("醬油") || String(i.name).includes("しょうゆ"));
  assert.ok(soy, "soy row missing");
  assert.equal(String(soy!.quantity), "2", "quantity must not be summed");
  assert.equal(String(soy!.unit), "湯匙");
});

test("dedupe keeps 生抽 and 老抽 as separate ingredients", () => {
  const out = dedupeIngredients([
    { name: "生抽", quantity: "1", unit: "湯匙" },
    { name: "老抽", quantity: "1", unit: "茶匙" },
  ]);
  assert.equal(out.length, 2);
});

test("dedupe drops an empty-quantity duplicate but keeps the quantified row", () => {
  const out = dedupeIngredients([
    { name: "鹽" },
    { name: "鹽", quantity: "1", unit: "茶匙" },
  ]);
  assert.equal(out.length, 1);
  assert.equal(String(out[0].quantity), "1");
});

test("markQuantityProvenance marks a quantity found near the name as exact", () => {
  const src = "材料：雞胸 200克、西蘭花 1個";
  const out = markQuantityProvenance<{ name: string; quantity: string; unit: string; quantityStatus?: "exact" | "estimated" }>([{ name: "雞胸", quantity: "200", unit: "克" }], src);
  assert.equal(out[0].quantityStatus, "exact");
});

test("markQuantityProvenance marks an invented quantity as estimated", () => {
  const src = "材料：雞胸、西蘭花";
  const out = markQuantityProvenance<{ name: string; quantity: string; unit: string; quantityStatus?: "exact" | "estimated" }>([{ name: "雞胸", quantity: "200", unit: "克" }], src);
  assert.equal(out[0].quantityStatus, "estimated");
});

test("markQuantityProvenance treats missing source text as estimated", () => {
  const out = markQuantityProvenance<{ name: string; quantity: string; unit: string; quantityStatus?: "exact" | "estimated" }>([{ name: "雞胸", quantity: "200", unit: "克" }], "");
  assert.equal(out[0].quantityStatus, "estimated");
});

test("markQuantityProvenance accepts Chinese numerals and ranges", () => {
  const src = "材料：雞蛋 兩隻、豬扒 2-3 塊";
  type Row = { name: string; quantity: string; unit: string; quantityStatus?: "exact" | "estimated" };
  const out = markQuantityProvenance<Row>(
    [
      { name: "雞蛋", quantity: "2", unit: "隻" },
      { name: "豬扒", quantity: "2-3", unit: "塊" },
    ],
    src,
  );
  assert.equal(out[0].quantityStatus, "estimated", "數字與中文數字不對應時應保守");
  assert.equal(out[1].quantityStatus, "exact");
});

test("markQuantityProvenance finds a quantity listed before the name", () => {
  const src = "200克 雞胸\n1個 西蘭花";
  const out = markQuantityProvenance<{ name: string; quantity: string; unit: string; quantityStatus?: "exact" | "estimated" }>([{ name: "雞胸", quantity: "200", unit: "克" }], src);
  assert.equal(out[0].quantityStatus, "exact");
});
