import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, or, ilike, desc, lte } from "drizzle-orm";
import { protectedProcedure, familyWriteProcedure, router } from "../_core/trpc";
import { invokeLLM, extractJSON, repairJSON, Message, MessageContent, TextContent, ImageContent } from "../_core/llm";
import { getDb, getFamilySubscription, getAiChatUsage, incrementAiChatUsage, countCustomRecipesCreatedThisMonth, insertCustomRecipe } from "../db";
import { storageGetSignedUrl } from "../storage";
import { officialRecipes, customRecipes, pantryItems } from "../../drizzle/schema";
import { normalizeQuery, segmentQuery, resolveForeignToChinese, getKeywordVariants } from "./recipes";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

const contentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("image_url"), image_url: z.object({ url: z.string() }) }),
]);

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.union([z.string(), z.array(contentBlockSchema)]),
});

const modeSchema = z.enum(["library", "ai"]).optional();

const aiRecipeIngredientSchema = z.object({
  name: z.string(),
  quantity: z.string().optional(),
  unit: z.string().optional(),
  category: z.string().optional(),
});

const aiRecipeStepSchema = z.object({
  instruction: z.string(),
  duration: z.number().int().optional(),
  tip: z.string().optional(),
});

const aiRecipeSourceSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  image: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  cookTime: z.number().int().optional(),
  servings: z.number().int().optional(),
  difficulty: z.string().optional(),
  recipeCategory: z.string().optional(),
  ingredients: z.array(aiRecipeIngredientSchema),
  steps: z.array(aiRecipeStepSchema),
  tags: z.array(z.string()).optional(),
  sourceAuthor: z.string().optional(),
});

const aiEditSaveInputSchema = z.object({
  recipe: aiRecipeSourceSchema,
  editPrompt: z.string().min(1).max(1000),
});

const aiEditOutputSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  cookTime: z.number().int(),
  servings: z.number().int(),
  difficulty: z.string(),
  recipeCategory: z.string(),
  ingredients: z.array(aiRecipeIngredientSchema),
  steps: z.array(aiRecipeStepSchema),
  tags: z.array(z.string()),
});

/**
 * Four-Layer Protection Schema for AI Chef JSON parsing
 * Layer 3: Zod validation with default values to prevent crashes
 */
const aiRecipeResponseSchema = z.object({
  title: z.string().default("未命名食譜"),
  name: z.string().default("未命名食譜"),
  ingredients: z.array(z.object({
    name: z.string().default("未知食材"),
    quantity: z.string().default("適量"),
    unit: z.string().default(""),
  })).default([]),
  instructions: z.array(z.string()).default([]),
  steps: z.array(z.string()).default([]),
  cookTime: z.number().int().default(30),
  servings: z.number().int().default(4),
  difficulty: z.string().default("中等"),
  description: z.string().default(""),
  recipeCategory: z.string().default("其他"),
  tags: z.array(z.string()).default([]),
  soupType: z.string().optional(),
  benefits: z.string().optional(),
  waterVolume: z.string().optional(),
});

/**
 * AI Edit Differential Check - Prevents over-editing
 * Validates that edited recipe is still a reasonable variation of the original
 */
interface EditValidationResult {
  safe: boolean;
  issues: string[];
  autoFixes: Partial<SuggestedRecipe>;
}

function validateEditDifferential(original: any, edited: z.infer<typeof aiEditOutputSchema>): EditValidationResult {
  const issues: string[] = [];
  const autoFixes: Partial<SuggestedRecipe> = {};
  
  // 1. Title similarity check (prevent complete name change)
  const originalTitle = original.name || "";
  const editedTitle = edited.name || "";
  const titleSimilarity = calculateStringSimilarity(originalTitle, editedTitle);
  
  if (titleSimilarity < 0.3 && originalTitle.length > 2 && editedTitle.length > 2) {
    issues.push(`Title changed significantly: "${originalTitle}" → "${editedTitle}" (similarity: ${titleSimilarity})`);
    // Auto-fix: keep original title if user didn't explicitly request name change
    autoFixes.name = originalTitle;
  }
  
  // 2. Core ingredient preservation check (protein main ingredients)
  const originalIngredients = original.ingredients?.map((ing: any) => ing.name) || [];
  const editedIngredients = edited.ingredients.map(ing => ing.name);
  
  const proteinKeywords = ["雞", "鴨", "鵝", "豬", "牛", "羊", "魚", "蝦", "蟹", "貝", "瘦肉", "排骨", "雞肉", "牛肉", "豬肉", "羊肉", "豆腐", "蛋", "雞蛋"];
  const originalProteins = originalIngredients.filter((name: string) => proteinKeywords.some(kw => name.includes(kw)));
  
  if (originalProteins.length > 0) {
    const missingProteins = originalProteins.filter((protein: string) => 
      !editedIngredients.some(name => name.includes(protein) || protein.includes(name))
    );
    
    if (missingProteins.length > 0) {
      issues.push(`Core protein ingredients removed: ${missingProteins.join(", ")}`);
      // Auto-fix: add back missing proteins (conservative approach - just warn, don't auto-add)
    }
  }
  
  // 3. Step count reasonableness check
  const originalSteps = original.steps?.length || 0;
  const editedSteps = edited.steps.length;
  
  if (originalSteps > 0 && editedSteps < originalSteps * 0.4) {
    issues.push(`Steps reduced too much: ${originalSteps} → ${editedSteps} (less than 40% of original)`);
  }
  
  // 4. Ingredient count reasonableness check  
  const originalIngCount = originalIngredients.length || 0;
  const editedIngCount = editedIngredients.length;
  
  if (originalIngCount > 3 && editedIngCount < originalIngCount * 0.3) {
    issues.push(`Ingredients reduced too much: ${originalIngCount} → ${editedIngCount} (less than 30% of original)`);
  }
  
  return {
    safe: issues.length === 0,
    issues,
    autoFixes,
  };
}

/**
 * Simple string similarity calculation (Levenshtein-based)
 */
function calculateStringSimilarity(s1: string, s2: string): number {
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  const longerLength = longer.length;
  
  if (longerLength === 0) return 1.0;
  
  const editDistance = computeLevenshteinDistance(longer, shorter);
  return (longerLength - editDistance) / longerLength;
}

function computeLevenshteinDistance(s1: string, s2: string): number {
  const s1Len = s1.length;
  const s2Len = s2.length;
  const matrix: number[][] = [];
  
  for (let i = 0; i <= s1Len; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= s2Len; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= s1Len; i++) {
    for (let j = 1; j <= s2Len; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  
  return matrix[s1Len][s2Len];
}

const AI_RECIPE_MAX_TOKENS = 1400;
const AI_RECIPE_CONTEXT_TIMEOUT_MS = 15000;
const AI_RECIPE_LLM_TIMEOUT_MS = 29000;
const AI_RECIPE_CHAT_TIMEOUT_MS = 29000;
const AI_RECIPE_FALLBACK_CONTENT = "我想幫你整得更準，可以再補充一點人數、口味或忌口，我再試一次。";

/**
 * Four-Layer Recipe Parser with Fallback
 * Layer 1: extractJSON() - Extract JSON from mixed content
 * Layer 2: repairJSON() - Fix common JSON issues (unquoted keys, truncation)
 * Layer 3: Zod validation - Schema validation with default values
 * Layer 4: parseRecipesFromText() - Fallback to text parser if JSON completely fails
 * 
 * Always returns a valid array of recipes, NEVER crashes or returns undefined
 */
function parseRecipeWithFallback(llmContent: string): SuggestedRecipe[] {
  const parseStart = Date.now();
  let layerUsed = 1;
  
  try {
    // Layer 1: Extract JSON from content
    const extracted = extractJSON(llmContent);
    
    if (!extracted || typeof extracted !== 'object') {
      console.log("[AI Chef] Layer 4: JSON extraction failed, using text parser");
      layerUsed = 4;
      return parseRecipesFromText(llmContent);
    }
    
    // Layer 2: Repair JSON if needed
    const jsonString = JSON.stringify(extracted);
    const repaired = repairJSON(jsonString);
    
    // Check if repair actually changed something
    if (repaired !== jsonString) {
      console.log("[AI Chef] Layer 2: JSON repaired", {
        original: jsonString.slice(0, 100),
        repaired: repaired.slice(0, 100)
      });
    }
    
    // Layer 3: Validate with Zod schema
    const parsed = JSON.parse(repaired);
    const validated = aiRecipeResponseSchema.safeParse(parsed);
    
    if (!validated.success) {
      console.log("[AI Chef] Layer 3: Zod validation failed, using defaults", {
        issues: validated.error.issues.slice(0, 3),
        content: llmContent.slice(0, 200)
      });
      layerUsed = 3;
      const recipeData = aiRecipeResponseSchema.parse({});
      const result = convertRecipeDataToSuggestedRecipe(recipeData);
      console.log("[AI Chef] Parse completed", { layer: layerUsed, duration: Date.now() - parseStart, recipes: result.length });
      return result;
    }
    
    // Convert validated data to SuggestedRecipe[]
    const result = convertRecipeDataToSuggestedRecipe(validated.data);
    console.log("[AI Chef] Parse completed", { layer: layerUsed, duration: Date.now() - parseStart, recipes: result.length });
    return result;
    
  } catch (error) {
    console.log("[AI Chef] Layer 4: Exception in JSON parsing, using text fallback", { 
      error: String(error),
      duration: Date.now() - parseStart
    });
    layerUsed = 4;
    const result = parseRecipesFromText(llmContent);
    console.log("[AI Chef] Text fallback completed", { duration: Date.now() - parseStart, recipes: result.length });
    return result;
  }
}

/**
 * Helper: Convert validated Zod schema data to SuggestedRecipe[]
 */
function convertRecipeDataToSuggestedRecipe(data: z.infer<typeof aiRecipeResponseSchema>): SuggestedRecipe[] {
  const recipe: SuggestedRecipe = {
    name: data.title !== "未命名食譜" ? data.title : data.name,
    cookTime: data.cookTime,
    servings: data.servings,
    difficulty: data.difficulty,
    description: data.description,
    ingredients: data.ingredients.map(ing => ({
      name: ing.name,
      quantity: ing.quantity ?? "適量",
      unit: ing.unit ?? "",
    })),
    steps: data.steps.length > 0 ? data.steps : data.instructions,
    tags: data.tags,
    soupType: data.soupType,
    benefits: data.benefits,
    waterVolume: data.waterVolume,
  };
  
  // Filter out placeholder ingredients
  const filteredIngredients = recipe.ingredients.filter(ing => !isPlaceholderIngredientName(ing.name));
  
  // Only return valid recipes (must have name and at least one ingredient/step)
  if (filteredIngredients.length > 0 && recipe.steps.length > 0) {
    return [recipe];
  }
  
  // If invalid, fallback to text parser
  return [];
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export type SuggestedRecipe = {
  name: string;
  cookTime: number;
  servings: number;
  difficulty: string;
  description: string;
  ingredients: { name: string; quantity: string; unit: string }[];
  steps: string[];
  tags: string[];
  soupType?: string;
  benefits?: string;
  waterVolume?: string;
  source?: "official" | "custom" | "ai";
  officialId?: number;
  customId?: number;
};

// ─── Tools ─────────────────────────────────────────────────

const TOOLS: Array<{
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> = [
  {
    type: "function",
    function: {
      name: "searchRecipes",
      description: "搜尋已有的官方食譜或用戶自創食譜，根據關鍵字、分類等條件過濾",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜尋關鍵字，例如食材名、菜式名" },
          category: { type: "string", description: "分類過濾，例如：粵菜、日式、西式、家常" },
          limit: { type: "number", description: "最多回傳幾多個結果，預設5" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getPantryItems",
      description: "查看雪櫃/ pantry 有咩食材存貨（只包括仲有存貨嘅項目）",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "getWeather",
      description: "查看香港而家嘅天氣狀況（溫度、天氣描述）",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "fetchRecipeFromUrl",
      description: "從食譜網址獲取完整食譜內容（食材、步驟、圖片）。當搜尋結果有食譜網址時，使用此工具讀取詳細內容以確保步驟完整。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "食譜網頁的完整 URL" },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
  },
];

// ─── Tool Execution ──────────────────────────────────────

function safeParseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try { const p = JSON.parse(value); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

async function execSearchRecipes(
  db: Db, args: { query: string; category?: string; limit?: number }, familyId?: number
) {
  const limit = args.limit ?? 15;
  const results: Record<string, unknown>[] = [];

  // 時間約束：單獨抽「N 分鐘」→ cookTime ≤ N；其餘字詞照常 AND 搜尋
  // 時間命中（cookTime 合符）可獨立命中，唔受關鍵字完全吻合限制（例如「30分鐘快煮」搵 30 分鐘食譜）
  const timeMatch = args.query.trim().toLowerCase().match(/(\d{1,3})\s*分鐘/);
  const minutes = timeMatch ? parseInt(timeMatch[1], 10) : undefined;
  const rawQuery = minutes && minutes > 0 ? args.query.replace(/(\d{1,3})\s*分鐘/g, " ") : args.query;

  // 與食譜搜尋一致：外文 → 中文 → 繁簡歸一 → 分詞，AND 組合（每關鍵字以變體 OR 擴充）
  const hasForeign = /[a-z]/i.test(rawQuery);
  const resolved = hasForeign ? await resolveForeignToChinese(rawQuery) : rawQuery.trim().toLowerCase();
  const normalized = normalizeQuery(resolved);
  const keywords = segmentQuery(normalized);

  const buildSearchCond = (table: any, fields: any[]) => {
    const textCond = keywords.length > 0
      ? and(...keywords.map(kw => {
          const variants = getKeywordVariants(kw);
          return or(...fields.flatMap(f => variants.map(v => ilike(f, `%${v}%`))));
        }))
      : undefined;
    const timeCond = minutes && minutes > 0 ? lte(table.cookTime, minutes) : undefined;
    return textCond && timeCond ? or(textCond, timeCond) : (textCond ?? timeCond);
  };

  const official = await db
    .select({
      id: officialRecipes.id, name: officialRecipes.name, description: officialRecipes.description,
      cookTime: officialRecipes.cookTime, servings: officialRecipes.servings, difficulty: officialRecipes.difficulty,
      recipeCategory: officialRecipes.recipeCategory, ingredients: officialRecipes.ingredients,
      steps: officialRecipes.steps, tags: officialRecipes.tags, thumbnailUrl: officialRecipes.thumbnailUrl,
    })
    .from(officialRecipes)
    .where(and(
      eq(officialRecipes.isActive, true),
      buildSearchCond(officialRecipes, [officialRecipes.name, officialRecipes.description, officialRecipes.tags, officialRecipes.ingredients]),
      args.category ? eq(officialRecipes.recipeCategory, args.category) : undefined,
    ))
    .orderBy(desc(officialRecipes.createdAt)).limit(limit);

  for (const r of official) results.push({
    source: "official", id: r.id, name: r.name, description: r.description, cookTime: r.cookTime,
    servings: r.servings, difficulty: r.difficulty, category: r.recipeCategory,
    ingredients: safeParseJsonArray(r.ingredients).slice(0, 8),
    steps: safeParseJsonArray(r.steps), tags: safeParseJsonArray(r.tags),
  });

  if (familyId) {
    const custom = await db
      .select({
        id: customRecipes.id, name: customRecipes.name, description: customRecipes.description,
        cookTime: customRecipes.cookTime, servings: customRecipes.servings, difficulty: customRecipes.difficulty,
        recipeCategory: customRecipes.recipeCategory, ingredients: customRecipes.ingredients,
        steps: customRecipes.steps, tags: customRecipes.tags, thumbnailUrl: customRecipes.thumbnailUrl,
      })
      .from(customRecipes)
      .where(and(
        eq(customRecipes.familyId, familyId),
        buildSearchCond(customRecipes, [customRecipes.name, customRecipes.description, customRecipes.tags, customRecipes.ingredients]),
        args.category ? eq(customRecipes.recipeCategory, args.category) : undefined,
      ))
      .orderBy(desc(customRecipes.createdAt)).limit(limit);

    for (const r of custom) results.push({
      source: "custom", id: r.id, name: r.name, description: r.description, cookTime: r.cookTime,
      servings: r.servings, difficulty: r.difficulty, category: r.recipeCategory,
      ingredients: safeParseJsonArray(r.ingredients).slice(0, 8),
      steps: safeParseJsonArray(r.steps), tags: safeParseJsonArray(r.tags),
    });
  }

  return { count: results.length, recipes: results.slice(0, limit) };
}

async function execGetPantryItems(db: Db, familyId?: number) {
  if (!familyId) return { items: [] };
  const items = await db
    .select({
      id: pantryItems.id, name: pantryItems.name, quantity: pantryItems.quantity,
      unit: pantryItems.unit, category: pantryItems.category,
      inStock: pantryItems.inStock, isLow: pantryItems.isLow, expiryDate: pantryItems.expiryDate,
    })
    .from(pantryItems)
    .where(and(eq(pantryItems.familyId, familyId), eq(pantryItems.inStock, true)));
  return { count: items.length, items };
}

async function execGetWeather() {
  try {
    const url = "https://api.open-meteo.com/v1/forecast?latitude=22.3193&longitude=114.1694&current=temperature_2m,weathercode,precipitation&timezone=Asia%2FHong_Kong";
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const data = (await res.json()) as { current: { temperature_2m: number; weathercode: number } };
    const tempC = data.current.temperature_2m;
    const code = data.current.weathercode;
    let description = "晴朗";
    if (code >= 95) description = "雷暴";
    else if (code >= 80) description = "陣雨";
    else if (code >= 51) description = "下雨";
    else if (code >= 45) description = "有霧";
    else if (code >= 1) description = "多雲";
    return { tempC, description };
  } catch { return { tempC: 25, description: "晴朗" }; }
}

async function execFetchRecipeFromUrl(args: { url: string }) {
  if (!args.url) return { error: "缺少 URL" };
  try {
    const resp = await fetch(args.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return { error: `HTTP ${resp.status}` };
    const html = await resp.text();

    // Clean HTML: remove scripts, styles, tags, collapse whitespace
    const cleaned = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s{2,}/g, "\n")
      .trim()
      .slice(0, 8000);

    if (cleaned.length < 50) return { error: "網頁內容太短或無法讀取" };

    const llmResp = await invokeLLM({
      messages: [
        { role: "system", content: "從以下網頁內容提取食譜。以 JSON 格式返回：name, cookTime (整數分鐘), servings (整數), difficulty (簡單/中等/困難), description, recipeCategory (中菜/西餐/日式/韓式/東南亞/甜品/飲品/其他), ingredients [{name, quantity, unit}], steps [string] (至少3步詳細做法), tags [string]。如果網頁內容不是食譜，返回 {error: 'no_recipe'}。" },
        { role: "user", content: cleaned },
      ],
      maxTokens: AI_RECIPE_MAX_TOKENS,
      temperature: 0.3,
      timeoutMs: AI_RECIPE_LLM_TIMEOUT_MS,
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "web_recipe_extract",
          strict: false,
          schema: {
            type: "object",
            properties: {
              name: { type: "string" },
              cookTime: { type: "integer" },
              servings: { type: "integer" },
              difficulty: { type: "string" },
              description: { type: "string" },
              recipeCategory: { type: "string" },
              ingredients: { type: "array", items: { type: "object", properties: { name: { type: "string" }, quantity: { type: "string" }, unit: { type: "string" } }, required: ["name", "quantity", "unit"], additionalProperties: false } },
              steps: { type: "array", items: { type: "string" } },
              tags: { type: "array", items: { type: "string" } },
              error: { type: "string" },
            },
            additionalProperties: false,
          },
        },
      },
    });

    const raw = llmResp.choices[0]?.message?.content || "{}";
    const result = extractJSON<Record<string, unknown>>(raw);
    if (result.error) return result;
    return { url: args.url, recipe: result };
  } catch (e: unknown) {
    return { error: String(e) };
  }
}

async function executeToolCall(
  db: Db, name: string, args: Record<string, unknown>,
  familyId?: number, userId?: number
): Promise<unknown> {
  switch (name) {
    case "searchRecipes": return execSearchRecipes(db, args as any, familyId);
    case "getPantryItems": return execGetPantryItems(db, familyId);
    case "getWeather": return execGetWeather();
    case "fetchRecipeFromUrl": return execFetchRecipeFromUrl(args as any);
    default: return { error: `Unknown tool: ${name}` };
  }
}

// ─── Helpers: Auto-search & dynamic system prompt ────────

// Extract a meaningful search query from conversation messages
function extractSearchQuery(messages: Message[]): string {
  const skipPatterns = [
    /換一批|換一換|另一組|再詳細|完整食譜|加入排餐|3餸1湯|今晚食咩|設計晚餐|設計今晚/i,
    /^請換|^可以換|^想點換/i,
  ];
  // Walk backwards to find the last substantive user message
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const text = typeof m.content === "string" ? m.content :
      Array.isArray(m.content) ? m.content.filter(b => b.type === "text").map(b => b.text).join(" ") : "";
    if (text.length < 4) continue;
    if (skipPatterns.some(p => p.test(text))) continue;
    return text.trim();
  }
  return ""; // fallback: empty query → get recent recipes
}

// Format library search results into a context string
function formatLibraryContext(results: Record<string, unknown>[]): string {
  if (results.length === 0) return "（食譜庫暫時沒有相關食譜）";
  const items = results.slice(0, 10).map((r: any) => {
    const source = r.source === "official" ? "官方" : "我的";
    return `- ${r.name}（${source}｜${r.category || "其他"}｜約${r.cookTime || "?"}分鐘｜${r.description?.slice(0, 30) || ""}）`;
  }).join("\n");
  return items;
}

// #1: 將用戶自己的 custom 食譜列出嚟俾 AI 認返（即使關鍵字搜尋 miss 咗）
async function listFamilyCustomSummary(db: Db | null, familyId?: number, limit = 40): Promise<string> {
  if (!db || !familyId) return "";
  try {
    const rows = await db.select({
      id: customRecipes.id,
      name: customRecipes.name,
      cookTime: customRecipes.cookTime,
      recipeCategory: customRecipes.recipeCategory,
    })
      .from(customRecipes)
      .where(eq(customRecipes.familyId, familyId))
      .orderBy(desc(customRecipes.createdAt))
      .limit(limit);
    if (rows.length === 0) return "";
    const items = rows.map((r: any) => `- ${r.name}（我的｜${r.recipeCategory || "其他"}｜約${r.cookTime || "?"}分鐘）`).join("\n");
    return `\n\n【用戶自訂食譜】\n${items}`;
  } catch (e) {
    console.warn("[AI Chef] listFamilyCustomSummary failed:", e);
    return "";
  }
}

function normalizeName(name: string): string {
  return normalizeQuery(name).replace(/\s+/g, "").replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "").trim();
}

function toCharBigrams(s: string): Set<string> {
  const set = new Set<string>();
  const chars = [...s];
  for (let i = 0; i < chars.length - 1; i++) set.add(chars[i] + chars[i + 1]);
  return set;
}

function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 1;
  const A = toCharBigrams(a), B = toCharBigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const c of A) if (B.has(c)) inter++;
  return inter / (A.size + B.size - inter);
}

function matchRecipeSource(recipeName: string, libResults: Record<string, unknown>[]): { source: "official" | "custom" | "ai"; officialId?: number; customId?: number } {
  const normName = normalizeName(recipeName);
  if (!normName) return { source: "ai" };
  // Pass 1: 完全吻合（原裝名）
  for (const r of libResults) {
    const libName = normalizeName(String(r.name ?? ""));
    if (libName && libName === normName) {
      if (r.source === "official" && typeof r.id === "number") return { source: "official", officialId: r.id };
      if (r.source === "custom" && typeof r.id === "number") return { source: "custom", customId: r.id };
    }
  }
  // Pass 2: 模糊匹配（AI 名稍有出入時認返庫）
  let best: { idx: number; score: number; entry: Record<string, unknown> } | null = null;
  for (let i = 0; i < libResults.length; i++) {
    const libName = normalizeName(String(libResults[i].name ?? ""));
    if (!libName) continue;
    const score = nameSimilarity(normName, libName);
    if (score >= 0.55 && (!best || score > best.score)) best = { idx: i, score, entry: libResults[i] };
  }
  if (best) {
    const r = best.entry;
    if (r.source === "official" && typeof r.id === "number") return { source: "official", officialId: r.id };
    if (r.source === "custom" && typeof r.id === "number") return { source: "custom", customId: r.id };
  }
  return { source: "ai" };
}

// #8: 對首輪未認到庫嘅食譜，按食譜名再搜一次庫，認返就補 source/id
async function applyLibraryMatch(
  db: Db | null,
  recipe: SuggestedRecipe,
  familyId?: number
): Promise<boolean> {
  if (!db) return false;
  if (recipe.source === "official" || recipe.source === "custom") return true;
  const name = String(recipe.name ?? "").trim();
  if (!name) return false;
  try {
    const res = await execSearchRecipes(db, { query: name, limit: 15 }, familyId);
    const entries = (res.recipes || []) as Record<string, unknown>[];
    const match = matchRecipeSource(name, entries);
    if (match.source === "official" || match.source === "custom") {
      recipe.source = match.source;
      if (match.officialId) recipe.officialId = match.officialId;
      if (match.customId) recipe.customId = match.customId;
      const libEntry = entries.find(lr => (match.source === "official" ? lr.id === match.officialId : lr.id === match.customId));
      if (libEntry) {
        if (typeof libEntry.servings === "number") recipe.servings = libEntry.servings;
        if (typeof libEntry.cookTime === "number") recipe.cookTime = libEntry.cookTime;
        if (typeof libEntry.difficulty === "string") recipe.difficulty = libEntry.difficulty;
        if (typeof libEntry.category === "string") recipe.tags = [...(recipe.tags ?? []), libEntry.category];
      }
      return true;
    }
  } catch (e) {
    console.warn("[AI Chef] applyLibraryMatch failed for", name, e);
  }
  return false;
}

// Build dynamic system prompt based on mode and library context
function buildSystemPrompt(mode: "library" | "ai" | undefined, libSummary: string, soupIntent = false): string {
  let modeSection = "";
  if (mode === "library") {
    modeSection = `\n\n📚 【只限食譜庫模式】你現在只能從以下食譜庫清單中推薦，**禁止生成任何新食譜**。推薦時必須原裝保留食譜名，唔好加 emoji / 改字 / 加前後綴。如果清單中沒有合適的，請明確告訴用戶「食譜庫暫時未有相關食譜，你可以按下面嘅 ✨ AI 生成 掣，我會幫你原創一組」。\n\n${libSummary}`;
  } else if (mode === "ai") {
    modeSection = `\n\n✨ 【AI 生成模式】以下係食譜庫已有嘅食譜清單。你生成嘅食譜**嚴禁**與清單中任何食譜名稱、主要食材組合或菜式相同／近似；如果你發現自己會生成到近似款，請改用另一個完全不同嘅菜式。如果庫內已經有啱用嘅食譜，請直接推薦庫內嗰個並話用戶知，唔好另作近似原創。\n\n${libSummary}`;
  } else {
    modeSection = `\n\n📖 【食譜庫現有食譜】以下係用戶食譜庫入面嘅食譜。請**優先**從以上清單推薦；清單無合適先 AI 生成新食譜。\n\n${libSummary}`;
  }

  if (soupIntent) {
    modeSection += `\n\n🍲 【湯水專屬規則】當你推薦湯水／燉湯／老火湯時，請在食譜正文中清晰標示以下欄位：\n- 湯類型：老火湯 / 滾湯 / 燉湯\n- 功效：例如 清熱潤肺、健脾益氣（只寫貼切內容，唔好誇大）\n- 水量：例如 1.5 升、1500 毫升、8 碗水\n- 食材欄必須列出實際需要嘅水 / 上湯 / 高湯 / 湯底，唔可以漏寫\n- 如果步驟會落薑、鹽或其他調味，食材欄亦要列出`;
  }

  return SYSTEM_PROMPT + modeSection;
}

function detectSoupIntent(messages: Message[]): boolean {
  const text = messages
    .filter((m) => m.role === "user")
    .map((m) => {
      if (typeof m.content === "string") return m.content;
      return m.content.filter((b) => b.type === "text").map((b) => b.text).join(" ");
    })
    .join(" ");
  return /(湯水|老火湯|滾湯|燉湯|煲湯|靚湯|湯品|soup|tonic)/i.test(text);
}

function extractSoupMeta(block: string): { soupType?: string; benefits?: string; waterVolume?: string } {
  const readField = (patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const match = block.match(pattern);
      if (match?.[1]) return match[1].trim();
    }
    return "";
  };
  return {
    soupType: readField([/(?:湯類型|湯種|類型|Soup\s*Type)[：:]\s*([^\n]+)/i]),
    benefits: readField([/(?:功效|Benefits?)[：:]\s*([^\n]+)/i]),
    waterVolume: readField([/(?:水量|用水|湯水用水|Water\s*Volume)[：:]\s*([^\n]+)/i]),
  };
}

// ─── Prompts ─────────────────────────────────────────────

const SYSTEM_PROMPT = `你是「Kindcipe」的 AI 私人廚師，專為香港家庭設計。只回答食譜、煮食、食材、餐飲規劃、營養同食物相關問題。非相關問題請禮貌婉轉拒絕。

你可以用以下工具：
- searchRecipes: 搜尋已有的官方食譜或用戶自創食譜（優先推薦用戶已有食譜）
- getPantryItems: 查看用戶雪櫃有咩食材存貨
- getWeather: 查看香港天氣
- fetchRecipeFromUrl: 從食譜網頁讀取完整食材同步驟（當搜尋結果有食譜網址時使用，確保步驟完整）

⚠️ 重要規則：
1. 當你無法辨識食材、用戶問題唔係問食譜、或者未能提供完整食譜時，請用**對話式回覆**，**切勿**使用「食譜一：類別 —— 名稱」格式
2. 只有真係推薦可煮食譜時，先使用食譜格式同輸出 \`---next-steps---\`
3. 優先使用 searchRecipes 搵用戶已有嘅官方 / 自訂食譜，搵唔到啱先 AI 生成新食譜
4. 當用戶影雪櫃相或問「我有呢啲食材可以煮咩」，先 call getPantryItems 了解庫存，再 call searchRecipes 搵現有食譜
5. 當用戶要求「加入排餐」時，請以食譜格式輸出完整食譜，然後提示用戶直接㩒呢度推薦卡片上嘅「加排餐」掣（唔係叫用戶去排餐頁）
6. ⚠️ 你**冇任何**「加入排餐／加入購物清單／收藏食譜／寫入庫」嘅工具。當用戶要求「加入排餐」「加入購物清單」「收藏」，你**唔可以**話「已幫你加入」「搞掂」「完成」，亦**絕對唔可以**叫用戶「去排餐頁／餐牌頁／購物頁／食譜庫手動加入」。正確做法：如果上面已經推薦咗食譜，話「你㩒上面卡片上嘅『加排餐』／『加入購物清單』／『收藏』掣就可以」；如果未推薦任何食譜，請先按格式推薦完整食譜，再提示用戶直接㩒呢度卡片上嘅掣操作。若同時唔想加入，可用對話式回覆引導

每次回覆煮食建議時，必須嚴格按照以下格式回覆。每個食譜必須包含完整食材同烹飪步驟，缺一不可。請勿使用對話式文字代替結構化格式。

請每次都提供不同的食譜建議，考慮不同菜系（中菜、西餐、日式、韓式、東南亞等）、不同蛋白質（雞、豬、牛、魚、蝦、豆腐等）、不同煮法（炒、蒸、炆、焗、燉、煲湯等）、不同季節食材，確保每次推薦都有新鮮感。

⚠️ 新鮮感但唔好太難：所謂「新鮮感」係指未煮過嘅家常菜，或者用返平日常見食材但換個新煮法。**嚴禁**推出需要特殊工具、罕見/難買食材、或者步驟極度複雜嘅菜式。保持喺「香港家庭日常可煮」嘅難度範圍內（避免慢火濃縮、低溫慢煮、分子料理、異國稀有食材等）。

格式如下：

食譜一：類別 —— 名稱（約XX分鐘）

一兩句簡短介紹這道菜的特色。

🛒 食材：
- 食材名：數量 單位
- 食材名：數量 單位
- 調味料：生抽 1湯匙、蠔油 半湯匙、糖 半茶匙、鹽 適量

🍳 步驟：
1. 步驟標題（第 X-Y 分鐘）：詳細動作描述，包括具體煮法、時間、火候、注意事項。
2. 步驟標題（第 X-Y 分鐘）：詳細動作描述。
3. 步驟標題（第 X-Y 分鐘）：詳細動作描述。
4. 步驟標題（第 X-Y 分鐘）：詳細動作描述。
5. 步驟標題（第 X-Y 分鐘）：詳細動作描述。

---

食譜二：類別 —— 名稱（約XX分鐘）
...（同樣格式）

⚠️ 【3 餸 1 湯／3 菜 1 湯】重要規則：當用戶要求「3 餸 1 湯」「晚餐推薦」「今晚食咩」時，你必須一次過生成**剛好 4 個**完整食譜（3 個主/配菜 + 1 個湯水），分類如下：
1. 食譜一：肉類主菜（如豬/牛/雞）
2. 食譜二：海鮮/其他蛋白（如魚/蝦/豆腐/蛋）
3. 食譜三：蔬菜/小炒
4. 食譜四：湯水
每個食譜都要用「食譜一：…」「食譜二：…」「食譜三：…」「食譜四：…」獨立成段，並用 --- 分隔，**唔可以只有 1 個食譜**。若用戶冇指明要幾個，單個食譜請求先輸出 1 個。

規則：
- 繁體中文，親切語氣
- 每個食譜必須有 4-6 個步驟，每個步驟都必須包含時間區間（第 X-Y 分鐘）
- 步驟描述必須詳細，包含具體動作、火力、時間、注意事項
- 每次推薦不同菜系、不同蛋白質、不同季節食材
- 用戶發送圖片時，幫佢睇圖入面有咩食材或菜式
- 建議完之後，用以下格式提供下一步選項：

---next-steps---
1. 幫我設計今晚 3餸1湯
2. 畀我完整食譜
3. 加入排餐`;

// ─── Direct recipe parser (replaces extractRecipes) ─────────

const ING_UNIT = "克|公斤|毫升|公升|ml|g|kg|個|條|隻|片|碗|湯匙|茶匙|匙|包|盒|粒|瓣|棵|紮|杯|量杯|碟|勺|份|根|塊|斤|磅|oz|lb|升|罐|支|樽|件|段|朵|兩|扎|把|顆|頭|尾|角|小包|小盒|小碗|小罐|小袋|小杯|小支|小枝|小個|小把";
const ING_NUM = "[零〇一二兩三四五六七八九十百千萬半點]+|\\d+(?:\\.\\d+)?";

function stripParens(s: string): string {
  // 先刪已閉合括號，再刪尾部未閉合括號（例如「青口（刷洗乾淨」）
  return s.replace(/[（(][^）)]*[）)]/g, "").replace(/[（(][^）)]*$/, "").trim();
}

const PLACEHOLDER_INGREDIENT_NAMES = new Set([
  "適量",
  "少許",
  "些許",
  "若干",
  "適宜",
  "適當",
  "隨意",
  "視乎口味",
  "依個人喜好",
  "各",
  "各適量",
  "每樣",
  "各樣",
  "各式各樣",
  "其他",
  "食材",
  "未知食材",
]);

function isPlaceholderIngredientName(name: string): boolean {
  return PLACEHOLDER_INGREDIENT_NAMES.has(String(name ?? "").trim());
}

const INGREDIENT_NOTE_KEYWORDS = [
  "潤肺", "止咳", "平喘", "唔好落太多", "唔好落", "不要落太多", "不要落", "少落", "少放",
  "可選", "建議", "功效", "養生", "清熱", "去濕", "補氣", "止咳平喘",
  "洗淨", "切片", "切碎", "切段", "切絲", "去皮", "去核", "浸泡", "泡發",
  "攪拌", "備用", "斬件", "拍扁", "拍碎", "拍爛", "切粒", "切丁", "切幼", "切末", "剁碎", "剁蓉",
  "汆水", "飛水", "焯水", "過冷河", "出水", "去蒂", "去籽",
  "選", "但唔好", "不要太", "不要過", "不宜", "避免",
  "隨意", "視乎", "喜歡", "喜愛", "偏好", "口味", "喜好",
];

function isIngredientNoteFragment(name: string): boolean {
  const n = String(name ?? "").trim();
  if (!n) return false;
  // 過濾烹飪指示/備註
  if (INGREDIENT_NOTE_KEYWORDS.some((kw) => n.includes(kw))) return true;
  // 只在唔似份量時，先當標點句處理；避免誤殺「1.5公升」呢類數量
  if (/[,,.．.!！？?]/.test(n)) {
    const looksLikeAmount = /(?:\d+(?:\.\d+)?|\d+\/\d+|半|一|兩|二|三|四|五|六|七|八|九|十|幾)\s*(?:克|毫升|公升|升|ml|l|L|g|kg|個|條|隻|片|碗|湯匙|茶匙|匙|包|盒|粒|瓣|棵|紮|杯|碟|勺|份|根|塊|斤|磅|oz|lb|角|副)?/i.test(n);
    if (!looksLikeAmount) return true;
  }
  return false;
}

const INGREDIENT_LABEL_PREFIXES = ["材料", "配料", "調味料", "食材", "原料", "主料", "ingredients", "ingredient"] as const;
const INGREDIENT_ACTION_PREFIXES = ["切片", "切絲", "切粒", "切丁", "切碎", "切段", "切幼", "切末", "剁碎", "剁蓉", "斬件", "拍扁", "拍碎", "拍爛", "汆水", "飛水", "焯水", "洗淨", "去皮", "去核", "去蒂", "去籽", "備用", "過冷河", "出水"] as const;
const INGREDIENT_AMOUNT_WORDS = ["少許", "適量", "些許", "若干"] as const;

const normalizeIngredientWhitespace = (value: string) => String(value ?? "").replace(/\s+/g, " ").trim();

const stripIngredientDecorations = (raw: string) => {
  let text = stripParens(normalizeIngredientWhitespace(raw));
  text = text.replace(/^[\s,，。．.!！？?、\-–—*•·]+|[\s,，。．.!！？?、\-–—*•·]+$/g, "").trim();
  return text;
};

const stripIngredientLabelPrefix = (raw: string) => {
  let text = normalizeIngredientWhitespace(raw);
  const labelRe = new RegExp(`^(?:${INGREDIENT_LABEL_PREFIXES.join("|")})\\s*[：:]\\s*`, "i");
  while (labelRe.test(text)) {
    text = text.replace(labelRe, "").trim();
  }
  return text;
};

const stripIngredientActionPrefix = (raw: string) => {
  let text = normalizeIngredientWhitespace(raw);
  const actionRe = new RegExp(`^(?:${INGREDIENT_ACTION_PREFIXES.join("|")})\\s*(?:[：:：\\-–—]\\s*|\\s+)`, "i");
  while (actionRe.test(text)) {
    text = text.replace(actionRe, "").trim();
  }
  return text;
};

const stripIngredientAmountText = (raw: string) => {
  let text = normalizeIngredientWhitespace(raw);
  const amountWithUnitRe = new RegExp(`(?:^|[\\s,，。．.!！？?、\\-–—*•·])(?:約|大約|大概|近約|左右)?\\s*((?:\\d+(?:\\/\\d+)?(?:\\.\\d+)?)|半|一|兩|二|三|四|五|六|七|八|九|十|幾)\\s*(?:${ING_UNIT})`, "g");
  text = text.replace(amountWithUnitRe, " ");
  for (const word of INGREDIENT_AMOUNT_WORDS) {
    const wordRe = new RegExp(`(?:^|[\\s,，。．.!！？?、\\-–—*•·])${word}(?=$|[\\s,，。．.!！？?、\\-–—*•·])`, "g");
    text = text.replace(wordRe, " ");
  }
  text = text.replace(/\s+/g, " ").replace(/^[\s,，。．.!！？?、\-–—*•·]+|[\s,，。．.!！？?、\-–—*•·]+$/g, "").trim();
  return text;
};

function sanitizeIngredientName(raw: string): string {
  const stripped = stripIngredientDecorations(raw);
  if (!stripped) return "";
  const withoutLabels = stripIngredientLabelPrefix(stripped);
  const withoutActions = stripIngredientActionPrefix(withoutLabels);
  const withoutAmounts = stripIngredientAmountText(withoutActions);
  return withoutAmounts;
}

const INGREDIENT_AMOUNT_RE = new RegExp(`(?:約|大約|大概|近約|左右)?\\s*((?:\\d+(?:\\/\\d+)?(?:\\.\\d+)?)|半|一|兩|二|三|四|五|六|七|八|九|十|幾|${INGREDIENT_AMOUNT_WORDS.join("|")})\\s*(?:(${ING_UNIT}))?`, "i");

function extractIngredientAmount(raw: string): { quantity: string; unit: string } {
  const text = stripIngredientDecorations(raw);
  if (!text) return { quantity: "", unit: "" };
  const match =
    text.match(new RegExp(`(?:約|大約|大概|近約|左右)?\\s*((?:\\d+(?:\\/\\d+)?(?:\\.\\d+)?)|半|一|兩|二|三|四|五|六|七|八|九|十|幾|${INGREDIENT_AMOUNT_WORDS.join("|")})\\s*(${ING_UNIT})(?=$|[\\s,，。．.!！？?、\\-–—*•·])`, "i")) ||
    text.match(INGREDIENT_AMOUNT_RE);
  if (!match) return { quantity: "", unit: "" };
  const quantity = match[1] ? match[1].trim() : "";
  const unit = match[2] ? match[2].trim() : "";
  if (!quantity) return { quantity: "", unit: "" };
  return { quantity, unit };
}

function parseIngredientPartStrict(part: string, parentName?: string): Array<{ name: string; quantity: string; unit: string }> {
  const raw = stripIngredientDecorations(part);
  if (!raw) return [];

  const parent = sanitizeIngredientName(parentName || "");
  const labelStripped = stripIngredientLabelPrefix(raw);
  const actionStripped = stripIngredientActionPrefix(labelStripped);

  const qtyFirst = actionStripped.match(new RegExp(`^(${ING_NUM})\\s*(${ING_UNIT})\\s+(.+)$`));
  if (qtyFirst && qtyFirst[3].trim()) {
    const name = sanitizeIngredientName(qtyFirst[3]);
    if (name && !isPlaceholderIngredientName(name) && !isIngredientNoteFragment(name)) {
      return [{ name, quantity: qtyFirst[1], unit: qtyFirst[2] }];
    }
    return [];
  }

  const pureQty = actionStripped.match(new RegExp(`^(${ING_NUM})\\s*(${ING_UNIT})$`));
  if (pureQty) {
    if (parent && !isPlaceholderIngredientName(parent) && !isIngredientNoteFragment(parent)) {
      return [{ name: parent, quantity: pureQty[1], unit: pureQty[2] }];
    }
    return [];
  }

  const amount = extractIngredientAmount(actionStripped);
  const cleanedName = sanitizeIngredientName(actionStripped);
  if (!cleanedName || isPlaceholderIngredientName(cleanedName) || isIngredientNoteFragment(cleanedName)) {
    return [];
  }

  const candidateName = amount.quantity
    ? cleanedName
        .replace(new RegExp(`(?:^|[\\s,，。．.!！？?、\\-–—*•·])(?:約|大約|大概|近約|左右)?\\s*${amount.quantity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*${amount.unit ? amount.unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : ""}`, "g"), " ")
        .replace(/\s+/g, " ")
        .trim()
    : cleanedName;

  if (candidateName && (amount.quantity || amount.unit)) {
    return [{ name: candidateName, quantity: amount.quantity, unit: amount.unit }];
  }

  const re = new RegExp(`(${ING_NUM})\\s*(${ING_UNIT})`, "g");
  const tokens: Array<{ idx: number; end: number; qty: string; unit: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(actionStripped))) {
    tokens.push({ idx: m.index, end: m.index + m[0].length, qty: m[1], unit: m[2] });
  }

  if (tokens.length === 0) {
    if (candidateName) return [{ name: candidateName, quantity: "適量", unit: "" }];
    return [];
  }

  const items: Array<{ name: string; quantity: string; unit: string }> = [];
  let consumedTrailing = false;
  tokens.forEach((t, i) => {
    const nameStart = i === 0 ? 0 : tokens[i - 1].end;
    let namePart = actionStripped.slice(nameStart, t.idx).replace(/[,，,;；]+$/, "").trim();
    if (!namePart) {
      const afterToken = actionStripped.slice(t.end).replace(/^[,，,;；\s]+|[,，,;；\s]+$/g, "").trim();
      const afterName = sanitizeIngredientName(afterToken);
      if (i === 0 && afterName && !isPlaceholderIngredientName(afterName) && !isIngredientNoteFragment(afterName)) {
        items.push({ name: afterName, quantity: t.qty, unit: t.unit });
        consumedTrailing = true;
      }
      return;
    }

    const cleaned = sanitizeIngredientName(namePart);
    if (!isPlaceholderIngredientName(cleaned) && !isIngredientNoteFragment(cleaned)) {
      items.push({ name: cleaned, quantity: t.qty, unit: t.unit });
    }
  });

  const lastEnd = tokens[tokens.length - 1].end;
  const trailing = actionStripped.slice(lastEnd).replace(/^[,，,;；\s]+|[,，,;；\s]+$/g, "").trim();
  const trailingName = sanitizeIngredientName(trailing);
  if (trailingName && !consumedTrailing && !isPlaceholderIngredientName(trailingName) && !isIngredientNoteFragment(trailingName)) {
    items.push({ name: trailingName, quantity: "適量", unit: "" });
  }

  return items;
}

function runIngredientSanitizerAssertions() {
  const cases = [
    { raw: "薑絲 1小包", name: "薑絲", quantity: "1", unit: "小包" },
    { raw: "蒜蓉（切碎） 2湯匙", name: "蒜蓉", quantity: "2", unit: "湯匙" },
    { raw: "切片：薑 3片", name: "薑", quantity: "3", unit: "片" },
    { raw: "材料：豬肉 200克", name: "豬肉", quantity: "200", unit: "克" },
    { raw: "調味料：生抽 1湯匙", name: "生抽", quantity: "1", unit: "湯匙" },
    { raw: "芹菜粒 1包", name: "芹菜粒", quantity: "1", unit: "包" },
  ] as const;

  for (const tc of cases) {
    const name = sanitizeIngredientName(tc.raw);
    const amount = extractIngredientAmount(tc.raw);
    console.assert(name === tc.name, `[IngredientSanitizer] name mismatch for "${tc.raw}": expected "${tc.name}", got "${name}"`);
    console.assert(amount.quantity === tc.quantity, `[IngredientSanitizer] quantity mismatch for "${tc.raw}": expected "${tc.quantity}", got "${amount.quantity}"`);
    console.assert(amount.unit === tc.unit, `[IngredientSanitizer] unit mismatch for "${tc.raw}": expected "${tc.unit}", got "${amount.unit}"`);
  }
}

if (process.env.NODE_ENV !== "production" && process.env.KINDCIPE_SKIP_INGREDIENT_SANITIZER_ASSERTS !== "1") {
  runIngredientSanitizerAssertions();
}

// 拆「調味料：生抽 1湯匙、蠔油 半湯匙…」呢類一行多料／無空格中文數量
function parseIngredientPart(part: string, parentName?: string): Array<{ name: string; quantity: string; unit: string }> {
  return parseIngredientPartStrict(part, parentName);
}


function parseIngredientLine(line: string): Array<{ name: string; quantity: string; unit: string }> {
  const l = line.replace(/^[-–—*•·]\s*/, "").trim();
  if (!l) return [];
  const colonMatch = l.match(/^(.+?)[：:]\s*(.+)$/);
  if (colonMatch) {
    const parentName = colonMatch[1].trim();
    const detail = colonMatch[2].trim();
    if (/[、，,;；]/.test(detail)) {
      const out: Array<{ name: string; quantity: string; unit: string }> = [];
      for (const part of detail.split(/[、，,;；]/)) {
        out.push(...parseIngredientPartStrict(part, parentName));
      }
      return out;
    }
    return parseIngredientPartStrict(detail, parentName);
  }
  return parseIngredientPartStrict(l);
}

function parseRecipesFromText(text: string): SuggestedRecipe[] {
  const recipes: SuggestedRecipe[] = [];

  // Match recipe headers: 食譜一：類別 —— 名稱（約XX分鐘）
  // Also supports: 食譜1、食譜 1、食譜 一、1. 名稱（約XX分鐘）
  let recipeBlocks = text.split(/(?=食譜\s*[一二三四五六七八九十\d]+[：:\s])/);
  // 若完全搵唔到「食譜X」header，改用 --- 或空行做分隔嘅兜底
  if (recipeBlocks.length <= 1) {
    recipeBlocks = text.split(/(?=^(?:第?\s*[一二三四五六七八九十\d]+[.、．:：]|食譜))/gm);
  }
  
  for (const block of recipeBlocks) {
    // Try to parse header
    const headerMatch = block.match(
      /(?:食譜\s*[一二三四五六七八九十\d]+|[一二三四五六七八九十\d]+[.、．])\s*[：:]\s*(.+?)\s*(?:——|—|--|-)\s*(.+?)(?:[（(]約?\s*(\d+)\s*分鐘[）)])?(?:\n|$)/
    );
    if (!headerMatch) continue;
    
    const category = headerMatch[1].trim();
    const name = headerMatch[2].replace(/^[—\-]+\s*/, "").trim();
    const cookTime = headerMatch[3] ? parseInt(headerMatch[3], 10) : 30;
    
    if (!name || name.length < 2) continue;
    
    // Parse ingredients section
    const ingredients: SuggestedRecipe["ingredients"] = [];
    // 放寬：接受 🛒 食材 / 食材 / 材料 / 原料 / Ingredients 前綴（有冇 emoji 都得）
    const ingSection = block.match(/(?:🛒\s*)?(?:食材|材料|原料|Ingredients)[：:]([\s\S]*?)(?=🍳|步驟|做法|---|$)/i);
    if (ingSection) {
      const ingLines = ingSection[1].split("\n").filter(l => l.trim());
      for (const line of ingLines) {
        for (const ing of parseIngredientLine(line)) {
          ingredients.push(ing);
        }
      }
    }
    
    // Parse steps section
    const steps: string[] = [];
    const stepsSection = block.match(/🍳\s*步驟[：:]([\s\S]*?)(?=---|$)/);
    if (stepsSection) {
      const stepLines = stepsSection[1].split("\n").filter(l => l.trim());
      for (const line of stepLines) {
        // Match: 1. 步驟標題（第 X-Y 分鐘）：詳細描述
        const stepMatch = line.match(/^\d+[.、．]\s*(.+)/);
        if (stepMatch) {
          steps.push(stepMatch[1].trim());
        }
      }
    }
    
    // Parse description (text between header and 食材)
    const descMatch = block.match(/(?:[）)])\s*\n+([\s\S]*?)(?=🛒|$)/);
    const description = descMatch ? descMatch[1].trim().split("\n")[0] : "";

    const soupMeta = extractSoupMeta(block);
    
    const filteredIngredients = ingredients.filter(ing => !isPlaceholderIngredientName(ing.name));
    const tags = [category];
    if (soupMeta.soupType) tags.push(...soupMeta.soupType.split(/[、,，/／|｜\s]+/).map((s) => s.trim()).filter(Boolean));
    if (soupMeta.benefits) tags.push(...soupMeta.benefits.split(/[、,，/／|｜\s]+/).map((s) => s.trim()).filter(Boolean));

    // Only add if we have ingredients and steps
    if (filteredIngredients.length > 0 && steps.length > 0) {
      recipes.push({
        name,
        cookTime,
        servings: 4, // Default
        difficulty: "中等", // Default
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

// ─── Fire-and-forget tools loop (returns final assistant content + all messages) ──

async function runToolsLoop(
  messages: Message[],
  familyId?: number,
  userId?: number,
  enableSearch?: boolean
): Promise<{ finalContent: string; allMessages: Message[] }> {
  const db = await getDb();
  const MAX_ITER = 3;

  for (let i = 0; i < MAX_ITER; i++) {
    let llmResp;
    try {
      llmResp = await invokeLLM({
        messages,
        maxTokens: AI_RECIPE_MAX_TOKENS,
        temperature: 0.9,
        timeoutMs: AI_RECIPE_LLM_TIMEOUT_MS,
        enableSearch: enableSearch ?? true,
        tools: i === 0 ? TOOLS as any : undefined,
      });
    } catch (err) {
      console.warn("[AI Chef] LLM call failed:", err);
      messages.push({ role: "assistant", content: AI_RECIPE_FALLBACK_CONTENT });
      return { finalContent: AI_RECIPE_FALLBACK_CONTENT, allMessages: messages };
    }

    const choice = llmResp.choices[0];
    if (!choice) return { finalContent: "", allMessages: messages };

    if (choice.finish_reason === "tool_calls" && choice.message.tool_calls?.length) {
      messages.push({ role: "assistant", content: "", tool_calls: choice.message.tool_calls });
      for (const tc of choice.message.tool_calls) {
        if (!db) {
          messages.push({ role: "tool", content: JSON.stringify({ error: "Database unavailable" }), tool_call_id: tc.id });
          continue;
        }
        try {
          const args = JSON.parse(tc.function.arguments);
          const result = await executeToolCall(db, tc.function.name, args, familyId, userId);
          messages.push({ role: "tool", content: JSON.stringify(result), tool_call_id: tc.id });
        } catch (e) {
          messages.push({ role: "tool", content: JSON.stringify({ error: String(e) }), tool_call_id: tc.id });
        }
      }
    } else {
      const content = choice.message.content ?? "";
      messages.push({ role: "assistant", content });
      return { finalContent: content, allMessages: messages };
    }
  }

  messages.push({ role: "assistant", content: AI_RECIPE_FALLBACK_CONTENT });
  return { finalContent: AI_RECIPE_FALLBACK_CONTENT, allMessages: messages };
}

// ─── Helper: convert frontend messages to LLM format ─────

function toLLMMessages(input: Array<{ role: string; content: string | Array<TextContent | ImageContent> }>): Message[] {
  return input.map(m => ({
    role: m.role as "user" | "assistant",
    content: m.content as MessageContent,
  }));
}

// LLM（Vision）只能 access 公開 URL；將自身上傳嘅 /r2-storage/ 圖片換成預簽名 URL
async function resolveImageUrls(input: Array<{ role: string; content: string | Array<TextContent | ImageContent> }>): Promise<Array<{ role: string; content: string | Array<TextContent | ImageContent> }>> {
  return Promise.all(input.map(async (m) => {
    if (typeof m.content === "string") return m;
    const content = await Promise.all(m.content.map(async (c) => {
      if (c.type === "image_url") {
        const url = c.image_url.url;
        const marker = "/r2-storage/";
        const idx = url.indexOf(marker);
        if (idx !== -1) {
          const key = url.slice(idx + marker.length).split("?")[0];
          try {
            const signed = await storageGetSignedUrl(key);
            return { ...c, image_url: { ...c.image_url, url: signed } };
          } catch (e) {
            console.warn("[AI Chef] resolve image signed URL failed:", e);
          }
        }
      }
      return c;
    }));
    return { ...m, content };
  }));
}

// ─── Exported: non-streamed chat ─────────────────────────

export async function processAIChefChat(
  inputMessages: Array<{ role: string; content: string | Array<TextContent | ImageContent> }>,
  familyId?: number,
  userId?: number,
  mode?: "library" | "ai"
): Promise<{ content: string; recipes: SuggestedRecipe[] }> {
  const db = await getDb();
  const resolvedMsgs = await withTimeout(
    resolveImageUrls(inputMessages),
    AI_RECIPE_CONTEXT_TIMEOUT_MS,
    "resolve image urls"
  ).catch((err) => {
    console.warn("[AI Chef] resolveImageUrls timeout/failure:", err);
    return inputMessages;
  });

  // Auto-search: always run searchRecipes first to get library context
  const searchQuery = extractSearchQuery(toLLMMessages(resolvedMsgs));
  let libSummary = "";
  let libResults: Record<string, unknown>[] = [];
  if (db) {
    try {
      const searchResult = await withTimeout(
        execSearchRecipes(db, { query: searchQuery, limit: 15 }, familyId),
        AI_RECIPE_CONTEXT_TIMEOUT_MS,
        "auto search recipes"
      );
      libResults = (searchResult.recipes || []) as Record<string, unknown>[];
      libSummary = formatLibraryContext(libResults);
      const customSummary = await listFamilyCustomSummary(db, familyId);
      if (customSummary) libSummary += customSummary;
    } catch (e) {
      console.warn("[AI Chef] Auto-search failed:", e);
      libSummary = "（食譜庫搜尋失敗）";
    }
  }

  const soupIntent = detectSoupIntent(toLLMMessages(resolvedMsgs));
  const systemPrompt = buildSystemPrompt(mode, libSummary, soupIntent);
  const msgs: Message[] = [
    { role: "system", content: systemPrompt },
    ...toLLMMessages(resolvedMsgs),
  ];

  const enableSearch = mode !== "library";
  let finalContent = AI_RECIPE_FALLBACK_CONTENT;
  let allMessages = msgs;
  try {
    ({ finalContent, allMessages } = await withTimeout(
      runToolsLoop(msgs, familyId, userId, enableSearch),
      AI_RECIPE_CHAT_TIMEOUT_MS,
      "ai chef chat",
    ));
  } catch (e) {
    console.warn("[AI Chef] chat timed out or failed:", e);
    return { content: AI_RECIPE_FALLBACK_CONTENT, recipes: [] };
  }

  // Direct parse from assistant response with four-layer protection
  // Layer 1: extractJSON, Layer 2: repairJSON, Layer 3: Zod validation, Layer 4: text fallback
  const recipes = parseRecipeWithFallback(finalContent);

  // Phase 1: Only match against library when mode="library"; otherwise all AI-generated recipes are marked as "ai"
  if (mode === "library") {
    for (const r of recipes) {
      const match = matchRecipeSource(r.name, libResults);
      r.source = match.source;
      if (match.officialId) r.officialId = match.officialId;
      if (match.customId) r.customId = match.customId;
      if (match.source === "official" || match.source === "custom") {
        const libEntry = libResults.find(lr => (match.source === "official" ? lr.id === match.officialId : lr.id === match.customId));
        if (libEntry) {
          if (libEntry.servings && typeof libEntry.servings === "number") r.servings = libEntry.servings;
          if (libEntry.cookTime && typeof libEntry.cookTime === "number") r.cookTime = libEntry.cookTime;
          if (libEntry.difficulty && typeof libEntry.difficulty === "string") r.difficulty = libEntry.difficulty;
          if (libEntry.category && typeof libEntry.category === "string") r.tags = [...(r.tags ?? []), libEntry.category];
        }
      }
    }
  } else {
    // AI mode: all recipes are marked as "ai" by default
    for (const r of recipes) {
      r.source = "ai";
    }
  }

  // Log for debugging
  if (recipes.length === 0 && finalContent.includes("食譜")) {
    console.warn("[AI Chef] Failed to parse recipes from response:", finalContent.slice(0, 500));
  }
  for (const r of recipes) {
    const firstIng = r.ingredients[0];
    console.log(`[AI Chef] Parsed recipe「${r.name}」: ${r.ingredients.length} 食材, ${r.steps.length} 步驟, firstIng=${JSON.stringify(firstIng)}`);
    if (r.ingredients.length === 0 || r.ingredients.every(i => !i.name || i.name === "食材")) {
      console.warn("[AI Chef] ⚠️ Recipe has empty ingredient names:", JSON.stringify(r).slice(0, 400));
    }
  }

  return { content: finalContent, recipes };
}

// ─── Exported: streaming chat (yields text tokens, then recipes) ──

export async function* streamAIChefChat(
  inputMessages: Array<{ role: string; content: string | Array<TextContent | ImageContent> }>,
  familyId?: number,
  userId?: number,
  mode?: "library" | "ai"
): AsyncGenerator<
  { type: "text"; value: string } | { type: "recipes"; value: SuggestedRecipe[] } | { type: "done" }
> {
  const db = await getDb();
  const resolvedMsgs = await withTimeout(
    resolveImageUrls(inputMessages),
    AI_RECIPE_CONTEXT_TIMEOUT_MS,
    "resolve image urls"
  ).catch((err) => {
    console.warn("[AI Chef] resolveImageUrls timeout/failure:", err);
    return inputMessages;
  });

  // Auto-search
  const searchQuery = extractSearchQuery(toLLMMessages(resolvedMsgs));
  let libSummary = "";
  let libResults: Record<string, unknown>[] = [];
  if (db) {
    try {
      const searchResult = await withTimeout(
        execSearchRecipes(db, { query: searchQuery, limit: 15 }, familyId),
        AI_RECIPE_CONTEXT_TIMEOUT_MS,
        "auto search recipes"
      );
      libResults = (searchResult.recipes || []) as Record<string, unknown>[];
      libSummary = formatLibraryContext(libResults);
      const customSummary = await listFamilyCustomSummary(db, familyId);
      if (customSummary) libSummary += customSummary;
    } catch (e) {
      console.warn("[AI Chef] Auto-search failed:", e);
      libSummary = "（食譜庫搜尋失敗）";
    }
  }

  const soupIntent = detectSoupIntent(toLLMMessages(resolvedMsgs));
  const systemPrompt = buildSystemPrompt(mode, libSummary, soupIntent);
  const sysMsg: Message = { role: "system", content: systemPrompt };
  const msgs: Message[] = [sysMsg, ...toLLMMessages(resolvedMsgs)];

  const enableSearch = mode !== "library";
  let allMessages = msgs;
  try {
    ({ allMessages } = await withTimeout(
      runToolsLoop(msgs, familyId, userId, enableSearch),
      AI_RECIPE_CHAT_TIMEOUT_MS,
      "ai chef chat stream",
    ));
  } catch (e) {
    console.warn("[AI Chef] stream chat timed out or failed:", e);
    yield { type: "text", value: AI_RECIPE_FALLBACK_CONTENT };
    yield { type: "done" };
    return;
  }

  // Stream the text response directly (no re-generation)
  const lastAssistantMsg = allMessages.filter(m => m.role === "assistant").pop();
  const lastAssistantContent = typeof lastAssistantMsg?.content === "string" ? lastAssistantMsg.content : "";

  if (lastAssistantContent) {
    // Stream character by character for smooth UX
    for (let i = 0; i < lastAssistantContent.length; i += 50) {
      yield { type: "text", value: lastAssistantContent.slice(i, i + 50) };
    }
  }

  // Parse and tag sources for streaming path with four-layer protection
  const streamRecipes = parseRecipeWithFallback(lastAssistantContent);

  // Phase 1: Only match against library when mode="library"; otherwise all AI-generated recipes are marked as "ai"
  if (mode === "library") {
    for (const r of streamRecipes) {
      const match = matchRecipeSource(r.name, libResults);
      r.source = match.source;
      if (match.officialId) r.officialId = match.officialId;
      if (match.customId) r.customId = match.customId;
      if (match.source === "official" || match.source === "custom") {
        const libEntry = libResults.find(lr => (match.source === "official" ? lr.id === match.officialId : lr.id === match.customId));
        if (libEntry) {
          if (libEntry.servings && typeof libEntry.servings === "number") r.servings = libEntry.servings;
          if (libEntry.cookTime && typeof libEntry.cookTime === "number") r.cookTime = libEntry.cookTime;
          if (libEntry.difficulty && typeof libEntry.difficulty === "string") r.difficulty = libEntry.difficulty;
          if (libEntry.category && typeof libEntry.category === "string") r.tags = [...(r.tags ?? []), libEntry.category];
        }
      }
    }
  } else {
    // AI mode: all recipes are marked as "ai" by default
    for (const r of streamRecipes) {
      r.source = "ai";
    }
  }

  yield { type: "recipes", value: streamRecipes };
  yield { type: "done" };
}

// ─── Router ──────────────────────────────────────────────

// 共用 AI 編輯：用 editor prompt 產生完整新食譜 JSON（唔係 AI Chef 對話）
async function runAiEdit(
  input: { recipe: any; editPrompt: string },
  familyId: string | number,
  userId: string,
): Promise<z.infer<typeof aiEditOutputSchema>> {
  const systemPrompt = `你是一個專業食譜編輯助手。請根據原始食譜和修改要求，產生一個完整可儲存的新食譜。

要求：
1. 必須保留原食譜的核心風格，但要按修改要求調整
2. 所有文字使用繁體中文
3. 步驟要清晰、可操作
4. 食材、份量、做法要合理一致
5. 只回傳 JSON，不要加任何解釋文字

⚠️【重要原則 - 最小修改原則】
1. **只修改用戶明確要求嘅部分**：例如用戶要求「改辣啲」，只增加辣椒/辣醬，其他唔變。嚴禁修改未被提及嘅食材、步驟或調味料。
2. **保留核心身份**：修改後嘅食譜必須仍然係「同一道菜嘅變體」，唔可以變成另一道完全唔同嘅菜式。
3. **核心食材保護**：蛋白質主材（如雞、魚、牛肉、豆腐）唔可以隨意替換，除非用戶明確要求。
4. **步驟完整性**：唔可以刪除用戶無要求刪除嘅步驟，確保烹飪流程完整。

✅ 正確例子：
- 用戶要求「改辣啲」→ 只增加辣椒/辣醬，其他不變
- 用戶要求「走蔥」→ 只移除蔥相關食材，保留蔥油等調味
- 用戶要求「減一半份量」→ 只調整食材份量，步驟不變

❌ 錯誤例子：
- 用戶要求「改辣啲」→ 將「蒸雞」變成「炒牛肉」❌
- 用戶要求「走蔥」→ 移除所有蔥 Related 內容，改變菜式風格 ❌
- 用戶要求「減份量」→ 刪除一半步驟，導致煮唔熟 ❌`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `原始食譜：${JSON.stringify(input.recipe)}\n\n修改要求：${input.editPrompt}`,
      },
    ],
    maxTokens: AI_RECIPE_MAX_TOKENS,
    timeoutMs: AI_RECIPE_LLM_TIMEOUT_MS,
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "ai_edit_recipe",
        strict: true,
        schema: {
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
                required: ["name"],
              },
            },
            steps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  instruction: { type: "string" },
                  duration: { type: "integer" },
                  tip: { type: "string" },
                },
                required: ["instruction"],
              },
            },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["name", "description", "cookTime", "servings", "difficulty", "recipeCategory", "ingredients", "steps", "tags"],
        },
      },
    },
  });

  const rawContent = response.choices[0]?.message?.content;
  const parsedContent = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
  if (!parsedContent) throw new Error("AI returned empty response");

  // Apply repairJSON for robustness (same as AI Chef four-layer protection)
  const extracted = extractJSON(parsedContent);
  const repaired = repairJSON(JSON.stringify(extracted));
  const parsed = aiEditOutputSchema.parse(JSON.parse(repaired));
  
  // Apply differential check to prevent over-editing
  const validation = validateEditDifferential(input.recipe, parsed);
  if (!validation.safe) {
    console.warn("[AI Edit] ⚠️ Over-edit detected", {
      issues: validation.issues,
      originalRecipe: input.recipe.name,
      editPrompt: input.editPrompt
    });
    
    // Apply auto-fixes for critical issues
    if (validation.autoFixes.name) {
      parsed.name = validation.autoFixes.name;
      console.log("[AI Edit] Auto-fixed: restored original recipe name");
    }
  }
  
  return parsed;
}

export const aiRecipeRouter = router({
  previewEdit: familyWriteProcedure
    .input(aiEditSaveInputSchema)
    .mutation(async ({ input, ctx }) => {
      if (!ctx.activeFamilyId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No family found" });
      }

      const sub = await getFamilySubscription(ctx.activeFamilyId);
      if (sub && !sub.isPaid) {
        const createdThisMonth = await countCustomRecipesCreatedThisMonth(ctx.activeFamilyId);
        if (createdThisMonth >= 20) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `免費版每月最多建立 20 條自訂食譜（已用 ${createdThisMonth}/20），升級家庭版可無限建立`,
          });
        }
      }

      const parsed = await runAiEdit(input, ctx.activeFamilyId, ctx.user.id);

      return {
        name: parsed.name || input.recipe.name,
        description: parsed.description || input.recipe.description,
        cookTime: parsed.cookTime ?? input.recipe.cookTime,
        servings: parsed.servings ?? input.recipe.servings,
        difficulty: parsed.difficulty || input.recipe.difficulty,
        recipeCategory: parsed.recipeCategory || input.recipe.recipeCategory,
        ingredients: parsed.ingredients.length > 0 ? parsed.ingredients : input.recipe.ingredients,
        steps: parsed.steps.length > 0 ? parsed.steps : input.recipe.steps,
        tags: Array.from(new Set([...(input.recipe.tags ?? []), ...(parsed.tags ?? []), "AI 生成"])),
      };
    }),

  saveEditedRecipe: familyWriteProcedure
    .input(aiEditSaveInputSchema)
    .mutation(async ({ input, ctx }) => {
      if (!ctx.activeFamilyId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No family found" });
      }

      const sub = await getFamilySubscription(ctx.activeFamilyId);
      if (sub && !sub.isPaid) {
        const createdThisMonth = await countCustomRecipesCreatedThisMonth(ctx.activeFamilyId);
        if (createdThisMonth >= 20) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `免費版每月最多建立 20 條自訂食譜（已用 ${createdThisMonth}/20），升級家庭版可無限建立`,
          });
        }
      }

      const parsed = await runAiEdit(input, ctx.activeFamilyId, ctx.user.id);
      const mergedTags = Array.from(new Set([
        ...(input.recipe.tags ?? []),
        ...(parsed.tags ?? []),
        "AI 生成",
      ]));

      const saved = await insertCustomRecipe({
        familyId: ctx.activeFamilyId,
        createdByUserId: String(ctx.user.id),
        name: parsed.name || input.recipe.name,
        description: parsed.description || input.recipe.description,
        image: input.recipe.thumbnailUrl ?? input.recipe.image,
        thumbnailUrl: input.recipe.thumbnailUrl ?? input.recipe.image,
        cookTime: parsed.cookTime ?? input.recipe.cookTime,
        servings: parsed.servings ?? input.recipe.servings,
        difficulty: parsed.difficulty ?? input.recipe.difficulty,
        recipeCategory: parsed.recipeCategory ?? input.recipe.recipeCategory,
        ingredients: JSON.stringify(parsed.ingredients.length > 0 ? parsed.ingredients : input.recipe.ingredients),
        steps: JSON.stringify(parsed.steps.length > 0 ? parsed.steps : input.recipe.steps),
        tags: JSON.stringify(mergedTags),
        sourceType: "manual",
        sourceAuthor: input.recipe.sourceAuthor,
      });

      return { success: true, id: saved.id, name: saved.name };
    }),

  chat: protectedProcedure
    .input(z.object({
      messages: z.array(messageSchema).min(1),
      mode: modeSchema,
    }))
    .mutation(async ({ input, ctx }) => {
      // Use context for family/user identity (frontend doesn't pass these)
      const familyId = ctx.activeFamilyId ?? undefined;
      const userId = ctx.user?.id ? Number(ctx.user.id) : undefined;

      // AI Chef chat quota — per kitchen per month (image/url turn counts 2)
      if (familyId) {
        const aiSub = await getFamilySubscription(familyId);
        const aiLimit = aiSub?.aiChatLimit ?? 30;
        const aiUsage = await getAiChatUsage(familyId);
        if (aiUsage >= aiLimit) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `本月 AI 對話額度已用盡（${aiUsage}/${aiLimit}），升級家庭版可獲 200 次／月`,
          });
        }
        const hasMedia = input.messages.some(m => {
          if (typeof m.content === "string") return /(https?:\/\/|data:image)/i.test(m.content);
          return m.content.some(c => c.type === "image_url");
        });
        await incrementAiChatUsage(familyId, String(ctx.user.id), hasMedia ? 2 : 1);
      }

      return processAIChefChat(
        input.messages.map(m => ({ role: m.role, content: m.content })),
        familyId,
        userId,
        input.mode,
      );
    }),
});
