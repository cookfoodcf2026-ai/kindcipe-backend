import postgres from 'postgres';
import 'dotenv/config';
import fs from 'fs';

function cleanName(recipeName: string): string {
  return recipeName
    .replace(/^(港式|日式|韓式|泰式|西式|意式|台式|電飯煲|經典|正宗|傳統|風味|大牌檔風味)/g, '')
    .replace(/\s*\([^)]+\)\s*$/g, '')
    .trim();
}

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

  const unmapped = rows.filter(r => {
    const rawName = r.name;
    const cleaned = cleanName(rawName);
    return !mappedSet.has(rawName) && !mappedSet.has(cleaned);
  });

  console.log('REAL UNMAPPED COUNT:', unmapped.length);
  unmapped.forEach(r => console.log(r.name));
  await db.end();
}
main();
