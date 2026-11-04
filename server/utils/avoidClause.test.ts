import assert from "node:assert/strict";
import test from "node:test";
import { stripAvoidClauses } from "./avoidClause";

test("avoid clause: 尾段『；避免：蝦』被剝走", () => {
  assert.equal(stripAvoidClauses("4 人食。3 餸 1 湯；避免：蝦"), "4 人食。3 餸 1 湯");
});

test("avoid clause: 前段『避免：蝦，』唔會吞掉後面嘅人數", () => {
  assert.equal(stripAvoidClauses("避免：蝦，4 人食 3 餸 1 湯"), "4 人食 3 餸 1 湯");
});

test("avoid clause: 多項清單以逗號結束", () => {
  assert.equal(stripAvoidClauses("3 餸 1 湯；避免：蝦、花生，要清淡"), "3 餸 1 湯，要清淡");
});


test("avoid clause: 沒有冒號的『避免太油』保持原狀", () => {
  assert.equal(stripAvoidClauses("快啲煮，避免太油"), "快啲煮，避免太油");
});

test("avoid clause: 唔食牛肉只剝該項", () => {
  assert.equal(stripAvoidClauses("我想食雞，唔食牛肉"), "我想食雞");
});

test("avoid clause: 正常句子不變", () => {
  assert.equal(stripAvoidClauses("我想食番茄炒蛋"), "我想食番茄炒蛋");
});
