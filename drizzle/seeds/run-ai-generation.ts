import 'dotenv/config';

const API_BASE = 'https://kindcipe-backend-production.up.railway.app';
const ADMIN_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJvcGVuSWQiOiJlbWFpbF9hYWEyNjA0ZTI2OTA2Mzk1MmQ3OGU3Y2IwNzBlMjU1MiIsImFwcElkIjoia2luZGNpcGUiLCJuYW1lIjoiQWRtaW4iLCJleHAiOjE3ODMwODMzNjksImlhdCI6MTc4Mjk5Njk2OX0.NpC4O74Sro-Ylumrt0UpqygYb4rty49YjCuWOo_NchM';

const DISTRIBUTION = [
  { category: "中菜", count: 235 },
  { category: "西餐", count: 95 },
  { category: "日式", count: 50 },
  { category: "甜品", count: 40 },
  { category: "韓式", count: 30 },
  { category: "東南亞", count: 20 },
  { category: "其他", count: 30 },
];

async function generateRecipes(category: string, count: number): Promise<number> {
  const batches = Math.ceil(count / 5);
  let totalGenerated = 0;

  for (let i = 0; i < batches; i++) {
    const batchSize = Math.min(5, count - totalGenerated);

    console.log(`  Generating batch ${i + 1}/${batches} for ${category} (${batchSize} recipes)...`);

    const response = await fetch(`${API_BASE}/api/trpc/recipes.generateOfficial`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
      },
      body: JSON.stringify({
        json: { category, count: batchSize },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`    ❌ Batch failed:`, error);
      continue;
    }

    const result = await response.json() as any;
    const generated = result.result?.data?.json?.count || 0;
    totalGenerated += generated;
    console.log(`    ✅ Generated ${generated} recipes`);
  }

  return totalGenerated;
}

async function main() {
  console.log('🚀 Starting AI recipe generation via API...\n');

  let grandTotal = 0;

  for (const dist of DISTRIBUTION) {
    console.log(`\n📝 Generating ${dist.count} ${dist.category} recipes...`);
    const generated = await generateRecipes(dist.category, dist.count);
    grandTotal += generated;
    console.log(`  Total ${dist.category}: ${generated} recipes`);
  }

  console.log(`\n✅ Grand total: ${grandTotal} recipes generated!`);
}

main().catch(console.error);
