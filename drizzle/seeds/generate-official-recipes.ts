import 'dotenv/config';
import postgres from 'postgres';
import { invokeLLM, extractJSON } from '../../server/_core/llm';

const sql = postgres(process.env.DATABASE_URL!);

// Distribution aligned with frontend categories
const DISTRIBUTION = [
  { category: "中菜", count: 235, subCategories: ["小炒", "湯水", "蒸菜", "燉菜", "涼菜", "家常菜"] },
  { category: "西餐", count: 95, subCategories: ["主菜", "沙律", "意粉", "湯", "前菜"] },
  { category: "日式", count: 50, subCategories: ["刺身", "丼物", "煮物", "焼物", "揚物"] },
  { category: "韓式", count: 30, subCategories: ["燒肉", "湯鍋", "拌飯", "小食"] },
  { category: "東南亞", count: 20, subCategories: ["泰式", "越式", "馬來西亞", "印尼"] },
  { category: "甜品", count: 40, subCategories: ["蛋糕", "布丁", "糖水", "雪葩"] },
  { category: "其他", count: 30, subCategories: ["素食", "健康餐", "小食", "飲品"] },
];

interface GeneratedRecipe {
  name: string;
  description: string;
  cookTime: number;
  servings: number;
  difficulty: string;
  recipeCategory: string;
  ingredients: { name: string; quantity: string; unit: string; category: string }[];
  steps: { instruction: string; duration: number }[];
  tags: string[];
}

async function generateRecipesForCategory(
  category: string,
  subCategories: string[],
  count: number,
  batchSize: number = 20
): Promise<GeneratedRecipe[]> {
  const allRecipes: GeneratedRecipe[] = [];
  const batches = Math.ceil(count / batchSize);

  for (let batch = 0; batch < batches; batch++) {
    const remaining = count - allRecipes.length;
    const currentBatchSize = Math.min(batchSize, remaining);

    console.log(`  Generating batch ${batch + 1}/${batches} for ${category} (${currentBatchSize} recipes)...`);

    const systemPrompt = `你是一個專業的食譜創作專家。請生成 ${currentBatchSize} 個獨特、實用、適合香港家庭的 ${category} 食譜。

要求：
1. 每個食譜名稱必須獨特，唔准重複
2. 唔准用「XX（家常版）」、「XX（快手版）」等後綴
3. 食材要實用、容易買到
4. 做法要詳細、清晰
5. 份量適合 2-4 人家庭
6. 所有文字使用繁體中文
7. 避免重複食材組合，每個食譜要有特色

可參考嘅 sub-categories: ${subCategories.join(', ')}

回傳 JSON array 格式，每個食譜包含：
{
  "name": "食譜名稱",
  "description": "簡短描述（1-2句）",
  "cookTime": 烹飪時間（分鐘，整數）,
  "servings": 份量（人數，整數）,
  "difficulty": "簡單" | "中等" | "困難",
  "recipeCategory": "${category}",
  "ingredients": [
    { "name": "食材名", "quantity": "數量", "unit": "單位", "category": "肉類/海鮮/蔬菜/調味料/乾貨/其他" }
  ],
  "steps": [
    { "instruction": "步驟說明", "duration": 分鐘（整數）}
  ],
  "tags": ["標籤1", "標籤2"]
}`;

    const userPrompt = `請生成 ${currentBatchSize} 個獨特嘅 ${category} 食譜。確保每個食譜都係真正唔同嘅菜式，唔好重複。`;

    let retries = 3;
    while (retries > 0) {
      try {
        const response = await invokeLLM({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          responseFormat: {
            type: "json_schema",
            json_schema: {
              name: "recipe_batch",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  recipes: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        description: { type: "string" },
                        cookTime: { type: "integer" },
                        servings: { type: "integer" },
                        difficulty: { type: "string" },
                        recipeCategory: { type: "string" },
                        ingredients: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              name: { type: "string" },
                              quantity: { type: "string" },
                              unit: { type: "string" },
                              category: { type: "string" },
                            },
                            required: ["name", "quantity", "unit", "category"],
                          },
                        },
                        steps: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              instruction: { type: "string" },
                              duration: { type: "integer" },
                            },
                            required: ["instruction", "duration"],
                          },
                        },
                        tags: { type: "array", items: { type: "string" } },
                      },
                      required: ["name", "description", "cookTime", "servings", "difficulty", "recipeCategory", "ingredients", "steps", "tags"],
                    },
                  },
                },
                required: ["recipes"],
              },
            },
          },
        });

        const rawContent = response.choices[0]?.message?.content;
        const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
        if (!content) throw new Error("AI returned empty response");

        const parsed = extractJSON(content) as { recipes: GeneratedRecipe[] };
        if (!parsed.recipes || !Array.isArray(parsed.recipes)) {
          throw new Error("Invalid response format");
        }

        allRecipes.push(...parsed.recipes);
        console.log(`    ✅ Generated ${parsed.recipes.length} recipes`);
        break;
      } catch (err: any) {
        retries--;
        console.error(`    ❌ Batch failed, ${retries} retries left:`, err.message);
        if (retries === 0) {
          console.error(`    ⚠️  Skipping batch for ${category}`);
        } else {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }
  }

  return allRecipes;
}

async function seedWithAI() {
  console.log('🚀 Starting AI-powered recipe generation...\n');

  // Clear existing recipes
  console.log('📋 Clearing existing official recipes...');
  await sql`DELETE FROM official_recipes`;
  console.log('✅ Cleared\n');

  let totalGenerated = 0;

  for (const dist of DISTRIBUTION) {
    console.log(`\n📝 Generating ${dist.count} ${dist.category} recipes...`);

    const recipes = await generateRecipesForCategory(
      dist.category,
      dist.subCategories,
      dist.count,
      20 // batch size
    );

    console.log(`  Inserting ${recipes.length} recipes into database...`);

    for (const recipe of recipes) {
      await sql`
        INSERT INTO official_recipes (
          imported_by_user_id, name, description, image, thumbnail_url,
          cook_time, servings, difficulty, recipe_category,
          ingredients, steps, tags, source_type, source_url, source_url_hash,
          source_author, tips, is_active
        ) VALUES (
          'ai-generator', ${recipe.name}, ${recipe.description}, NULL, NULL,
          ${recipe.cookTime}, ${recipe.servings}, ${recipe.difficulty}, ${recipe.recipeCategory},
          ${JSON.stringify(recipe.ingredients)}, ${JSON.stringify(recipe.steps)}, ${JSON.stringify(recipe.tags)},
          'manual', NULL, NULL, NULL, NULL, true
        )
      `;
    }

    totalGenerated += recipes.length;
    console.log(`  ✅ Total ${dist.category}: ${recipes.length} recipes`);
  }

  // Verify
  const count = await sql`SELECT COUNT(*) as count FROM official_recipes`;
  console.log(`\n✅ Total recipes in database: ${count[0].count}`);
  console.log(`🎉 AI generation complete! Generated ${totalGenerated} unique recipes.`);

  await sql.end();
}

seedWithAI().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
