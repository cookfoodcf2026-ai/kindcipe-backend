import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!);

async function clearOfficialRecipes() {
  console.log(' Clearing official recipes...');

  const result = await sql`DELETE FROM official_recipes`;

  console.log(`✅ Deleted ${result.count} official recipes`);

  await sql.end();
}

clearOfficialRecipes().catch(err => {
  console.error('❌ Clear failed:', err);
  process.exit(1);
});
