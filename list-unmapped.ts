import postgres from 'postgres';
import 'dotenv/config';
import fs from 'fs';

async function main() {
  const db = postgres(process.env.DATABASE_URL!, { ssl: { rejectUnauthorized: false } });
  const rows = await db`
    SELECT name, recipe_category FROM official_recipes WHERE is_active = true ORDER BY name
  `;
  const mappedSrc = fs.readFileSync('/Users/mavisng/Desktop/Kindcipe/manus/kindcipe-app-4/src/components/RecipeCard.tsx', 'utf8');
  const mappedSet = new Set<string>();
  const re = /'([^']+)':\s*require\(/g;
  let m;
  while ((m = re.exec(mappedSrc)) !== null) mappedSet.add(m[1]);

  const unmapped = rows.filter(r => !mappedSet.has(r.name));
  console.log('MAPPED COUNT:', mappedSet.size);
  console.log('UNMAPPED COUNT:', unmapped.length);
  unmapped.forEach(r => console.log(r.name));
  await db.end();
}
main();
