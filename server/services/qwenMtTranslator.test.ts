import assert from "node:assert/strict";
import test from "node:test";
import { parseNumberedSteps, translateStepsWithQwenMt, QwenMtTranslationError } from "./qwenMtTranslator";

test("parses strict numbered steps and preserves order", () => {
  assert.deepEqual(parseNumberedSteps("1. Heat oil.\n2. Add egg.", 2), {
    ok: true,
    steps: ["Heat oil.", "Add egg."],
    issues: [],
  });
});

test("rejects wrong count, order, and non-numbered prose", () => {
  const wrong = parseNumberedSteps("1. Heat oil.\n3. Add egg.\nextra prose", 2);
  assert.equal(wrong.ok, false);
  assert.match(wrong.issues.join(";"), /expected step 2|unexpected non-numbered/);
});

test("calls qwen-mt-flash with numbered plain text and returns parsed steps", async () => {
  let calls = 0;
  const result = await translateStepsWithQwenMt({
    steps: ["炒蛋。", "上碟。"],
    targetLang: "en",
    ingredientTerms: ["雞蛋 = egg"],
    deps: {
      apiKey: "test-key",
      fetchImpl: (async (_url: string, init: any) => {
        calls += 1;
        const body = JSON.parse(init.body);
        assert.equal(body.model, "qwen-mt-flash");
        assert.match(body.messages[0].content, /1\. 炒蛋/);
        return { ok: true, json: async () => ({ choices: [{ message: { content: "1. Scramble the eggs.\n2. Plate." } }] }) };
      }) as any,
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.engine, "qwen-mt-flash");
  assert.deepEqual(result.steps, ["Scramble the eggs.", "Plate."]);
});

test("retries qwen-mt once on malformed output", async () => {
  let calls = 0;
  const result = await translateStepsWithQwenMt({
    steps: ["炒蛋。", "上碟。"],
    targetLang: "en",
    deps: {
      apiKey: "test-key",
      fetchImpl: (async () => {
        calls += 1;
        return { ok: true, json: async () => ({ choices: [{ message: { content: calls === 1 ? "1. Scramble.\nprose" : "1. Scramble.\n2. Plate." } }] }) };
      }) as any,
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.engine, "qwen-mt-flash");
  assert.deepEqual(result.steps, ["Scramble.", "Plate."]);
});

test("falls back to engine A after two qwen-mt failures", async () => {
  let qwenCalls = 0;
  let fallbackCalls = 0;
  const result = await translateStepsWithQwenMt({
    steps: ["炒蛋。", "上碟。"],
    targetLang: "en",
    deps: {
      apiKey: "test-key",
      fetchImpl: (async () => {
        qwenCalls += 1;
        return { ok: true, json: async () => ({ choices: [{ message: { content: "not numbered" } }] }) };
      }) as any,
      invokeImpl: async () => {
        fallbackCalls += 1;
        return "1. Scramble.\n2. Plate.";
      },
    },
  });
  assert.equal(qwenCalls, 2);
  assert.equal(fallbackCalls, 1);
  assert.equal(result.engine, "engine-a");
  assert.deepEqual(result.steps, ["Scramble.", "Plate."]);
});

test("throws when qwen-mt and engine A both fail", async () => {
  await assert.rejects(
    translateStepsWithQwenMt({
      steps: ["炒蛋。"],
      targetLang: "en",
      deps: {
        apiKey: "test-key",
        fetchImpl: (async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "bad" } }] }) })) as any,
        invokeImpl: async () => "still bad",
      },
    }),
    QwenMtTranslationError,
  );
});
