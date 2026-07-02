import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  const user = await sql`SELECT id, open_id, email, role FROM users WHERE email = 'mavis2@gmail.com' LIMIT 1`;
  console.log(user);
  await sql.end();
}

main().catch(console.error);
