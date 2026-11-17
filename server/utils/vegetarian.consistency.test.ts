import assert from "node:assert/strict";
import test from "node:test";
import { hardIsMeat, isNonVegetarianName } from "./vegetarian";

const MEAT_TERMS = [
  "花甲",
  "蛤",
  "蛤蜊",
  "蛤蠣",
  "蚌",
  "象拔蚌",
  "青口",
  "響螺",
  "花螺",
  "海螺",
  "田螺",
  "石螺",
  "螺肉",
  "螺片",
  "螺螄",
  "沙白",
  "蟶",
  "蛏",
  "雞湯",
  "魚露",
  "蠔油",
  "蝦仁",
  "柴魚高湯",
  "木魚花",
  "蝦米",
  "蝦醬",
  "鹹魚",
  "魚蛋",
  "魚板",
  "魚餅",
  "魚膠粉",
];

const SAFE_TERMS = [
  "海鮮醬",
  "海鲜酱",
  "蒸魚豉油",
  "蒸鱼豉油",
  "螺絲粉",
  "素蠔油",
  "素雞",
  "素鮑魚",
  "魚腥草",
  "羊肚菌",
  "雞腿菇",
  "牛油果",
  "雞蛋",
];

test("meat terms are rejected by both layers", () => {
  for (const term of MEAT_TERMS) {
    assert.equal(hardIsMeat(term), true, `hardIsMeat should reject ${term}`);
    assert.equal(isNonVegetarianName(term), true, `isNonVegetarianName should reject ${term}`);
  }
});

test("safe terms are accepted by both layers", () => {
  for (const term of SAFE_TERMS) {
    assert.equal(hardIsMeat(term), false, `hardIsMeat should accept ${term}`);
    assert.equal(isNonVegetarianName(term), false, `isNonVegetarianName should accept ${term}`);
  }
});

test("HARD_MEAT_RE and EXTRA_MEAT_RE agree on every listed term", () => {
  for (const term of [...MEAT_TERMS, ...SAFE_TERMS]) {
    assert.equal(
      hardIsMeat(term),
      isNonVegetarianName(term),
      `layers disagree on ${term}`,
    );
  }
});
