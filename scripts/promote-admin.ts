import { config } from "dotenv";
import { resolve } from "path";
import { eq } from "drizzle-orm";
import { getDb } from "../server/db";
import { users } from "../drizzle/schema";

config({ path: resolve(process.cwd(), ".env") });

async function main() {
  const idArg = process.argv.find((arg) => arg.startsWith("--openId="));
  const emailArg = process.argv.find((arg) => arg.startsWith("--email="));
  const openId = idArg?.split("=", 2)[1];
  const email = emailArg?.split("=", 2)[1]?.toLowerCase();

  if (!openId && !email) {
    throw new Error("Usage: npm run promote:admin -- --openId=<openId> | --email=<email>");
  }

  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const whereClause = openId ? eq(users.openId, openId) : eq(users.email, email!);
  const updated = await db
    .update(users)
    .set({ role: "admin", updatedAt: new Date() })
    .where(whereClause)
    .returning({ id: users.id, openId: users.openId, email: users.email, role: users.role });

  if (updated.length === 0) {
    throw new Error(openId ? `User not found for openId=${openId}` : `User not found for email=${email}`);
  }

  console.log(JSON.stringify(updated[0], null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
