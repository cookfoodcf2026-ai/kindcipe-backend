import assert from "node:assert/strict";
import test from "node:test";
import { parseNumberedSteps, parseRecipeSections, translateRecipeWithQwenMt, translateStepsWithQwenMt, QwenMtTranslationError } from "./qwenMtTranslator";

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

test("parses name, description and numbered steps from marked qwen-mt output", () => {
  const parsed = parseRecipeSections("<<<NAME>>>\nTomato Egg\n<<<DESCRIPTION>>>\nQuick dish.\n<<<STEPS>>>\n1. Heat oil.\n2. Add egg.", 2);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.name, "Tomato Egg");
  assert.equal(parsed.description, "Quick dish.");
  assert.deepEqual(parsed.steps, ["Heat oil.", "Add egg."]);
});

test("translates recipe name, description and steps for en/fil/id in three calls", async () => {
  let calls = 0;
  const result = await translateRecipeWithQwenMt({
    name: "番茄炒蛋",
    description: "快手菜",
    steps: ["炒蛋。", "上碟。"],
    ingredientTerms: ["雞蛋 = egg"],
    deps: {
      apiKey: "test-key",
      fetchImpl: (async (_url: string, init: any) => {
        calls += 1;
        const prompt = JSON.parse(init.body).messages[0].content as string;
        const lang = prompt.includes("Filipino") ? "fil" : prompt.includes("Indonesian") ? "id" : "en";
        const label = lang === "en" ? "Tomato Egg" : lang === "fil" ? "Itlog at Kamatis" : "Telur Tomat";
        return { ok: true, json: async () => ({ choices: [{ message: { content: `<<<NAME>>>\n${label}\n<<<DESCRIPTION>>>\n${lang} desc\n<<<STEPS>>>\n1. ${lang} one\n2. ${lang} two` } }] }) };
      }) as any,
    },
  });
  assert.equal(calls, 3);
  assert.equal(result.fields.nameEn, "Tomato Egg");
  assert.equal(result.fields.nameFil, "Itlog at Kamatis");
  assert.equal(result.fields.nameId, "Telur Tomat");
  assert.deepEqual(result.fields.stepsEn, ["en one", "en two"]);
  assert.deepEqual(result.fields.stepsFil, ["fil one", "fil two"]);
  assert.deepEqual(result.fields.stepsId, ["id one", "id two"]);
  assert.equal(result.engines.en, "qwen-mt-flash");
});
