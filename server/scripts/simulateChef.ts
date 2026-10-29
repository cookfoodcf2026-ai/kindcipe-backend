import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { processAIChefChat } from "../routers/aiRecipe";

type Dialogue = { id: string; name: string; turns: string[] };

const file = resolve(process.cwd(), "server/fixtures/aiChef/dialogues.jsonl");
const dialogues = readFileSync(file, "utf8")
  .split(/\n+/)
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Dialogue);

if (!process.argv.includes("--live")) {
  console.log(JSON.stringify({ mode: "dry", dialogues: dialogues.length, turns: dialogues.reduce((n, d) => n + d.turns.length, 0) }));
  process.exit(0);
}

for (const dialogue of dialogues) {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const turn of dialogue.turns) {
    messages.push({ role: "user", content: turn });
    const started = Date.now();
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
      replyText: result.content,
    }));
    messages.push({ role: "assistant", content: result.content });
  }
}
