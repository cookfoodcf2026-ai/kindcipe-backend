import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const conn = postgres(process.env.DATABASE_URL || '');
const db = drizzle(conn);

async function main() {
  const result = await db.execute(`
    SELECT tags, COUNT(*) as count
    FROM official_recipes
    GROUP BY tags
    ORDER BY count DESC
    LIMIT 30
  `);

  console.log('Sample of tags after cleanup:\n');
  result.forEach((row: any) => {
    console.log(`  ${JSON.stringify(row.tags)}: ${row.count} 次`);
  });

  await conn.end();
}

main();
