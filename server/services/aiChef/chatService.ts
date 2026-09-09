import { invokeLLM } from '../../_core/llm';
import { getRandomRecipes } from './libraryService';
import { parseRecipesFromLLM } from './recipeParser';
import { buildSystemPrompt, buildShortPrompt } from './promptBuilder';
import type { SuggestedRecipe } from '../../routers/aiRecipe';
import type { Message } from '../../_core/llm';

export interface ChatOptions {
  familyId?: number;
  userId?: number;
  mode?: 'chat' | 'recipe' | 'library';
  count?: number;
  soupIntent?: boolean;
  instant?: boolean;
  source?: 'library' | 'ai';
}

export interface ChatResult {
  content: string;
  recipes: SuggestedRecipe[];
  nextSteps?: string[];
}

/**
 * Main chat entry point
 */
export async function processChat(
  messages: Message[],
  options: ChatOptions
): Promise<ChatResult> {
  const { familyId, userId, mode = 'chat', count, soupIntent = false, instant = false, source = 'ai' } = options;

  // Instant mode: bypass full chat flow
  if (instant) {
    return handleInstantMode(options);
  }

  // Regular chat flow
  return handleRegularChat(messages, options);
}

/**
 * Handle instant recipe requests (button clicks)
 */
async function handleInstantMode(options: ChatOptions): Promise<ChatResult> {
  const { familyId, count = 3, soupIntent = false, source = 'library' } = options;
  const recipes: SuggestedRecipe[] = [];
  let fromDb = 0;

  if (source === 'library') {
    // Try database first
    const dbResult = await getRandomRecipes({
      count,
      soupIntent,
      familyId,
    });
    recipes.push(...dbResult.recipes);
    fromDb = dbResult.fromDb;

    // If not enough, use AI to fill gap
    if (recipes.length < count) {
      const remaining = count - recipes.length;
      const aiRecipes = await generateAIRecipes(remaining, soupIntent);
      recipes.push(...aiRecipes);
    }
  } else {
    // AI generation
    const aiRecipes = await generateAIRecipes(count, soupIntent);
    recipes.push(...aiRecipes);
  }

  if (recipes.length === 0) {
    return {
      content: '暫時未有新食譜推薦，請重試。',
      recipes: [],
    };
  }

  return {
    content:
      fromDb > 0
        ? `我喺食譜庫揀咗 ${fromDb} 個可煮選擇${soupIntent ? '（包含湯水）' : ''}${recipes.length > fromDb ? `，同 ${recipes.length - fromDb} 個 AI 生成建議` : ''}。`
        : `我幫你生成咗 ${recipes.length} 個食譜建議。`,
    recipes,
  };
}

/**
 * Handle regular chat flow
 */
async function handleRegularChat(messages: Message[], options: ChatOptions): Promise<ChatResult> {
  const { familyId, mode = 'chat', soupIntent = false } = options;

  // Build system prompt
  const systemPrompt = buildSystemPrompt({
    mode,
    soupIntent,
    libraryContext: '',
  });

  const allMessages: Message[] = [{ role: 'system', content: systemPrompt }, ...messages];

  try {
    const result = await invokeLLM({
      messages: allMessages,
      maxTokens: 3000,
      temperature: 0.9,
      timeoutMs: 45000,
      enableSearch: false,
    });

    const content = result.choices?.[0]?.message?.content || '';
    const recipes = parseRecipesFromLLM(content);

    return {
      content,
      recipes,
    };
  } catch (e) {
    console.warn('[processChat] LLM call failed:', e);
    return {
      content: 'AI 暫時未能回應，請重試。',
      recipes: [],
    };
  }
}

/**
 * Generate recipes using AI
 */
async function generateAIRecipes(count: number, soupIntent: boolean): Promise<SuggestedRecipe[]> {
  try {
    const prompt = buildShortPrompt({ count, soupIntent, source: 'ai' });
    const timeoutMs = count >= 4 ? 45000 : 30000;

    const result = await invokeLLM({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 1200 * count,
      temperature: 0.9,
      timeoutMs,
      enableSearch: false,
    });

    const content = result.choices?.[0]?.message?.content || '';
    const recipes = parseRecipesFromLLM(content);
    return recipes.slice(0, count);
  } catch (e) {
    console.warn('[generateAIRecipes] Failed:', e);
    return [];
  }
}
