import "dotenv/config";
import { getDb } from "../server/db";
import { aiChefFlags } from "../drizzle/schema";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const mode = (arg("--mode") ?? "library_only") as "normal" | "library_only" | "disabled";
if (!["normal", "library_only", "disabled"].includes(mode)) {
  console.error("Invalid --mode. Use normal | library_only | disabled");
  process.exit(1);
}
const familyRaw = arg("--family");
const familyId = familyRaw ? Number(familyRaw) : 0;
if (familyRaw && (!Number.isInteger(familyId) || familyId <= 0)) {
  console.error("Invalid --family");
  process.exit(1);
}
const scope = familyId > 0 ? "family" : "global";

const db = await getDb();
if (!db) {
  console.error("DB unavailable");
  process.exit(1);
}
await db.insert(aiChefFlags)
  .values({ scope, familyId, mode, flags: {}, updatedAt: new Date() })
  .onConflictDoUpdate({
    target: [aiChefFlags.scope, aiChefFlags.familyId],
    set: { mode, updatedAt: new Date() },
  });
console.log(`[ai-chef-safe-mode] ${scope}${familyId ? `#${familyId}` : ""} -> ${mode}`);
