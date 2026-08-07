import postgres from 'postgres';
import 'dotenv/config';

async function main() {
  const db = postgres(process.env.DATABASE_URL!, { ssl: { rejectUnauthorized: false } });
  const rows = await db`
    SELECT name, recipe_category, tags FROM official_recipes
    WHERE is_active = true AND (name LIKE '%蠔油%' OR ingredients LIKE '%蠔油%')
    LIMIT 20
  `;
  console.log(rows);
  await db.end();
}
main();
