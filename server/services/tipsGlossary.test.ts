import assert from "node:assert/strict";
import test from "node:test";

const GLOSSARY = [
  { zh: "澄麵", en: "wheat starch", fil: "wheat starch", id: "wheat starch" },
  { zh: "五指毛桃", en: "Ficus hirta", fil: "Ficus hirta", id: "Ficus hirta" },
  { zh: "霸王花", en: "dried night-blooming cereus", fil: "dried night-blooming cereus", id: "dried night-blooming cereus" },
];
const CJK = /[\u3400-\u9FFF\uF900-\uFAFF]/;

test("tip glossary fixture has deterministic four-language mappings and no CJK leaks", () => {
  for (const item of GLOSSARY) {
    assert.ok(item.zh);
    for (const lang of ["en", "fil", "id"] as const) {
      assert.ok(item[lang]);
      assert.equal(CJK.test(item[lang]), false, `${item.zh} leaked CJK into ${lang}`);
    }
  }
});

test("3657/3666/3679 known leak terms resolve to the glossary targets", () => {
  const expected: Record<string, string> = {
    "澄麵": "wheat starch",
    "五指毛桃": "Ficus hirta",
    "霸王花": "dried night-blooming cereus",
  };
  for (const [zh, target] of Object.entries(expected)) {
    const row = GLOSSARY.find((x) => x.zh === zh);
    assert.ok(row);
    assert.equal(row.en, target);
    assert.equal(row.fil, target);
    assert.equal(row.id, target);
  }
});
