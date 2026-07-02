import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  const users = await sql`SELECT id, email, role FROM users LIMIT 10`;
  console.log(users);
  await sql.end();
}

main().catch(console.error);
