import postgres from 'postgres';
import 'dotenv/config';

const sql = postgres(process.env.DATABASE_URL);

async function main() {
  const result = await sql`SELECT COUNT(*) as count FROM official_recipes`;
  console.log('Total recipes:', result[0].count);
  
  const sample = await sql`SELECT name FROM official_recipes LIMIT 5`;
  console.log('Sample recipes:', sample.map(r => r.name));
  
  await sql.end();
}

main().catch(console.error);
