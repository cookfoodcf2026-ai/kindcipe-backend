import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseChefQuery } from "./chefSlots";

function invokeWith(content: string) {
  return async () => ({
    choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
  }) as any;
}

describe("chef slot tags come from the LLM, not keyword tables", () => {
  it("蛋類 → protein egg", async () => {
    const result = await parseChefQuery("有咩蛋類", {
      invoke: invokeWith('{"protein":"egg","wantsCards":true}'),
    });
    assert.equal(result.slots?.protein, "egg");
    assert.equal(result.slots?.keyword, undefined);
    assert.equal(result.slots?.wantsCards, true);
  });

  it("粉麵 → dishType noodle", async () => {
    const result = await parseChefQuery("想食粉麵", {
      invoke: invokeWith('{"dishType":"noodle","wantsCards":true}'),
    });
    assert.equal(result.slots?.dishType, "noodle");
  });

  it("清淡 → tag light", async () => {
    const result = await parseChefQuery("想食清淡啲", {
      invoke: invokeWith('{"tags":["light"],"wantsCards":true}'),
    });
    assert.deepEqual(result.slots?.tags, ["light"]);
  });

  it("一鍋到底 → tag one-pot", async () => {
    const result = await parseChefQuery("有咩一鍋到底", {
      invoke: invokeWith('{"tags":["one-pot"],"wantsCards":true}'),
    });
    assert.deepEqual(result.slots?.tags, ["one-pot"]);
  });

  it("category word in keyword is not silently remapped to protein", async () => {
    const { normalizeChefSlots } = await import("./chefSlots");
    const slots = normalizeChefSlots({ keyword: "蛋類", wantsCards: false });
    assert.ok(slots);
    assert.equal(slots.protein, undefined);
    assert.equal(slots.keyword, "蛋類");
  });
});
