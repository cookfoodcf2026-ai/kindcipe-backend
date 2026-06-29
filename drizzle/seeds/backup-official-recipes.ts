import 'dotenv/config';
import postgres from 'postgres';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sql = postgres(process.env.DATABASE_URL!);

async function backupOfficialRecipes() {
  console.log(' Backing up official recipes...');

  const recipes = await sql`SELECT * FROM official_recipes ORDER BY id`;

  console.log(`Found ${recipes.length} official recipes`);

  const backup = {
    timestamp: new Date().toISOString(),
    count: recipes.length,
    recipes: recipes.map(r => ({
      ...r,
      created_at: r.created_at?.toISOString(),
      updated_at: r.updated_at?.toISOString(),
    })),
  };

  const backupDir = path.join(__dirname, 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const backupFile = path.join(backupDir, `official-recipes-backup-${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));

  console.log(`✅ Backup saved to ${backupFile}`);

  await sql.end();
}

backupOfficialRecipes().catch(err => {
  console.error('❌ Backup failed:', err);
  process.exit(1);
});
