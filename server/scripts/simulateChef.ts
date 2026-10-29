import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { processAIChefChat } from "../routers/aiRecipe";
import { startLlmMeter } from "../_core/llm";
import { dispatchChefTurn } from "../services/chefDispatcher";
import { shouldChargeChefRequest } from "../services/aiChefPolicy";
import { extractMealIngredients } from "../services/chefIntent";
import { saveLastMealState } from "../services/chefMealState";

type Expect = { exit?: string; served?: number; ai?: number; credits?: number; dispatchCalls?: number; clarifyReason?: string | null };
type Dialogue = { id: string; name: string; turns: string[]; expect?: Record<string, Expect> };

const fileArg = process.argv.find((arg) => arg.startsWith("--file="))?.slice(7);
const file = fileArg ? resolve(process.cwd(), fileArg) : resolve(process.cwd(), "server/fixtures/aiChef/dialogues.jsonl");
const allDialogues = readFileSync(file, "utf8")
  .split(/\n+/)
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Dialogue);
const idFilter = process.argv.find((arg) => arg.startsWith("--id="))?.slice(5);
const familyArg = process.argv.find((arg) => arg.startsWith("--family="))?.slice(9);
const familyId = familyArg ? Number(familyArg) : undefined;
const recordArg = process.argv.find((arg) => arg.startsWith("--record="))?.slice(9);
const replayArg = process.argv.find((arg) => arg.startsWith("--replay="))?.slice(9);
const dialogues = idFilter ? allDialogues.filter((dialogue) => dialogue.id === idFilter) : allDialogues;

if (replayArg) {
  const replayFile = resolve(process.cwd(), replayArg);
  for (const line of readFileSync(replayFile, "utf8").split("\n")) {
    if (line.trim()) process.stdout.write(`${line}\n`);
  }
  process.exit(0);
}

if (!process.argv.includes("--live")) {
  console.log(JSON.stringify({ mode: "dry", dialogues: dialogues.length, turns: dialogues.reduce((n, d) => n + d.turns.length, 0) }));
  process.exit(0);
}

const records: string[] = [];
for (const dialogue of dialogues) {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const turn of dialogue.turns) {
    messages.push({ role: "user", content: turn });
    let dispatchCalls = 0;
    let dispatchMs = 0;
    const dispatches: unknown[] = [];
    const started = Date.now();
    const meter = startLlmMeter({ route: "ai_chef_simulate" });
    const result = await processAIChefChat(
      messages,
      familyId,
      undefined,
      "chat",
      [],
      undefined,
      "zh-TW",
      [],
      false,
      {},
      "replace",
      true,
      true,
      undefined,
      async (dispatchMessages) => {
        dispatchCalls += 1;
        const dispatchStarted = Date.now();
        try {
          const raw = await dispatchChefTurn(dispatchMessages);
          dispatches.push(raw);
          return raw;
        } finally {
          dispatchMs += Date.now() - dispatchStarted;
        }
      },
      `sim-${dialogue.id}`,
    );
    const turnIndex = messages.filter((message) => message.role === "user").length;
    const expected = dialogue.expect?.[`t${turnIndex}`];
    const ai = result.recipes.filter((recipe) => (recipe.source ?? "ai") === "ai").length;
    const lib = result.recipes.length - ai;
    const exit = result.clarifyReason
      ? "ask"
      : result.recipes.length > 0
        ? "cards"
        : /[?？]/.test(result.content)
          ? "ask"
          : "text";
    if (familyId) {
      const requestItems = extractMealIngredients(turn)
        .filter((term) => !/^(?:i|want|and|the|a|an|some|please|with|for|to|my)$/i.test(term));
      const roles = result.intentOverride?.requested.roles ?? [];
      const soupCount = roles.filter((role) => role === "soup").length;
      const requestedTotal = result.intentOverride?.requested.total ?? 0;
      const shape = requestedTotal > 1
        ? { dishes: Math.max(0, requestedTotal - soupCount), soups: soupCount }
        : result.recipes.length === 0 && requestItems.length > 1
          ? { dishes: requestItems.length, soups: /湯|汤/.test(turn) ? 1 : 0 }
          : null;
      if (shape) {
        await saveLastMealState(familyId, `sim-${dialogue.id}`, shape, result.recipes.map((recipe) => recipe.name));
      }
    }
    const output = JSON.stringify({
      id: dialogue.id,
      turn,
      intent: result.intentOverride?.kind ?? "unknown",
      items: result.intentOverride?.requested.total ?? 0,
      exit,
      served: result.recipes.length,
      lib,
      ai,
      dispatchCalls,
      clarifyReason: result.clarifyReason ?? null,
      expect: expected ?? null,
      expectPass: expected ? (
        (expected.exit == null || expected.exit === exit)
        && (expected.served == null || expected.served === result.recipes.length)
        && (expected.ai == null || expected.ai === ai)
        && (expected.credits == null || expected.credits === (shouldChargeChefRequest({ served: result.recipes.length, aiCards: ai }) ? 1 : 0))
        && (expected.dispatchCalls == null || expected.dispatchCalls === dispatchCalls)
        && (expected.clarifyReason == null || expected.clarifyReason === (result.clarifyReason ?? null))
      ) : null,
      credits: shouldChargeChefRequest({ served: result.recipes.length, aiCards: ai }) ? 1 : 0,
      latencyMs: Date.now() - started,
      dispatchMs,
      costUsd: meter.costUsd,
      cardNames: result.recipes.map((recipe) => recipe.name),
      replyText: result.content,
      ...(recordArg ? { dispatches } : {}),
    });
    records.push(output);
    console.log(output);
    messages.push({ role: "assistant", content: result.content });
  }
}
if (recordArg) {
  writeFileSync(resolve(process.cwd(), recordArg), `${records.join("\n")}\n`);
}
process.exit(0);
