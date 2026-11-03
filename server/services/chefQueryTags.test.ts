import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveTagsFromText } from "./chefRetrieval";

describe("deriveTagsFromText", () => {
  it("maps breakfast phrases", () => {
    assert.ok(deriveTagsFromText("有咩早餐").includes("breakfast"));
  });
  it("maps spicy phrases", () => {
    assert.ok(deriveTagsFromText("想食辣").includes("spicy"));
  });
  it("maps kid-friendly phrases", () => {
    assert.ok(deriveTagsFromText("小朋友食咩好").includes("kids"));
  });
  it("maps one-pot phrases", () => {
    const tags = deriveTagsFromText("有咩一鍋到底");
    assert.ok(tags.includes("one-pot"));
  });
  it("maps high-protein phrases", () => {
    assert.ok(deriveTagsFromText("高蛋白餐單").includes("high-protein"));
  });
  it("returns nothing for a plain dish question", () => {
    assert.deepEqual(deriveTagsFromText("有咩豆腐菜式"), []);
  });
});
