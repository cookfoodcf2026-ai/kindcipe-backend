import { getDb } from '../../db';
import { officialRecipes, customRecipes } from '../../../drizzle/schema';
import type { SuggestedRecipe } from '../../routers/aiRecipe';
import { eq } from 'drizzle-orm';

export interface GetRandomRecipesOptions {
  count: number;
  soupIntent: boolean;
  familyId: number | undefined;
  excludeNames?: Set<string>;
}

export async function getRandomRecipes(
  options: GetRandomRecipesOptions
): Promise<{ recipes: SuggestedRecipe[]; fromDb: number }> {
  const { count, soupIntent, familyId, excludeNames = new Set() } = options;
  const db = await getDb();
  const recipes: SuggestedRecipe[] = [];
  let fromDb = 0;

  if (!db) return { recipes, fromDb: 0 };

  try {
    // Fetch from both official and custom recipes
    const [officialResult, customResult] = await Promise.all([
      db
        .select()
        .from(officialRecipes)
        .where(eq(officialRecipes.isActive, true))
        .limit(50),
      familyId
        ? db.select().from(customRecipes).where(eq(customRecipes.familyId, familyId)).limit(50)
        : Promise.resolve([]),
    ]);

    let allRecipes = [...officialResult, ...(customResult || [])];

    // Filter out excluded names (recently used)
    if (excludeNames.size > 0) {
      allRecipes = allRecipes.filter((r) => !excludeNames.has(r.name));
    }

    if (soupIntent) {
      // Separate soup and non-soup recipes
      const isSoupRecipe = (r: any) => {
        const tagsStr = JSON.stringify(r.tags || '');
        const soupTypeStr = JSON.stringify(r.soupType || '');
        const nameStr = String(r.name || '');
        return tagsStr.includes('湯') || soupTypeStr.includes('湯') || nameStr.includes('湯');
      };

      const soupRecipes = allRecipes.filter(isSoupRecipe);
      const nonSoupRecipes = allRecipes.filter((r) => !isSoupRecipe(r));

      // Pick 1 soup + (count-1) non-soup
      const soupCount = Math.min(1, soupRecipes.length);
      const nonSoupCount = Math.min(count - 1, nonSoupRecipes.length);

      // Shuffle and pick
      const shuffledSoup = soupRecipes.sort(() => Math.random() - 0.5).slice(0, soupCount);
      const shuffledNonSoup = nonSoupRecipes.sort(() => Math.random() - 0.5).slice(0, nonSoupCount);

      // Add soup first
      for (const r of shuffledSoup) {
        recipes.push(convertToSuggestedRecipe(r, true));
        fromDb++;
      }

      // Add non-soup
      for (const r of shuffledNonSoup) {
        recipes.push(convertToSuggestedRecipe(r, false));
        fromDb++;
      }
    } else {
      // Regular mode: just pick 'count' recipes
      const shuffled = allRecipes.sort(() => Math.random() - 0.5).slice(0, count);
      for (const r of shuffled) {
        recipes.push(convertToSuggestedRecipe(r, false));
        fromDb++;
      }
    }
  } catch (e) {
    console.warn('[getRandomRecipes] Failed:', e);
  }

  return { recipes, fromDb };
}

function convertToSuggestedRecipe(r: any, isSoup: boolean): SuggestedRecipe {
  const isOfficial = r._tableName === 'officialRecipes' || 'officialId' in r;
  const recipe: SuggestedRecipe = {
    name: String(r.name ?? ''),
    description: String(r.description ?? ''),
    cookTime: Number(r.cookTime ?? 30),
    servings: Number(r.servings ?? 4),
    difficulty: String(r.difficulty ?? 'medium') as 'easy' | 'medium' | 'hard',
    ingredients: Array.isArray(r.ingredients)
      ? (r.ingredients as any[]).map((i: any) => ({
          name: String(i.name ?? ''),
          quantity: String(i.quantity ?? ''),
          unit: String(i.unit ?? ''),
        }))
      : [],
    steps: Array.isArray(r.steps)
      ? (r.steps as any[]).map((s: any) => String(s.instruction ?? s.text ?? ''))
      : [],
    tags: Array.isArray(r.tags) ? (r.tags as any[]).map(String) : [],
    source: isOfficial ? ('official' as const) : ('custom' as const),
    officialId: isOfficial ? (r.id as number) : undefined,
    customId: !isOfficial ? (r.id as number) : undefined,
  };

  if (isSoup) {
    recipe.soupType = (r as any).soupType || undefined;
    recipe.benefits = (r as any).benefits || undefined;
    recipe.waterVolume = (r as any).waterVolume || undefined;
  }

  return recipe;
}
