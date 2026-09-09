import type { SuggestedRecipe } from '../../routers/aiRecipe';

/**
 * Parse recipes from LLM response
 * Supports both JSON and text format
 * NO hardcoded fallbacks - returns empty array if parsing fails
 */
export function parseRecipesFromLLM(content: string): SuggestedRecipe[] {
  if (!content || typeof content !== 'string') {
    return [];
  }

  // Try JSON first
  const extracted = extractJSON(content);
  if (extracted && typeof extracted === 'object') {
    const validated = validateRecipeData(extracted);
    if (validated.length > 0) {
      return validated;
    }
  }

  // Fallback to text parsing
  const textParsed = parseRecipesFromText(content);
  return textParsed;
}

function extractJSON(text: string): any {
  try {
    // Try direct parse
    const direct = JSON.parse(text);
    if (direct) return direct;
  } catch {}

  try {
    // Try to find JSON block
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {}

  try {
    // Try to find array
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      return JSON.parse(arrayMatch[0]);
    }
  } catch {}

  return null;
}

function validateRecipeData(data: any): SuggestedRecipe[] {
  try {
    // Handle array of recipes
    if (Array.isArray(data)) {
      return data.map((r) => normalizeRecipe(r)).filter((r) => isValidRecipe(r));
    }

    // Handle object with recipes array
    if (data.recipes && Array.isArray(data.recipes)) {
      return data.recipes.map((r: any) => normalizeRecipe(r)).filter((r: any) => isValidRecipe(r));
    }

    // Handle single recipe
    if (data.name) {
      const normalized = normalizeRecipe(data);
      return isValidRecipe(normalized) ? [normalized] : [];
    }

    return [];
  } catch {
    return [];
  }
}

function normalizeRecipe(r: any): SuggestedRecipe {
  return {
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
    source: (r.source as 'official' | 'custom' | 'ai') ?? 'ai',
    officialId: r.officialId as number | undefined,
    customId: r.customId as number | undefined,
    soupType: r.soupType as string | undefined,
    benefits: r.benefits as string | undefined,
    waterVolume: r.waterVolume as string | undefined,
  };
}

function isValidRecipe(r: SuggestedRecipe): boolean {
  if (!r.name || typeof r.name !== 'string' || r.name.length < 2 || r.name.length > 50) return false;
  if (!Array.isArray(r.ingredients) || r.ingredients.length === 0) return false;
  if (!Array.isArray(r.steps) || r.steps.length === 0) return false;
  return true;
}

function parseRecipesFromText(text: string): SuggestedRecipe[] {
  const recipes: SuggestedRecipe[] = [];

  // Split by recipe headers
  const blocks = text.split(/(?=食譜\s*[一二三四五六七八九十\d]+[：:\s])/);

  for (const block of blocks) {
    const headerMatch = block.match(
      /(?:食譜\s*[一二三四五六七八九十\d]+|[一二三四五六七八九十\d]+[.､．])\s*[：:]\s*(.+?)\s*(?:——|—|--|-|：)\s*(.+?)(?:[(（]約?\s*(\d+)\s*分鐘[)）])?(?:\n|$)/
    );

    if (!headerMatch) continue;

    const category = headerMatch[1].trim();
    const name = headerMatch[2].replace(/^[—\-:\s]+/, '').trim();
    const cookTime = headerMatch[3] ? parseInt(headerMatch[3], 10) : 30;

    if (!name || name.length < 2) continue;

    // Parse ingredients
    const ingredients: SuggestedRecipe['ingredients'] = [];
    const ingSection = block.match(/(?:🛒\s*)?(?:食材 | 材料 | 原料|Ingredients)[：:]([\s\S]*?)(?=🍳|步驟 | 做法|---|$)/i);
    if (ingSection) {
      const ingLines = ingSection[1].split('\n').filter((l) => l.trim());
      for (const line of ingLines) {
        const parsed = parseIngredientLine(line);
        ingredients.push(...parsed);
      }
    }

    // Parse steps
    const steps: string[] = [];
    const stepsSection = block.match(/🍳\s*步驟 [：:]([\s\S]*?)(?=---|$)/);
    if (stepsSection) {
      const stepLines = stepsSection[1].split('\n').filter((l) => l.trim());
      for (const line of stepLines) {
        const stepMatch = line.match(/^\d+[.､．]\s*(.+)/);
        if (stepMatch) {
          steps.push(stepMatch[1].trim());
        }
      }
    }

    // Parse description
    const descMatch = block.match(/[)）]\s*\n+([\s\S]*?)(?=🛒|$)/);
    const description = descMatch ? descMatch[1].trim().split('\n')[0] : '';

    const soupMeta = extractSoupMeta(block);
    const filteredIngredients = ingredients.filter((ing) => ing.name && ing.name !== '食材');
    const tags = [category];
    if (soupMeta.soupType) tags.push(...soupMeta.soupType.split(/[、,，/／|｜\s]+/).filter(Boolean));
    if (soupMeta.benefits) tags.push(...soupMeta.benefits.split(/[、,，/／|｜\s]+/).filter(Boolean));

    if (filteredIngredients.length > 0 && steps.length > 0) {
      recipes.push({
        name,
        cookTime,
        servings: 4,
        difficulty: '中等',
        description,
        ingredients: filteredIngredients,
        steps,
        tags: [...new Set(tags)],
        soupType: soupMeta.soupType || undefined,
        benefits: soupMeta.benefits || undefined,
        waterVolume: soupMeta.waterVolume || undefined,
      });
    }
  }

  return recipes;
}

function parseIngredientLine(line: string): SuggestedRecipe['ingredients'] {
  const clean = line.replace(/[（(][^)）]*[)）]/g, '').trim();
  const match = clean.match(/(.+?)\s+([\d.]+|半 | 一 | 兩 | 二 | 三 | 四 | 五 | 六 | 七 | 八 | 九 | 十 | 幾 | 若干 | 少許 | 適量 | 些許)\s*(克 | 毫升|ml|g|kg|個 | 條 | 隻 | 片 | 碗 | 湯匙 | 茶匙 | 匙 | 包 | 盒 | 粒 | 瓣 | 棵 | 紮 | 杯 | 碟 | 勺 | 份 | 根 | 塊 | 斤 | 磅|oz|lb)?/);

  if (match) {
    return [
      {
        name: match[1].trim(),
        quantity: match[2] || '適量',
        unit: match[3] || '',
      },
    ];
  }

  return [{ name: clean, quantity: '適量', unit: '' }];
}

function extractSoupMeta(block: string): { soupType?: string; benefits?: string; waterVolume?: string } {
  const readField = (patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const match = block.match(pattern);
      if (match?.[1]) return match[1].trim();
    }
    return '';
  };

  return {
    soupType: readField([/(?:湯類型 | 湯種 | 類型|Soup\s*Type)[：:]\s*([^\n]+)/i]),
    benefits: readField([/(?:功效|Benefits?)[：:]\s*([^\n]+)/i]),
    waterVolume: readField([/(?:水量 | 用水 | 湯水用水|Water\s*Volume)[：:]\s*([^\n]+)/i]),
  };
}
