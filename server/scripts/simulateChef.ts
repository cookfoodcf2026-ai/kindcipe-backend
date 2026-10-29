import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { processAIChefChat } from "../routers/aiRecipe";
import { startLlmMeter } from "../_core/llm";

type Dialogue = { id: string; name: string; turns: string[] };

const file = resolve(process.cwd(), "server/fixtures/aiChef/dialogues.jsonl");
const allDialogues = readFileSync(file, "utf8")
  .split(/\n+/)
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Dialogue);
const idFilter = process.argv.find((arg) => arg.startsWith("--id="))?.slice(5);
const dialogues = idFilter ? allDialogues.filter((dialogue) => dialogue.id === idFilter) : allDialogues;

if (!process.argv.includes("--live")) {
  console.log(JSON.stringify({ mode: "dry", dialogues: dialogues.length, turns: dialogues.reduce((n, d) => n + d.turns.length, 0) }));
  process.exit(0);
}

for (const dialogue of dialogues) {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const turn of dialogue.turns) {
    messages.push({ role: "user", content: turn });
    const started = Date.now();
    const meter = startLlmMeter({ route: "ai_chef_simulate" });
    const result = await processAIChefChat(messages, undefined, undefined, "chat", [], undefined, "zh-TW", [], false, {});
    console.log(JSON.stringify({
      id: dialogue.id,
      turn,
      intent: result.intentOverride?.kind ?? "unknown",
      items: result.intentOverride?.requested.total ?? 0,
      exit: result.clarifyReason ? "ask" : result.recipes.length > 0 ? "cards" : "text",
      served: result.recipes.length,
      credits: 0,
      latencyMs: Date.now() - started,
      costUsd: meter.costUsd,
      replyText: result.content,
    }));
    messages.push({ role: "assistant", content: result.content });
  }
}
process.exit(0);
