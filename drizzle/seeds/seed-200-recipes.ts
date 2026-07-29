import 'dotenv/config';
import postgres from 'postgres';
import { BASE_20_RECIPES } from './recipes-base-20.js';
import { HK_STEAMED_RECIPES } from './recipes-hk-steamed.js';
import { HK_FRIED_RECIPES } from './recipes-hk-fried.js';
import { HK_STIRFRY_RECIPES } from './recipes-hk-stirfry.js';
import { HK_BRAISED_RECIPES } from './recipes-hk-braised.js';
import { HK_COLD_SOUP_RECIPES } from './recipes-hk-cold-soup.js';
import { INTL_ASIAN_RECIPES } from './recipes-intl-asian.js';
import { INTL_WESTERN_DESSERT_RECIPES } from './recipes-intl-western-dessert.js';
import { CUSTOM_QUICK_RECIPES } from './recipes-custom-quick.js';

const sql = postgres(process.env.DATABASE_URL!);

// Combine all recipes
const ALL_200_RECIPES = [
  ...BASE_20_RECIPES,
  ...HK_STEAMED_RECIPES,
  ...HK_FRIED_RECIPES,
  ...HK_STIRFRY_RECIPES,
  ...HK_BRAISED_RECIPES,
  ...HK_COLD_SOUP_RECIPES,
  ...INTL_ASIAN_RECIPES,
  ...INTL_WESTERN_DESSERT_RECIPES,
  ...CUSTOM_QUICK_RECIPES,
];

async function main() {
  console.log(`🚀 Master seeding of ALL 200 recipes...\n`);

  // Clear existing official recipes
  console.log('📋 Clearing existing official recipes...');
  await sql`DELETE FROM official_recipes`;
  console.log('✅ Cleared table successfully.\n');

  // Validate recipe counts and types
  console.log(`📊 Statistics of the seed database:`);
  console.log(`   - Base Chinese: ${BASE_20_RECIPES.length}`);
  console.log(`   - HK Steamed:   ${HK_STEAMED_RECIPES.length}`);
  console.log(`   - HK Fried:     ${HK_FRIED_RECIPES.length}`);
  console.log(`   - HK Stirfry:   ${HK_STIRFRY_RECIPES.length}`);
  console.log(`   - HK Braised:   ${HK_BRAISED_RECIPES.length}`);
  console.log(`   - HK Cold/Soup: ${HK_COLD_SOUP_RECIPES.length}`);
  console.log(`   - Intl Asian:   ${INTL_ASIAN_RECIPES.length}`);
  console.log(`   - Intl West/Des:${INTL_WESTERN_DESSERT_RECIPES.length}`);
  console.log(`   - Custom Quick: ${CUSTOM_QUICK_RECIPES.length}`);
  console.log(`   -----------------------------`);
  console.log(`   - TOTAL:        ${ALL_200_RECIPES.length} recipes\n`);

  if (ALL_200_RECIPES.length < 200) {
    console.warn(`⚠️ Warning: Expected at least 200 recipes, but got ${ALL_200_RECIPES.length}. Continuing with available list...`);
  }

  // Validate no duplicates
  const names = ALL_200_RECIPES.map(r => r.name);
  const uniqueNames = new Set(names);
  if (names.length !== uniqueNames.size) {
    console.error('❌ Duplicate recipe names found!');
    const duplicates = names.filter((item, index) => names.indexOf(item) !== index);
    console.error('   Duplicates list:', Array.from(new Set(duplicates)));
    process.exit(1);
  }

  // Validate no numbered suffixes
  const numberedPattern = /\(\d+\)$/;
  for (const name of names) {
    if (numberedPattern.test(name)) {
      console.error(`❌ Recipe name has numbered suffix: ${name}`);
      process.exit(1);
    }
  }

  console.log(`✅ Validation passed: All recipe names are unique and have no numbered suffixes.\n`);

  // Insert recipes
  let insertedCount = 0;
  for (const recipe of ALL_200_RECIPES) {
    await sql`
      INSERT INTO official_recipes (
        imported_by_user_id, name, description, image, thumbnail_url,
        cook_time, servings, difficulty, recipe_category,
        ingredients, steps, tags, source_type, source_url, source_url_hash,
        source_author, tips, is_active
      ) VALUES (
        'seed-generator', ${recipe.name}, ${recipe.description}, NULL, NULL,
        ${recipe.cookTime}, ${recipe.servings}, ${recipe.difficulty}, ${recipe.recipeCategory},
        ${JSON.stringify(recipe.ingredients)}, ${JSON.stringify(recipe.steps)}, ${JSON.stringify(recipe.tags)},
        'manual', NULL, NULL, NULL, NULL, true
      )
    `;
    insertedCount++;
    if (insertedCount % 20 === 0 || insertedCount === ALL_200_RECIPES.length) {
      console.log(`  ✅ Progress: Inserted ${insertedCount}/${ALL_200_RECIPES.length} recipes...`);
    }
  }

  // Verify
  const count = await sql`SELECT COUNT(*) as count FROM official_recipes`;
  console.log(`\n✅ Verification: Total recipes now in database: ${count[0].count}`);

  const categories = await sql`SELECT recipe_category, COUNT(*) as count FROM official_recipes GROUP BY recipe_category`;
  console.log('\nCategories distribution inside DB:', categories);

  await sql.end();
  console.log('\n🎉 Master seeding process complete!');
}

main().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
