import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";
import { aiRecipeRouter } from "./aiRecipe";
import { clearAiChefFlagCache } from "../services/aiChefFlags";

const localUrl = process.env.TEST_DATABASE_URL;
if (!localUrl) throw new Error("TEST_DATABASE_URL is required for test:chef:db");
process.env.DATABASE_URL = localUrl;
process.env.DASHSCOPE_API_KEY = "";
process.env.GEMINI_API_KEY = "";

const sql = postgres(localUrl, { max: 1 });
const prefix = "ROUTER_SPEC_";
const name = `${prefix}一甜品`;

const ctx = {
  user: { id: 900005, openId: "router-spec", role: "user" },
  activeFamilyId: null,
  activeFamilyRole: null,
  readOnly: false,
  sharedLocked: false,
  clientPlatform: "web",
  req: { headers: {} },
  res: {},
} as any;

async function seed() {
  await sql`delete from official_recipes where name like ${prefix + "%"}`;
  await sql`insert into official_recipes
    (imported_by_user_id,name,description,cook_time,servings,difficulty,recipe_category,dish_type,ingredients,steps,tags,is_active)
    values ('router-spec',${name},'一甜品',20,4,'easy','甜品','dessert',
      ${JSON.stringify([{name:"芒果",quantity:"1",unit:"份"},{name:"水",quantity:"適量",unit:""}])},
      ${JSON.stringify(["1","2","3","4","5"])},
      ${JSON.stringify(["甜品"])},true)`;
}
async function cleanup() {
  await sql`delete from official_recipes where name like ${prefix + "%"}`;
}

test.before(async () => { await seed(); });
test.after(async () => { await cleanup(); await sql.end(); setTimeout(() => process.exit(process.exitCode ?? 0), 100); });

test("router smoke: TRUTHFUL ON adds cardId, OFF removes it", async () => {
  const caller = aiRecipeRouter.createCaller(ctx);

  process.env.AI_CHEF_TRUTHFUL_CONTRACT = "1";
  process.env.AI_CHEF_SINGLE_CARD_LIBRARY = "1";
  clearAiChefFlagCache();
  const on: any = await caller.chat({ messages: [{ role: "user", content: "一甜品" }], mode: "chat" });
  assert.equal(on.recipes[0].cardId?.startsWith("official_"), true);

  process.env.AI_CHEF_TRUTHFUL_CONTRACT = "0";
  process.env.AI_CHEF_SINGLE_CARD_LIBRARY = "0";
  clearAiChefFlagCache();
  const off: any = await caller.chat({ messages: [{ role: "user", content: "一甜品" }], mode: "chat" });
  assert.equal("cardId" in (off.recipes[0] as any), false);
  assert.equal("status" in off, false);
  assert.equal("operation" in off, false);
  assert.deepEqual(Object.keys(off).sort(), [
    "content", "intent", "llmUsed", "missingRoles", "quota",
    "recipes", "requestId", "requested", "served", "sources", "warnings",
  ].sort());
});
