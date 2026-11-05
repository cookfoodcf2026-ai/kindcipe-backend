import assert from "node:assert/strict";
import test from "node:test";
import { extractTypedAvoid } from "./typedAvoid";

test("typed avoid: 避免：花生", () => {
  assert.deepEqual(extractTypedAvoid("4 人食。3 餸 1 湯；避免：花生"), ["花生"]);
});

test("typed avoid: 對蝦敏感", () => {
  assert.ok(extractTypedAvoid("我對蝦敏感，唔該").includes("蝦"));
});

test("typed avoid: 唔食牛肉", () => {
  assert.ok(extractTypedAvoid("我想食牛但唔食牛肉").includes("牛肉"));
});

test("typed avoid: 抽象限制唔會當食材", () => {
  assert.deepEqual(extractTypedAvoid("唔要太油"), []);
});

test("typed avoid: 英文 no peanuts", () => {
  const out = extractTypedAvoid("no peanuts please");
  assert.ok(out.some((t) => t.toLowerCase().includes("peanut")));
});

test("typed avoid: 空白輸入", () => {
  assert.deepEqual(extractTypedAvoid(""), []);
});

test("typed avoid: 多個清單", () => {
  const out = extractTypedAvoid("避免：花生、蝦；唔食牛肉");
  assert.ok(out.includes("花生"));
  assert.ok(out.includes("蝦"));
  assert.ok(out.includes("牛肉"));
});

test("typed avoid: 正常點餐唔會誤中", () => {
  assert.deepEqual(extractTypedAvoid("我想食番茄炒蛋"), []);
});

test("typed avoid: 否定句唔算（唔係對花生過敏）", () => {
  assert.deepEqual(extractTypedAvoid("我唔係對花生過敏，只係想問下"), []);
});

test("typed avoid: 辣係品類詞，對辣敏感會抽到辣", () => {
  assert.deepEqual(extractTypedAvoid("我對辣敏感"), ["辣"]);
});

test("typed avoid: 避免：海鮮 抽出品類詞", () => {
  assert.deepEqual(extractTypedAvoid("避免：海鮮"), ["海鮮"]);
});

test("typed avoid: 唔要肉 抽出品類詞", () => {
  assert.deepEqual(extractTypedAvoid("唔要肉"), ["肉"]);
});

test("typed avoid: 避免：辣 抽出品類詞", () => {
  assert.deepEqual(extractTypedAvoid("避免：辣"), ["辣"]);
});

test("typed avoid: 避免太油唔會污染 avoidIngredients", () => {
  assert.deepEqual(extractTypedAvoid("避免太油"), []);
});

test("typed avoid: 英文 no problem 唔會誤中", () => {
  assert.deepEqual(extractTypedAvoid("no problem, cook anything"), []);
});

test("typed avoid: 單字蛋白類（雞／牛／豬）都要抽到", () => {
  assert.deepEqual(extractTypedAvoid("4 人食。3 餸 1 湯；避免：雞"), ["雞"]);
  assert.deepEqual(extractTypedAvoid("避免：牛"), ["牛"]);
});
