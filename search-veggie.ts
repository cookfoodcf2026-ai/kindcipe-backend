import postgres from 'postgres';
import 'dotenv/config';

async function main() {
  const db = postgres(process.env.DATABASE_URL!, { ssl: { rejectUnauthorized: false } });
  const rows = await db`
    SELECT name, recipe_category, tags FROM official_recipes
    WHERE is_active = true AND (name LIKE '%生菜%' OR name LIKE '%時蔬%' OR name LIKE '%菜心%' OR name LIKE '%西蘭花%' OR name LIKE '%通菜%')
    LIMIT 20
  `;
  console.log(rows);
  await db.end();
}
main();
