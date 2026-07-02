import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  const result = await sql`SELECT recipe_category, COUNT(*) as count FROM official_recipes GROUP BY recipe_category ORDER BY recipe_category`;
  console.log(result);
  const total = await sql`SELECT COUNT(*) as total FROM official_recipes`;
  console.log('Total:', total[0].total);
  await sql.end();
}

main().catch(console.error);
