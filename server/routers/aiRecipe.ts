import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, or, ilike, desc, lte, gt, sql, notInArray } from "drizzle-orm";
import { protectedProcedure, familyWriteProcedure, router } from "../_core/trpc";
import { invokeLLM, extractJSON, extractFirstJson, repairJSON, salvageJSON, Message, MessageContent, TextContent, ImageContent } from "../_core/llm";
import { translateRecipeContent } from "../utils/translateContent";
import { getDb, getFamilySubscription, getAiChatUsage, incrementAiChatUsage, countCustomRecipesCreatedThisMonth, insertCustomRecipe, getTrendingRecipes } from "../db";
import { storageGetSignedUrl } from "../storage";
import { officialRecipes, customRecipes, pantryItems, aiChefSeenRecipes } from "../../drizzle/schema";
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

const modeSchema = z.enum(["library", "ai", "chat", "question"]).optional();

const aiRecipeIngredientSchema = z.object({
  name: z.string(),
  nameEn: z.string().optional(),
  nameFil: z.string().optional(),
  nameId: z.string().optional(),
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
  nameEn: z.string().optional(),
  nameFil: z.string().optional(),
  nameId: z.string().optional(),
  description: z.string(),
  descriptionEn: z.string().optional(),
  descriptionFil: z.string().optional(),
  descriptionId: z.string().optional(),
  cookTime: z.number().int(),
  servings: z.number().int(),
  difficulty: z.string(),
  recipeCategory: z.string(),
  ingredients: z.array(aiRecipeIngredientSchema),
  steps: z.array(aiRecipeStepSchema),
  stepsEn: z.array(aiRecipeStepSchema).optional(),
  stepsFil: z.array(aiRecipeStepSchema).optional(),
  stepsId: z.array(aiRecipeStepSchema).optional(),
  tags: z.array(z.string()),
});

/**
 * Four-Layer Protection Schema for AI Chef JSON parsing
 * Layer 3: Zod validation with default values to prevent crashes
 */
const aiRecipeCardSchema = z.object({
  title: z.string().default("未命名食譜"),
  name: z.string().default("未命名食譜"),
  nameEn: z.string().optional(),
  nameFil: z.string().optional(),
  nameId: z.string().optional(),
  ingredients: z.array(z.object({
    name: z.string().default("未知食材"),
    nameEn: z.string().optional(),
    nameFil: z.string().optional(),
    nameId: z.string().optional(),
    quantity: z.string().default("適量"),
    unit: z.string().default(""),
  })).default([]),
  instructions: z.array(z.string()).default([]),
  steps: z.array(z.string()).default([]),
  stepsEn: z.array(z.string()).optional(),
  stepsFil: z.array(z.string()).optional(),
  stepsId: z.array(z.string()).optional(),
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

const aiRecipeBatchSchema = z.object({
  replyText: z.string().default(""),
  recipes: z.array(aiRecipeCardSchema).default([]),
});

const aiRecipeResponseSchema = z.union([aiRecipeBatchSchema, aiRecipeCardSchema]);

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

const AI_RECIPE_MAX_TOKENS = 2600;
const AI_RECIPE_CONTEXT_TIMEOUT_MS = 4000;
const AI_RECIPE_LLM_TIMEOUT_MS = 45000;
const AI_RECIPE_CHAT_TIMEOUT_MS = 30000;
// AI Edit returns the recipe in 4 languages (zh + en/fil/id) → needs a bigger budget.
const AI_EDIT_MAX_TOKENS = 7000;
const AI_EDIT_LLM_TIMEOUT_MS = 60000;
const AI_RECIPE_FALLBACK_CONTENT = "AI 暫時未能回應，請再試。";

// Fix2: 後端自己記住最近推薦過嘅菜式（per-family，last 30，7 日內有效）—— DB 持久化 + memory fallback
const SEEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 日
type SeenEntry = { name: string; seenAt: number };
const FAMILY_RECENT_RECIPES: Map<number | string, SeenEntry[]> = new Map();
const MAX_RECENT_PER_FAMILY = 40;

async function getFamilySeenNames(familyId?: number): Promise<string[]> {
  if (familyId === undefined) return [];
  // 1) 試 DB（migration 已跑先至有表；未跑/斷線 → fallback memory）
  try {
    const db = await getDb();
    if (db) {
      const cutoff = new Date(Date.now() - SEEN_EXPIRY_MS);
      const rows = await db
        .select({ name: aiChefSeenRecipes.name })
        .from(aiChefSeenRecipes)
        .where(and(eq(aiChefSeenRecipes.familyId, familyId), gt(aiChefSeenRecipes.seenAt, cutoff)))
        .orderBy(desc(aiChefSeenRecipes.seenAt))
        .limit(MAX_RECENT_PER_FAMILY);
      return rows.map(r => r.name);
    }
  } catch (e) {
    console.warn("[AI Chef] getFamilySeenNames DB failed, fallback memory:", (e as Error)?.message);
  }
  // 2) memory fallback
  const now = Date.now();
  const entries = FAMILY_RECENT_RECIPES.get(familyId) ?? [];
  return entries.filter(e => now - e.seenAt < SEEN_EXPIRY_MS).map(e => e.name);
}

async function recordFamilySeenNames(familyId: number | undefined, names: string[]): Promise<void> {
  if (familyId === undefined || !names || names.length === 0) return;
  const now = Date.now();
  // memory 照樣記（fallback 用）
  const currentMem = FAMILY_RECENT_RECIPES.get(familyId) ?? [];
  const seen = new Map<string, number>();
  for (const n of currentMem) seen.set(n.name, now);
  for (const n of names) {
    const t = String(n ?? "").trim();
    if (t) seen.set(t, now); // 重複睇會刷新時間
  }
  const arr = [...seen.entries()].map(([name, seenAt]) => ({ name, seenAt }));
  FAMILY_RECENT_RECIPES.set(familyId, arr.slice(-MAX_RECENT_PER_FAMILY));

  // DB 持久化（upsert + 清過期）
  try {
    const db = await getDb();
    if (!db) return;
    for (const n of names) {
      const t = String(n ?? "").trim();
      if (!t) continue;
      await db
        .insert(aiChefSeenRecipes)
        .values({ familyId, name: t, seenAt: new Date() })
        .onConflictDoUpdate({
          target: [aiChefSeenRecipes.familyId, aiChefSeenRecipes.name],
          set: { seenAt: new Date() },
        });
    }
    // 清走 7 日前嘅舊紀錄，防止表無限脹
    const cutoff = new Date(Date.now() - SEEN_EXPIRY_MS);
    await db.delete(aiChefSeenRecipes)
      .where(and(eq(aiChefSeenRecipes.familyId, familyId), lte(aiChefSeenRecipes.seenAt, cutoff)));
  } catch (e) {
    console.warn("[AI Chef] recordFamilySeenNames DB failed (memory kept):", (e as Error)?.message);
  }
}

// Fix4: 自動重試一次嘅 helper（LLM 出壞 JSON 時用）
async function retryLLMJson(
  messages: Message[],
  familyId: number | undefined,
  userId: number | undefined
): Promise<string> {
  const retryMsg = [
    ...messages,
    { role: "user" as const, content: "上次輸出嘅 JSON 唔完整/格式錯咗，請重新輸出完整食譜，必須係完整 JSON（唔好省略任何欄位，唔好截斷）。" },
  ];
  const { finalContent } = await runToolsLoop(retryMsg, familyId, userId, false, true);
  return finalContent;
}

/**
 * Four-Layer Recipe Parser with Fallback
 * Layer 1: extractJSON() - Extract JSON from mixed content
 * Layer 2: repairJSON() - Fix common JSON issues (unquoted keys, truncation)
 * Layer 3: Zod validation - Schema validation with default values
 * Layer 4: parseRecipesFromText() - Fallback to text parser if JSON completely fails
 * 
 * Always returns a valid array of recipes, NEVER crashes or returns undefined
 */
// 由純文字 content 抽出第一個 **菜名**（LLM 出純文字時兜底用）
function extractBoldRecipeName(content: string): string {
  const m = content.match(/\*\*\s*([^*\n]{2,40}?)\s*\*\*/);
  if (!m) return "";
  const name = m[1].trim();
  if (!name) return "";
  // 剷走常見描述前綴（「為你推薦一道」「今晚」「經典」等）
  return name.replace(/^(為你推薦一道|為你推薦|今晚食|推薦一道|一道|個|嚟|呢道|為你搵到)/, "").trim();
}

// 簡單中文菜名相似度（0~1），只比字元重疊
function recipeNameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  if (short.length < 2) return 0;
  let overlap = 0;
  for (let i = 0; i < short.length; i++) {
    if (long.includes(short[i])) overlap++;
  }
  return overlap / short.length;
}

// 判斷名係咪同 exclude 列表任何一個「近似」（exact 或 similarity ≥ 0.6）—— 用嚟 AI 去重，避免「黑椒牛柳炒X」呢類近似重複
function isNearDuplicate(name: string, names: string[]): boolean {
  const n = normalizeName(name);
  if (!n) return false;
  for (const x of names) {
    const xn = normalizeName(x);
    if (!xn) continue;
    if (n === xn) return true;
    if (recipeNameSimilarity(n, xn) >= 0.6) return true;
  }
  return false;
}

// 將 exclude 列表去重（移除近似），令 prompt 嘅排除名單代表「唔同菜」，唔會浪費 slots
function dedupeNames(names: string[]): string[] {
  const out: string[] = [];
  for (const n of names) {
    const nn = normalizeName(n);
    if (!nn) continue;
    if (isNearDuplicate(nn, out)) continue;
    out.push(nn);
  }
  return out;
}

function parseRecipeWithFallback(llmContent: string): { content: string; recipes: SuggestedRecipe[] } {
  const parseStart = Date.now();
  
  let content = llmContent;
  let recipes: SuggestedRecipe[] = [];
  
  // Strategy 1: Try direct JSON parse
  try {
    const parsed = JSON.parse(llmContent);
    if (parsed && typeof parsed === 'object') {
      if (parsed.replyText && typeof parsed.replyText === 'string') {
        content = parsed.replyText;
      }
      if (Array.isArray(parsed.recipes)) {
        const validated = aiRecipeBatchSchema.safeParse(parsed);
        if (validated.success) {
          recipes = convertRecipeDataToSuggestedRecipe(validated.data);
          console.log(`[AI Chef] Direct JSON parse: ${recipes.length} recipes in ${Date.now() - parseStart}ms`);
          return { content, recipes };
      } else {
        // Zod validation failed - manually convert recipes without schema
        console.warn(`[AI Chef] Zod validation failed, using manual conversion:`, validated.error.issues.slice(0, 2));
        const manualReplyText = typeof parsed.replyText === 'string' ? parsed.replyText : undefined;
        recipes = manuallyConvertRecipes(parsed.recipes, manualReplyText);
        if (recipes.length > 0) {
          content = manualReplyText || `為你推薦 ${recipes.length} 個食譜：`;
          console.log(`[AI Chef] Manual conversion: ${recipes.length} recipes in ${Date.now() - parseStart}ms`);
          return { content, recipes };
        }
      }
      }
    }
  } catch (e) {
    // Not valid JSON string
  }
  
  // Strategy 2: Try extractJSON
  const extracted = extractJSON(llmContent);
  if (extracted && typeof extracted === 'object') {
    if (extracted.replyText && typeof extracted.replyText === 'string') {
      content = extracted.replyText;
    }
    if (Array.isArray(extracted.recipes)) {
      const validated = aiRecipeBatchSchema.safeParse(extracted);
      if (validated.success) {
        recipes = convertRecipeDataToSuggestedRecipe(validated.data);
        console.log(`[AI Chef] ExtractJSON parse: ${recipes.length} recipes in ${Date.now() - parseStart}ms`);
        return { content, recipes };
      } else {
        // Manual fallback
        const manualReplyText = typeof extracted.replyText === 'string' ? extracted.replyText : undefined;
        recipes = manuallyConvertRecipes(extracted.recipes, manualReplyText);
        if (recipes.length > 0) {
          content = manualReplyText || `為你推薦 ${recipes.length} 個食譜：`;
          console.log(`[AI Chef] Manual extract conversion: ${recipes.length} recipes`);
          return { content, recipes };
        }
      }
    }
  }
  
  // Strategy 2.5: Try extractJSON + repairJSON then parse (LLM 常見：steps 入面有未 escape 引號 / 截斷 / 前後文字)
  if (recipes.length === 0) {
    try {
      // 先用 extractJSON 剝出 JSON object 部分（剷走前後文字），再 repair
      const extractedRaw = extractJSON<Record<string, unknown>>(llmContent);
      const hasRecipesKey = extractedRaw && "recipes" in extractedRaw;
      const rawCandidate = hasRecipesKey
        ? JSON.stringify(extractedRaw)
        : (() => {
            const s = llmContent.indexOf("{");
            const e = llmContent.lastIndexOf("}");
            return s !== -1 && e > s ? llmContent.slice(s, e + 1) : llmContent;
          })();
      const repaired = repairJSON(rawCandidate);
      const repairedParsed = JSON.parse(repaired);
      if (repairedParsed && typeof repairedParsed === "object") {
        if (repairedParsed.replyText && typeof repairedParsed.replyText === "string") {
          content = repairedParsed.replyText;
        }
        if (Array.isArray(repairedParsed.recipes)) {
          const validated = aiRecipeBatchSchema.safeParse(repairedParsed);
          if (validated.success) {
            recipes = convertRecipeDataToSuggestedRecipe(validated.data);
            console.log(`[AI Chef] repairJSON parse: ${recipes.length} recipes in ${Date.now() - parseStart}ms`);
            return { content, recipes };
          } else {
            const manualReplyText = typeof repairedParsed.replyText === "string" ? repairedParsed.replyText : undefined;
            recipes = manuallyConvertRecipes(repairedParsed.recipes, manualReplyText);
            if (recipes.length > 0) {
              content = manualReplyText || `為你推薦 ${recipes.length} 個食譜：`;
              console.log(`[AI Chef] repairJSON manual conversion: ${recipes.length} recipes`);
              return { content, recipes };
            }
          }
        }
      }
    } catch (e) {
      // 修復都失敗 → 落下一層
    }
  }

  // Strategy 2.6: salvageJSON — 處理 LLM 喺 array 中途截斷（抽取最後一個完整 JSON 值）
  if (recipes.length === 0) {
    try {
      const salvaged = salvageJSON(llmContent);
      if (salvaged && "recipes" in salvaged && Array.isArray(salvaged.recipes)) {
        const manualReplyText = typeof salvaged.replyText === "string" ? salvaged.replyText : undefined;
        recipes = manuallyConvertRecipes(salvaged.recipes, manualReplyText);
        if (recipes.length > 0) {
          content = manualReplyText || `為你推薦 ${recipes.length} 個食譜：`;
          console.log(`[AI Chef] salvageJSON parse: ${recipes.length} recipes`);
          return { content, recipes };
        }
      }
    } catch (e) {
      // 落下一層
    }
  }

  // Strategy 3: Check if content contains "recipes" key but extraction failed
  if (llmContent.includes('"recipes"')) {
    console.warn(`[AI Chef] Content has "recipes" key but extraction failed. Raw: ${llmContent.slice(0, 200)}`);
    // Try to manually parse the JSON from the content
    const startIdx = llmContent.indexOf('{"replyText"');
    const endIdx = llmContent.lastIndexOf('}');
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      try {
        const jsonStr = repairJSON(llmContent.slice(startIdx, endIdx + 1));
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed.recipes)) {
          const manualReplyText = typeof parsed.replyText === 'string' ? parsed.replyText : undefined;
          recipes = manuallyConvertRecipes(parsed.recipes, manualReplyText);
          if (recipes.length > 0) {
            content = manualReplyText || `為你推薦 ${recipes.length} 個食譜：`;
            console.log(`[AI Chef] Slice parse: ${recipes.length} recipes`);
            return { content, recipes };
          }
        }
      } catch (e) {
        // Ignore
      }
    }
  }
  
  // 最後保險：就算全部 parse 失敗，都唔准 raw JSON 漏落 content
  // （如果 content 仍然係 JSON object 開頭，剝走 replyText；剝唔到就回退到「有 recipes 但解析失敗」提示）
  if (content.trim().startsWith("{") || content.includes('"replyText"')) {
    const replyMatch = content.match(/"replyText"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (replyMatch?.[1]) {
      content = replyMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
    } else {
      content = "我搵到食譜，但暫時未能完整顯示，你可以再問我一次。";
    }
  }

  console.log(`[AI Chef] No recipes parsed in ${Date.now() - parseStart}ms`);
  return { content, recipes };
}

/**
 * Manual recipe converter - converts recipe data without strict Zod validation
 * Used as fallback when schema validation fails
 */
function manuallyConvertRecipes(recipes: any[], replyText?: string): SuggestedRecipe[] {
  if (!Array.isArray(recipes)) return [];
  
  return recipes.map((r: any): SuggestedRecipe | null => {
    try {
      const name = String(r.name ?? r.title ?? "未命名食譜");
      if (!name || name.length < 2) return null;
      
      const ingredients = Array.isArray(r.ingredients) 
        ? r.ingredients.map((i: any) => ({
            name: String(i.name ?? "未知食材"),
            nameEn: i.nameEn ? String(i.nameEn) : undefined,
            nameFil: i.nameFil ? String(i.nameFil) : undefined,
            nameId: i.nameId ? String(i.nameId) : undefined,
            quantity: String(i.quantity ?? "適量"),
            unit: String(i.unit ?? ""),
          }))
        : [];
      
      const steps = Array.isArray(r.steps) 
        ? r.steps.map((s: any) => String(s))
        : Array.isArray(r.instructions)
        ? r.instructions.map((s: any) => String(s))
        : [];

      const mapSteps = (arr: any) => (Array.isArray(arr) ? arr.map((s: any) => typeof s === "string" ? s : String(s?.instruction ?? s?.text ?? s)) : undefined);
      const stepsEn = mapSteps(r.stepsEn);
      const stepsFil = mapSteps(r.stepsFil);
      const stepsId = mapSteps(r.stepsId);
      
      if (steps.length === 0) return null;
      
      return {
        name,
        nameEn: r.nameEn ? String(r.nameEn) : undefined,
        nameFil: r.nameFil ? String(r.nameFil) : undefined,
        nameId: r.nameId ? String(r.nameId) : undefined,
        description: String(r.description ?? ""),
        cookTime: Number(r.cookTime ?? 30),
        servings: Number(r.servings ?? 4),
        difficulty: (String(r.difficulty ?? "中等") as "easy" | "medium" | "hard"),
        ingredients,
        steps,
        stepsEn,
        stepsFil,
        stepsId,
        tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
        source: "ai" as const,
        soupType: r.soupType ? String(r.soupType) : undefined,
        benefits: r.benefits ? String(r.benefits) : undefined,
        waterVolume: r.waterVolume ? String(r.waterVolume) : undefined,
      };
    } catch {
      return null;
    }
  }).filter((r): r is SuggestedRecipe => r !== null);
}

/**
 * Helper: Convert validated Zod schema data to SuggestedRecipe[]
 */
function convertRecipeDataToSuggestedRecipe(data: z.infer<typeof aiRecipeResponseSchema>): SuggestedRecipe[] {
  const soupBaseIngredients = ['水', '上湯', '高湯', '清湯', '湯底', '鹽', '糖', '薑', '蔥', '蒜頭'];

  const toRecipe = (item: {
    title?: string;
    name?: string;
    nameEn?: string;
    nameFil?: string;
    nameId?: string;
    ingredients: Array<{ name: string; nameEn?: string; nameFil?: string; nameId?: string; quantity?: string; unit?: string }>;
    instructions: string[];
    steps: string[];
    stepsEn?: string[];
    stepsFil?: string[];
    stepsId?: string[];
    cookTime: number;
    servings: number;
    difficulty: string;
    description: string;
    tags: string[];
    soupType?: string;
    benefits?: string;
    waterVolume?: string;
  }): SuggestedRecipe | null => {
    const recipe: SuggestedRecipe = {
      name: item.title && item.title !== "未命名食譜" ? item.title : (item.name || "未命名食譜"),
      nameEn: item.nameEn,
      nameFil: item.nameFil,
      nameId: item.nameId,
      cookTime: item.cookTime,
      servings: item.servings,
      difficulty: item.difficulty,
      description: item.description,
      ingredients: item.ingredients.map((ing) => ({
        name: ing.name,
        nameEn: ing.nameEn,
        nameFil: ing.nameFil,
        nameId: ing.nameId,
        quantity: ing.quantity ?? "適量",
        unit: ing.unit ?? "",
      })),
      steps: item.steps.length > 0 ? item.steps : item.instructions,
      stepsEn: item.stepsEn,
      stepsFil: item.stepsFil,
      stepsId: item.stepsId,
      tags: item.tags,
      soupType: item.soupType,
      benefits: item.benefits,
      waterVolume: item.waterVolume,
    };

    const filteredIngredients = recipe.ingredients.filter((ing) => !isPlaceholderIngredientName(ing.name));
    const actualIngredients = filteredIngredients.filter((ing) => !soupBaseIngredients.includes(ing.name.trim()));
    const actualSteps = recipe.steps.filter((step) => step.trim().length > 0);
    const isValid = recipe.name && recipe.name.length > 1 && actualSteps.length > 0 && actualIngredients.length > 0;
    if (!isValid) return null;
    return { ...recipe, ingredients: actualIngredients, steps: actualSteps };
  };

  if ("recipes" in data) {
    return data.recipes.map((item) => toRecipe({
      ...item,
      title: item.title,
      name: item.name,
      instructions: item.instructions ?? [],
      steps: item.steps ?? [],
      tags: item.tags ?? [],
    })).filter((recipe): recipe is SuggestedRecipe => Boolean(recipe));
  }

  const single = toRecipe({
    ...data,
    instructions: data.instructions ?? [],
    steps: data.steps ?? [],
    tags: data.tags ?? [],
  });
  return single ? [single] : [];
}

function makeSuggestedRecipe(input: SuggestedRecipe): SuggestedRecipe {
  return {
    ...input,
    source: input.source ?? "ai",
    tags: input.tags.length > 0 ? input.tags : ["AI 生成"],
  };
}

function normalizeQueryLocal(query: string): string {
  return String(query ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
    .replace(/[，,。．.、!！?？:：;；/\\()（）【】\[\]{}<>《》'"“”‘’·—-]/g, "")
    .trim();
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
  nameEn?: string;
  nameFil?: string;
  nameId?: string;
  cookTime: number;
  servings: number;
  difficulty: string;
  description: string;
  ingredients: { name: string; nameEn?: string; nameFil?: string; nameId?: string; quantity: string; unit: string }[];
  steps: string[];
  stepsEn?: string[];
  stepsFil?: string[];
  stepsId?: string[];
  tags: string[];
  soupType?: string;
  benefits?: string;
  waterVolume?: string;
  source?: "official" | "custom" | "ai";
  officialId?: number;
  customId?: number;
  thumbnailUrl?: string;
  image?: string;
  dishType?: string;
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
  db: Db, args: { query: string; category?: string; limit?: number; tags?: string[]; cookTimeMax?: number; excludeCategories?: string[] }, familyId?: number
) {
  const limit = args.limit ?? 15;
  const results: Record<string, unknown>[] = [];

  // 時間約束：單獨抽「N 分鐘」→ cookTime ≤ N；其餘字詞照常 AND 搜尋
  // 時間命中（cookTime 合符）可獨立命中，唔受關鍵字完全吻合限制（例如「30分鐘快煮」搵 30 分鐘食譜）
  const timeMatch = args.query.trim().toLowerCase().match(/(\d{1,3})\s*分鐘/);
  const minutes = timeMatch ? parseInt(timeMatch[1], 10) : undefined;
  const rawQuery = minutes && minutes > 0 ? args.query.replace(/(\d{1,3})\s*分鐘/g, " ") : args.query;
  const cookTimeMax = args.cookTimeMax ?? minutes;

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
    const timeCond = cookTimeMax && cookTimeMax > 0 ? lte(table.cookTime, cookTimeMax) : undefined;
    const tagConds = (args.tags ?? []).map(tag => ilike(table.tags, `%"${tag}"%`));
    const tagCond = tagConds.length > 0 ? and(...tagConds) : undefined;
    // 時間獨立命中（OR）；tags 用 AND（要符合所有 tag）
    const combined = [textCond, tagCond].filter(Boolean) as any[];
    const mainCond = combined.length > 0 ? and(...combined) : undefined;
    return mainCond && timeCond ? or(mainCond, timeCond) : (mainCond ?? timeCond);
  };

  const official = await db
    .select({
      id: officialRecipes.id, name: officialRecipes.name, nameEn: officialRecipes.nameEn, nameFil: officialRecipes.nameFil, nameId: officialRecipes.nameId, description: officialRecipes.description,
      cookTime: officialRecipes.cookTime, servings: officialRecipes.servings, difficulty: officialRecipes.difficulty,
      recipeCategory: officialRecipes.recipeCategory, ingredients: officialRecipes.ingredients,
      steps: officialRecipes.steps, tags: officialRecipes.tags, thumbnailUrl: officialRecipes.thumbnailUrl, image: officialRecipes.image,
      dishType: officialRecipes.dishType,
    })
    .from(officialRecipes)
    .where(and(
      eq(officialRecipes.isActive, true),
      buildSearchCond(officialRecipes, [officialRecipes.name, officialRecipes.description, officialRecipes.tags, officialRecipes.ingredients]),
      args.category ? eq(officialRecipes.recipeCategory, args.category) : undefined,
      args.excludeCategories && args.excludeCategories.length > 0 ? notInArray(officialRecipes.recipeCategory, args.excludeCategories) : undefined,
    ))
    .orderBy(desc(officialRecipes.createdAt)).limit(limit);

  for (const r of official) results.push({
    source: "official", id: r.id, name: r.name, nameEn: r.nameEn, nameFil: r.nameFil, nameId: r.nameId, description: r.description, cookTime: r.cookTime,
    servings: r.servings, difficulty: r.difficulty, category: r.recipeCategory,
    ingredients: safeParseJsonArray(r.ingredients).slice(0, 8),
    steps: safeParseJsonArray(r.steps), tags: safeParseJsonArray(r.tags),
    thumbnailUrl: r.thumbnailUrl, image: r.image, dishType: r.dishType,
  });

  if (familyId) {
    const custom = await db
      .select({
        id: customRecipes.id, name: customRecipes.name, nameEn: customRecipes.nameEn, nameFil: customRecipes.nameFil, nameId: customRecipes.nameId, description: customRecipes.description,
        cookTime: customRecipes.cookTime, servings: customRecipes.servings, difficulty: customRecipes.difficulty,
        recipeCategory: customRecipes.recipeCategory, ingredients: customRecipes.ingredients,
        steps: customRecipes.steps, tags: customRecipes.tags, thumbnailUrl: customRecipes.thumbnailUrl, image: customRecipes.image,
        dishType: customRecipes.dishType,
      })
      .from(customRecipes)
      .where(and(
        eq(customRecipes.familyId, familyId),
        buildSearchCond(customRecipes, [customRecipes.name, customRecipes.description, customRecipes.tags, customRecipes.ingredients]),
        args.category ? eq(customRecipes.recipeCategory, args.category) : undefined,
        args.excludeCategories && args.excludeCategories.length > 0 ? notInArray(customRecipes.recipeCategory, args.excludeCategories) : undefined,
      ))
      .orderBy(desc(customRecipes.createdAt)).limit(limit);

    for (const r of custom) results.push({
      source: "custom", id: r.id, name: r.name, nameEn: r.nameEn, nameFil: r.nameFil, nameId: r.nameId, description: r.description, cookTime: r.cookTime,
      servings: r.servings, difficulty: r.difficulty, category: r.recipeCategory,
      ingredients: safeParseJsonArray(r.ingredients).slice(0, 8),
      steps: safeParseJsonArray(r.steps), tags: safeParseJsonArray(r.tags),
      thumbnailUrl: r.thumbnailUrl, image: r.image, dishType: r.dishType,
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

// Get mixed recipes from database (custom + official) with soup filtering
async function getMixedRecipes(
  db: Db | null,
  familyId: number | undefined,
  count: number,
  soupIntent: boolean,
  excludeNames: Set<string> = new Set()
): Promise<{ recipes: SuggestedRecipe[]; fromDb: number }> {
  const recipes: SuggestedRecipe[] = [];
  let fromDb = 0;

  if (!db) return { recipes, fromDb: 0 };

  try {
    // Search from both official and custom recipes
    const searchResult = await execSearchRecipes(db, { query: soupIntent ? "家常" : "家常", limit: 50 }, familyId);
    let libResults = (searchResult.recipes || []) as Record<string, unknown>[];

    // Filter out recently used recipes
    if (excludeNames.size > 0) {
      libResults = libResults.filter((r: any) => !excludeNames.has(String(r.name ?? "")));
    }

    if (soupIntent) {
      // Separate soup and non-soup recipes
      const soupRecipes = libResults.filter((r: any) => {
        const tagsStr = JSON.stringify(r.tags || "");
        const soupTypeStr = JSON.stringify(r.soupType || "");
        return tagsStr.includes("湯") || soupTypeStr.includes("湯") || String(r.name || "").includes("湯");
      });
      const nonSoupRecipes = libResults.filter((r: any) => {
        const tagsStr = JSON.stringify(r.tags || "");
        const soupTypeStr = JSON.stringify(r.soupType || "");
        return !tagsStr.includes("湯") && !soupTypeStr.includes("湯") && !String(r.name || "").includes("湯");
      });

      // Pick 1 soup + (count-1) non-soup
      const soupCount = Math.min(1, soupRecipes.length);
      const nonSoupCount = Math.min(count - 1, nonSoupRecipes.length);

      // Shuffle and pick
      const shuffledSoup = soupRecipes.sort(() => Math.random() - 0.5).slice(0, soupCount);
      const shuffledNonSoup = nonSoupRecipes.sort(() => Math.random() - 0.5).slice(0, nonSoupCount);

      // Add soup first
      for (const r of shuffledSoup) {
        const isOfficial = (r as any)._tableName === "recipes" || (r as any).officialId;
        recipes.push({
          name: String(r.name ?? ""),
          nameEn: (r as any).nameEn || undefined,
          nameFil: (r as any).nameFil || undefined,
          nameId: (r as any).nameId || undefined,
          description: String(r.description ?? ""),
          cookTime: Number(r.cookTime ?? 30),
          servings: Number(r.servings ?? 4),
          difficulty: String(r.difficulty ?? "medium") as "easy" | "medium" | "hard",
          ingredients: Array.isArray(r.ingredients) ? (r.ingredients as any[]).map((i: any) => ({
            name: String(i.name ?? ""),
            quantity: String(i.quantity ?? ""),
            unit: String(i.unit ?? ""),
          })) : [],
          steps: Array.isArray(r.steps) ? (r.steps as any[]).map((s: any) => String(s.instruction ?? s.text ?? "")) : [],
          tags: Array.isArray(r.tags) ? (r.tags as any[]).map(String) : [],
          source: isOfficial ? "official" : "custom",
          officialId: isOfficial ? (r.id as number) : undefined,
          customId: !isOfficial ? (r.id as number) : undefined,
          soupType: (r as any).soupType || undefined,
          benefits: (r as any).benefits || undefined,
          waterVolume: (r as any).waterVolume || undefined,
        });
        fromDb++;
      }

      // Add non-soup
      for (const r of shuffledNonSoup) {
        const isOfficial = (r as any)._tableName === "recipes" || (r as any).officialId;
        recipes.push({
          name: String(r.name ?? ""),
          nameEn: (r as any).nameEn || undefined,
          nameFil: (r as any).nameFil || undefined,
          nameId: (r as any).nameId || undefined,
          description: String(r.description ?? ""),
          cookTime: Number(r.cookTime ?? 30),
          servings: Number(r.servings ?? 4),
          difficulty: String(r.difficulty ?? "medium") as "easy" | "medium" | "hard",
          ingredients: Array.isArray(r.ingredients) ? (r.ingredients as any[]).map((i: any) => ({
            name: String(i.name ?? ""),
            quantity: String(i.quantity ?? ""),
            unit: String(i.unit ?? ""),
          })) : [],
          steps: Array.isArray(r.steps) ? (r.steps as any[]).map((s: any) => String(s.instruction ?? s.text ?? "")) : [],
          tags: Array.isArray(r.tags) ? (r.tags as any[]).map(String) : [],
          source: isOfficial ? "official" : "custom",
          officialId: isOfficial ? (r.id as number) : undefined,
          customId: !isOfficial ? (r.id as number) : undefined,
        });
        fromDb++;
      }
    } else {
      // Regular mode: just pick 'count' recipes
      const shuffled = libResults.sort(() => Math.random() - 0.5).slice(0, count);
      for (const r of shuffled) {
        const isOfficial = (r as any)._tableName === "recipes" || (r as any).officialId;
        recipes.push({
          name: String(r.name ?? ""),
          nameEn: (r as any).nameEn || undefined,
          nameFil: (r as any).nameFil || undefined,
          nameId: (r as any).nameId || undefined,
          description: String(r.description ?? ""),
          cookTime: Number(r.cookTime ?? 30),
          servings: Number(r.servings ?? 4),
          difficulty: String(r.difficulty ?? "medium") as "easy" | "medium" | "hard",
          ingredients: Array.isArray(r.ingredients) ? (r.ingredients as any[]).map((i: any) => ({
            name: String(i.name ?? ""),
            quantity: String(i.quantity ?? ""),
            unit: String(i.unit ?? ""),
          })) : [],
          steps: Array.isArray(r.steps) ? (r.steps as any[]).map((s: any) => String(s.instruction ?? s.text ?? "")) : [],
          tags: Array.isArray(r.tags) ? (r.tags as any[]).map(String) : [],
          source: isOfficial ? "official" : "custom",
          officialId: isOfficial ? (r.id as number) : undefined,
          customId: !isOfficial ? (r.id as number) : undefined,
        });
        fromDb++;
      }
    }
  } catch (e) {
    console.warn("[getMixedRecipes] Failed:", e);
  }

  return { recipes, fromDb };
}

// ─── 3餸1湯 library helper（1 湯 + 3 餸，唔夠就由 AI 補）──────────────────
type DishType = "soup" | "meat" | "seafood" | "vegetable" | "dessert" | "drink" | "other";

const DISH_TYPE_MAP: Record<string, DishType> = {
  "湯": "soup", "湯水": "soup", "湯品": "soup", "煲湯": "soup", "老火湯": "soup", "燉湯": "soup", "滾湯": "soup",
  "肉類": "meat", "主菜": "meat", "肉": "meat", "豬": "meat", "牛": "meat", "雞": "meat", "肉類主菜": "meat",
  "海鮮": "seafood", "魚": "seafood", "蝦": "seafood", "蟹": "seafood", "海鮮類": "seafood", "蛋白": "seafood", "海鮮/蛋白": "seafood",
  "蔬菜": "vegetable", "菜": "vegetable", "素菜": "vegetable", "蔬果": "vegetable", "蔬菜類": "vegetable", "小炒": "vegetable",
  "甜品": "dessert", "糖水": "dessert", "糕": "dessert", "點心": "dessert",
  "飲品": "drink", "涼茶": "drink", "飲料": "drink", "清熱飲": "drink",
};

function normalizeDishType(v: string | undefined): DishType | undefined {
  if (!v) return undefined;
  const s = String(v).trim();
  if (DISH_TYPE_MAP[s]) return DISH_TYPE_MAP[s];
  for (const [k, t] of Object.entries(DISH_TYPE_MAP)) {
    if (s.includes(k)) return t;
  }
  return undefined;
}

// 將食譜分類為「餸 / 湯 / 甜品 / 飲品」等，令 3 餸 1 湯 唔會揀錯甜品湯水做餸。
// 優先：明確 dishType 欄 → soupType → tags → recipeCategory → 菜名關鍵字 → other
function classifyDishType(r: Record<string, unknown>): DishType {
  const tags = (Array.isArray(r.tags) ? r.tags : []).map(String);
  const tagsStr = tags.join(" ");
  const name = String(r?.name ?? "").trim();
  const category = String(r?.recipeCategory ?? "").trim();
  const soupType = String((r as any)?.soupType ?? "").trim();

  // 1) 明確 dishType 欄（用戶/官方可控）
  const explicit = normalizeDishType(String((r as any)?.dishType ?? "").trim());
  if (explicit) return explicit;

  // 2) 明確 soupType（真湯）
  if (soupType) return "soup";

  // 3) tags 湯/甜品/飲品（先）
  if (/湯水|煲湯|燉湯|老火湯|滾湯|湯品|魚湯|雞湯|排骨湯|濃湯|清湯|湯羹|羅宋湯|粟米湯|番茄湯|(^|[\s,、])湯($|[\s,、])/.test(tagsStr)) return "soup";
  if (/涼茶|飲品|飲料|清熱|竹蔗茅根|茅根水|山楂水|薏米水|蘆根|羅漢果|菊花茶|檸檬茶|雪梨水|陳皮水|汽水|果汁|鮮榨|梳打/.test(tagsStr)) return "drink";
  if (/甜品|糖水|西米露|布甸|布丁|啫喱|慕斯|雪糕|蛋糕|蛋撻|曲奇|奶凍|糕點|甜點|芝麻糊|紅豆沙|綠豆沙|楊枝甘露|芋圓/.test(tagsStr)) return "dessert";

  // 4) 菜名湯/甜品/飲品（優先過 tags 蛋白/蔬菜，避免「魚湯/蜆湯」被當海鮮餸，令一餐兩個湯）
  if (/湯$|湯水|煲湯|燉湯|老火湯|滾湯|湯品|魚湯|雞湯|排骨湯|濃湯|清湯|湯羹|羅宋湯|粟米湯|番茄湯/.test(name)) return "soup";
  if (/糖水|西米露|布甸|布丁|啫喱|慕斯|雪糕|蛋糕|蛋撻|曲奇|奶凍|糕點|甜點|芝麻糊|紅豆沙|綠豆沙|楊枝甘露|芋圓|糕$/.test(name)) return "dessert";
  if (/水$|涼茶|竹蔗茅根|茅根水|山楂水|薏米水|蘆根|羅漢果|菊花茶|檸檬茶|雪梨水|陳皮水|汽水|果汁|茶飲/.test(name)) return "drink";
  // 4b) 菜名含明確蔬菜字 → 蔬菜（優先過 tags 蛋白，避免「蠔油芥蘭」因為蠔油=蠔而被誤判海鮮）
  if (/菜心|芥蘭|通菜|菠菜|生菜|白菜|椰菜|西蘭花|時蔬|素菜|青菜|蔬菜|南瓜|蘿蔔|薯仔|番茄|茄子|青椒|洋蔥|節瓜|勝瓜|苦瓜|西洋菜|冬瓜|青瓜|黃瓜|絲瓜|豆芽|豆角|青豆|毛豆|雲耳|木耳|菇|菌|芽菜/.test(name)) return "vegetable";

  // 5) recipeCategory（菜系中含甜品/飲品/湯水）
  if (category === "甜品") return "dessert";
  if (category === "飲品") return "drink";
  if (category === "湯水") return "soup";

  // 6) tags 蛋白/蔬菜（淨係湯/甜品/飲品以外先至係餸）
  if (/海鮮|魚|蝦|蟹|蜆|蠔|帶子|鮑|海參|花膠|龍蝦|石斑|魷魚|章魚|墨魚|三文魚|鱸魚|蛋白|豆腐|豆卜|豆干|腐皮|雞蛋|皮蛋|蒸蛋/.test(tagsStr)) return "seafood";
  if (/豬|牛|雞|鴨|鵝|羊|肉|排骨|腩|雞翼|雞腿|雞髀|肉丸|叉燒|燒肉|豬扒|牛扒|雞扒|豬手|豬腳/.test(tagsStr)) return "meat";
  if (/蔬菜|素菜|青菜|時蔬|菜心|芥蘭|通菜|菠菜|生菜|白菜|椰菜|西蘭花|南瓜|蘿蔔|薯仔|番茄|茄子|青椒|洋蔥|粟米|節瓜|勝瓜|苦瓜|西洋菜|瓜|菇|菌|芽|豆芽|豆角|青豆|毛豆|雲耳|木耳/.test(tagsStr)) return "vegetable";

  // 7) 菜名蛋白/蔬菜
  if (/蒸魚|清蒸|炒蝦|蝦|蟹|鮑魚|蒸鱸|魚片|帶子|海參|花膠|龍蝦|石斑|魷魚|章魚|墨魚|三文魚|蜆|蠔|豆腐|豆卜|豆干|腐皮|蒸蛋|炒蛋/.test(name)) return "seafood";
  if (/排骨|牛|雞|豬|肉|鴨|鵝|羊|腩|雞翼|雞腿|雞髀|肉丸|焗豬|叉燒|燒肉|豬扒|牛扒|雞扒|豬手|豬腳/.test(name)) return "meat";
  if (/炒.*菜|蔬菜|青菜|時蔬|菜心|芥蘭|通菜|菠菜|生菜|白菜|椰菜|西蘭花|南瓜|蘿蔔|薯仔|番茄|茄子|青椒|洋蔥|粟米|節瓜|勝瓜|苦瓜|西洋菜|瓜|菇|菌|芽|豆芽|豆角|青豆|毛豆|雲耳|木耳/.test(name)) return "vegetable";

  return "other";
}

// 將餸再細分「家族」（麵/飯/點心/其他），避免 3 餸 1 湯抽到兩款麵/兩款飯
function dishFamily(name: string): string {
  if (/麵|粉|米線|河粉|烏冬|拉麵|伊麵|意粉|通粉|粉絲|炒麵|撈麵|公仔麵/.test(name)) return "noodle";
  if (/飯|炒飯|焗飯|糯米|煲仔飯|丼|蓋飯/.test(name)) return "rice";
  if (/包|饅頭|餃|雲吞|點心/.test(name)) return "dumpling";
  return "other";
}

// 由 library rows 揀「1 湯 + 3 餸」；排除已睇過（優先 fresh，池盡翻兜）
function pickSoupMeal(rows: Record<string, unknown>[], exclude: string[]): SuggestedRecipe[] {
  const excluded = new Set(exclude.map(normalizeName).filter(Boolean));

  const classify = (r: Record<string, unknown>) => classifyDishType(r);
  const family = (r: Record<string, unknown>) => dishFamily(String(r.name ?? ""));

  // ── 唔再輪換菜系（避免 pool 收窄到細菜系 → 重複）——由成個 library pool 抽，食譜庫大先有變化 ──
  // 淨係保留「有 steps」嘅食譜（避免最後 .map() 因為冇 steps 而 return null，令餐唔齊 4 張）
  const hasSteps = (r: Record<string, unknown>) => {
    const s = Array.isArray(r.steps) ? r.steps : [];
    return s.some((st: any) => String(st?.instruction ?? st?.text ?? st ?? "").trim());
  };
  const pool = rows.filter(hasSteps);

  // 主食（麵/飯）喺 3餸1湯 唔做餸、唔做湯：無論 classify 分做咩，一律排除，避免誤分類嘅麵/飯偷入
  const isCarb = (r: Record<string, unknown>) => { const f = family(r); return f === "noodle" || f === "rice"; };
  const noCarb = (r: Record<string, unknown>) => !isCarb(r);

  const soupPool = pool.filter(r => classify(r) === "soup" && noCarb(r));
  const meatPool = pool.filter(r => classify(r) === "meat" && noCarb(r));
  const seafoodPool = pool.filter(r => classify(r) === "seafood" && noCarb(r));
  const vegPool = pool.filter(r => classify(r) === "vegetable" && noCarb(r));
  const otherPool = pool.filter(r => classify(r) === "other" && noCarb(r));
  const dishPool = [...meatPool, ...seafoodPool, ...vegPool, ...otherPool];
  console.log(`[pickSoupMeal] pool=${pool.length} soup=${soupPool.length} meat=${meatPool.length} seafood=${seafoodPool.length} veg=${vegPool.length} other=${otherPool.length} (raw rows=${rows.length}, noSteps=${rows.length - pool.length})`);

  const pickN = (arr: Record<string, unknown>[], n: number): Record<string, unknown>[] => {
    if (n <= 0 || arr.length === 0) return [];
    const fresh = arr.filter(r => !excluded.has(normalizeName(String(r.name ?? ""))));
    const reused = arr.filter(r => excluded.has(normalizeName(String(r.name ?? ""))));
    const pool = (fresh.length > 0 ? fresh : reused).sort(() => Math.random() - 0.5);
    return pool.slice(0, n);
  };

  const soup = pickN(soupPool, 1);
  const usedFams = new Set<string>();
  // 揀餸時偏好同已揀「唔同家族」嘅餸（避免兩款麵/兩款飯），fresh 優先次序保留
  const pickNByFamily = (arr: Record<string, unknown>[], n: number): Record<string, unknown>[] => {
    if (n <= 0 || arr.length === 0) return [];
    const fresh = arr.filter(r => !excluded.has(normalizeName(String(r.name ?? ""))));
    const reused = arr.filter(r => excluded.has(normalizeName(String(r.name ?? ""))));
    const pool = (fresh.length > 0 ? fresh : reused).sort((a, b) => {
      const pa = usedFams.has(dishFamily(String(a.name ?? ""))) ? 1 : 0;
      const pb = usedFams.has(dishFamily(String(b.name ?? ""))) ? 1 : 0;
      return pa - pb || Math.random() - 0.5;
    });
    return pool.slice(0, n);
  };
  const addDish = (arr: Record<string, unknown>[], n: number) => {
    const picked = pickNByFamily(arr, n);
    picked.forEach(r => usedFams.add(dishFamily(String(r.name ?? ""))));
    return picked;
  };

  let dishes: Record<string, unknown>[] = [];
  dishes = dishes.concat(addDish(meatPool, 1));
  // 海鮮位：魚/豆腐/蛋 50%、魷魚/蜆/蝦 30%、其他海鮮 20%（weighted，魚豆腐蛋出最多）
  const seafoodSlot = () => {
    const nm = (r: Record<string, unknown>) => String(r.name ?? "");
    const isFishTofuEgg = (r: Record<string, unknown>) => /魚|鱸|三文魚|鯇|鯪|鯧|黃花|多寶|龍躉|鱈|鰻|豆腐|豆卜|豆干|腐皮|雞蛋|皮蛋|蒸蛋|炒蛋|蛋/.test(nm(r));
    const isSquidClamShrimp = (r: Record<string, unknown>) => /魷魚|章魚|墨魚|蜆|蠔|蝦/.test(nm(r));
    const groups = [
      { arr: seafoodPool.filter(isFishTofuEgg), w: 50 },
      { arr: seafoodPool.filter(isSquidClamShrimp), w: 30 },
      { arr: seafoodPool.filter(r => !isFishTofuEgg(r) && !isSquidClamShrimp(r)), w: 20 },
    ].filter(g => g.arr.length > 0);
    if (groups.length === 0) return addDish(seafoodPool, 1);
    const total = groups.reduce((s, g) => s + g.w, 0);
    let r = Math.random() * total;
    for (const g of groups) { r -= g.w; if (r <= 0) return addDish(g.arr, 1); }
    return addDish(groups[groups.length - 1].arr, 1);
  };
  dishes = dishes.concat(seafoodSlot());
  dishes = dishes.concat(addDish(vegPool, 1));
  // 3餸1湯：主食（麵/飯）唔做餸（上面 pool 已排除），永遠 1肉 + 1海鮮 + 1菜(+補其他) = 真3餸
  let want = 3 - dishes.length;
  if (want > 0) {
    const already = new Set(dishes.map(r => r));
    dishes = dishes.concat(addDish(otherPool.filter(r => !already.has(r)), want));
  }
  if (dishes.length < 3) {
    const already = new Set(dishes.map(r => r));
    dishes = dishes.concat(addDish(dishPool.filter(r => !already.has(r)), 3 - dishes.length));
  }
  // 極兜底：連非主食餸都唔夠先准用主食（保證唔少過 3 餸）
  if (dishes.length < 3) {
    const already = new Set(dishes.map(r => r));
    dishes = dishes.concat(addDish(dishPool.filter(r => !already.has(r)), 3 - dishes.length));
  }

  let picked = [...soup, ...dishes];
  // 兜底：唔夠 4 張 → 由全庫非甜品/飲品/主食補（保證有卡，之後 AI 補尾數）
  if (picked.length < 4) {
    const already = new Set(picked.map(r => r));
    const rest = pool.filter(r => !already.has(r) && !isCarb(r) && classify(r) !== "dessert" && classify(r) !== "drink")
      .sort(() => Math.random() - 0.5);
    picked = picked.concat(rest.slice(0, 4 - picked.length));
  }
  // 極兜底：全庫都係甜品/飲品/主食先准用
  if (picked.length < 4) {
    const already = new Set(picked.map(r => r));
    const rest = pool.filter(r => !already.has(r)).sort(() => Math.random() - 0.5);
    picked = picked.concat(rest.slice(0, 4 - picked.length));
  }

  return picked.map((r: any): SuggestedRecipe | null => {
    const steps = (Array.isArray(r.steps) ? r.steps : [])
      .map((st: any) => typeof st === "string" ? st : String(st?.instruction ?? st?.text ?? st ?? ""))
      .map((t: string) => t.trim()).filter(Boolean);
    if (steps.length === 0) return null;
    const official = r.source === "official";
    return {
      name: String(r.name ?? "").trim(),
      description: String(r.description ?? "").trim(),
      cookTime: Number(r.cookTime ?? 30) || 30,
      servings: Number(r.servings ?? 4) || 4,
      difficulty: String(r.difficulty ?? "medium"),
      ingredients: (Array.isArray(r.ingredients) ? r.ingredients : []).map((i: any) => ({
        name: String(i?.name ?? "").trim(),
        quantity: String(i?.quantity ?? "").trim(),
        unit: String(i?.unit ?? "").trim(),
      })).filter((x: any) => x.name),
      steps,
      tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
      source: official ? "official" : "custom",
      officialId: official ? Number(r.id) : undefined,
      customId: !official ? Number(r.id) : undefined,
      thumbnailUrl: String(r?.thumbnailUrl ?? "").trim() || undefined,
      image: String(r?.image ?? "").trim() || undefined,
      dishType: String(r?.dishType ?? "").trim() || undefined,
      soupType: (r as any).soupType || undefined,
      benefits: (r as any).benefits || undefined,
      waterVolume: (r as any).waterVolume || undefined,
    };
  }).filter((r: SuggestedRecipe | null): r is SuggestedRecipe => !!r);
}

// 將 search 條件（時間上限 + 排除類別）後置套用喺 generic pool，令「30 分鐘 button」等唔會抽到超時/甜品/湯水/飲品
function applySearchFilters(rows: Record<string, unknown>[], search?: { cookTimeMax?: number; excludeCategories?: string[] }): Record<string, unknown>[] {
  if (!search) return rows;
  const exc = (search.excludeCategories ?? []).map(String);
  return rows.filter(r => {
    const ct = Number(r.cookTime ?? 0);
    if (search.cookTimeMax && ct > search.cookTimeMax) return false;
    const d = classifyDishType(r);
    if (exc.includes("甜品") && d === "dessert") return false;
    if (exc.includes("湯水") && d === "soup") return false;
    if (exc.includes("飲品") && d === "drink") return false;
    if (d === "drink") return false; // 一餐唔會淨係得飲品
    return true;
  });
}

// 由 AI 補缺（library 唔夠時）
const MEAL_TYPE_LABEL: Record<string, { label: string; isSoup: boolean }> = {
  meat: { label: "肉類主菜（如豬/牛/雞）", isSoup: false },
  seafood: { label: "海鮮/其他蛋白主菜（如魚/蝦/豆腐蛋）", isSoup: false },
  vegetable: { label: "蔬菜/小炒", isSoup: false },
  soup: { label: "湯水", isSoup: true },
};

// 由 library 揀出嚟嘅 SuggestedRecipe 判斷屬邊類（用返 classifyDishType 規則）
function mealTypeOf(r: SuggestedRecipe): DishType {
  return classifyDishType({
    name: r.name,
    tags: r.tags,
    dishType: r.dishType,
    soupType: r.soupType,
  } as unknown as Record<string, unknown>);
}

// 由 AI 補缺（library 唔夠時）。neededTypes 指定缺失類別 → 逐類生成，確保 3餸1湯 結構。
async function generateMissingRecipes(
  count: number,
  needSoup: boolean,
  exclude: string[],
  familyId: number | undefined,
  userId: number | undefined,
  neededTypes?: DishType[]
): Promise<SuggestedRecipe[]> {
  if (count <= 0) return [];
  // 指定缺失類別 → 逐類生成（避免 AI 亂補出麵/飯/錯類）
  if (neededTypes && neededTypes.length > 0) {
    const results = await Promise.all(
      neededTypes.map(t => {
        return generateOneType(MEAL_TYPE_LABEL[t]?.label ?? "家常菜", t, exclude);
      })
    );
    return results.filter((r): r is SuggestedRecipe => !!r).slice(0, count);
  }
  try {
    const soupHint = needSoup ? "必須包含 1 個湯水食譜。" : "";
    const prompt = `請生成 ${count} 個家常菜食譜。${soupHint} 絕對唔可以重複以下已推薦過嘅菜式，必須全新（名唔同但同一款菜、近似嘅都唔可以）：${dedupeNames(exclude).slice(0, 15).join("、")}。每個食譜請包含：名稱、描述、煮食時間（分鐘）、難度、份量、食材清單（名稱、數量、單位）、步驟（請精簡，4-5 步）。用繁體中文。每個食譜同每個 ingredient 請同時提供英文名（nameEn）；steps 係中文步驟，同時提供 stepsEn（英文步驟，每一步對應）。回傳 JSON：{"recipes":[{"name":"...","nameEn":"...","cookTime":30,"servings":4,"difficulty":"簡單","description":"...","ingredients":[{"name":"...","nameEn":"...","quantity":"...","unit":"..."}],"steps":["..."],"stepsEn":["..."]}]}`;
    const resp = await invokeLLM({
      messages: [{ role: "user", content: prompt }],
      maxTokens: 2600 * count,
      temperature: 0.7,
      timeoutMs: 30000,
      maxRetries: 1,
      enableSearch: false,
      responseFormat: { type: "json_object" },
    });
    const raw = resp.choices?.[0]?.message?.content || "";
    const parsed = parseRecipeWithFallback(raw);
    if (parsed.recipes.length > 0) return parsed.recipes.slice(0, count);
    // JSON mode 常見：單一 object 冇 recipes wrapper → 嘗試直接 convert
    const extracted = extractJSON<Record<string, unknown>>(raw);
    if (extracted && extracted.name) {
      const single = manuallyConvertRecipes([extracted], undefined);
      if (single.length > 0) return single.slice(0, count);
    }
    console.warn(`[AI Chef] generateMissingRecipes parse empty, raw: ${raw.slice(0, 120)}`);
    return [];
  } catch (e) {
    console.warn("[AI Chef] generateMissingRecipes failed:", e);
    return [];
  }
}

// 生成單一類別嘅一個食譜（用嚟 3餸1湯 按「缺失類別」補缺，避免 AI 亂補出麵/飯/錯類）
async function generateOneType(
  label: string,
  expectedType: DishType,
  exclude: string[]
): Promise<SuggestedRecipe | null> {
  const isSoup = expectedType === "soup";
  const isVeg = expectedType === "vegetable";
  // 由 exclude 抽「出過嘅湯」：湯位用完整清單（唔 slice-15），確保唔再出返已睇過嘅湯
  const soupExclude = exclude.filter(n => /湯|羹/.test(String(n ?? "")));
  // 撞到「出過」嘅菜/湯（近似）就唔收 → retry 出新（連餸菜都唔重複）
  const seenCheck = (name: string) => {
    const n = normalizeName(name);
    return exclude.some(e => e && (e === n || nameSimilarity(e, n) >= 0.6));
  };
  const avoidList = isSoup ? soupExclude : exclude.slice(0, 15);
  const soupHint = isSoup
    ? `必須係湯水。唔好淨係出例湯/老火湯，試下唔同種類嘅湯（清湯/燉湯/羹/西式/素湯等），要同之前唔同。絕對唔可以再出以下出過嘅湯：${soupExclude.join("、")}。`
    : isVeg
      ? "呢道必須係一道蔬菜（清淡為主，唔好配肉/海鮮做主角，例如蒜蓉炒菜心、清炒西蘭花、上湯浸時蔬）；唔可以係湯、唔可以係麵/飯。"
      : "呢道必須係一道主菜/小炒，唔可以係湯（例如湯、羹、湯麵都唔得）、唔可以係麵、唔可以係飯（主食）。";
  const basePrompt = `請生成 1 個${label}家常菜食譜（只此一道）。${soupHint} name 欄只寫呢道餸本身嘅名（例如「紅燒肉」「清蒸鱸魚」），絕對唔可以加入其他菜式或湯水喺名入面。絕對唔可以重複以下已推薦過嘅菜式，必須全新（名唔同但同一款菜、近似嘅都唔可以）：${avoidList.join("、")}。用繁體中文。每個 ingredient 請提供英文名（nameEn）；呢道餸本身提供 nameEn（英文名）。steps 係中文步驟（請精簡，4-5 步）；請同時提供 stepsEn（英文步驟），每一步對應中文步驟嘅同一步，份量/時間一致。回傳以下 JSON 格式（單一食譜 object，唔好加 array wrapper）：{"name":"...","nameEn":"...","cookTime":30,"servings":4,"difficulty":"簡單","description":"...","ingredients":[{"name":"...","nameEn":"...","quantity":"...","unit":"..."}],"steps":["..."],"stepsEn":["..."]}`;

  const attempt = async (extra: string): Promise<SuggestedRecipe | null> => {
    try {
      const resp = await invokeLLM({
        messages: [{ role: "user", content: basePrompt + extra }],
        maxTokens: 1800,
        temperature: 0.7,
        timeoutMs: 12000,
        maxRetries: 0,
        enableSearch: false,
        responseFormat: { type: "json_object" },
      });
      const raw = resp.choices?.[0]?.message?.content || "";
      const extracted = extractJSON<Record<string, unknown>>(raw);
      if (!extracted || typeof extracted !== "object" || !extracted.name) {
        console.warn("[AI Chef] meal item bad JSON:", raw.slice(0, 120));
        return null;
      }
      const converted = manuallyConvertRecipes([extracted], undefined);
      return converted[0] ?? null;
    } catch (e) {
      console.warn("[AI Chef] meal item failed:", e);
      return null;
    }
  };

  // 驗證：湯位必須湯；菜位必須真蔬菜（清淡，唔配肉）；肉/海鮮位只要唔係湯/甜品/飲品就收（避免 3 卡）
  const validateType = (rec: SuggestedRecipe | null): boolean => {
    if (!rec) return false;
    const t = classifyDishType({ name: rec.name, tags: rec.tags, dishType: rec.dishType, soupType: rec.soupType } as unknown as Record<string, unknown>);
    if (isSoup) {
      // 湯位放寬：classify 判 soup，或者名/tags 有「湯/羹」字都當湯（避免嚴判導致無湯）
      if (t === "soup") return true;
      const nm = String(rec.name || "");
      const tagsStr = (Array.isArray(rec.tags) ? rec.tags : []).join(" ");
      const soupTypeStr = String((rec as any)?.soupType ?? "");
      return /湯|羹/.test(nm) || /湯|羹/.test(tagsStr) || !!soupTypeStr;
    }
    if (isVeg) return t === "vegetable";
    return t !== "soup" && t !== "dessert" && t !== "drink";
  };
  // 「新鮮」：唔係已睇過嘅（近似）菜/湯 —— 用嚟優先揀新鮮，但唔會因為撞到近似就 drop（保證出到卡）
  const isFresh = (rec: SuggestedRecipe | null): boolean => !!rec && !seenCheck(rec.name);

  // 任何 slot 都「重試一次」：第一次驗證唔過就 retry（湯位最易被近似去重刪走 → 要 retry 保底）
  const retryHint = isSoup
    ? `（注意：一定要係一個全新、未出過嘅湯，唔可以係：${soupExclude.join("、")}。）`
    : isVeg
      ? "（注意：一定要係純蔬菜，唔可以配肉/海鮮做主食材，例如蒜蓉炒菜心、清炒西蘭花。）"
      : "（注意：一定要係一道主菜/小炒，唔可以係湯、麵、飯。）";

  // 新鮮優先：先試新鮮；揀唔到新鮮就照收「類型啱」嘅卡做保底 —— 保證每個 slot 都出到卡（唔會跌去 1 卡）
  let first = await attempt("");
  if (validateType(first) && isFresh(first)) return first; // 新鮮，1 次 call 就搞掂
  let second = await attempt(retryHint); // 先唔係新鮮/類型錯 → 先 retry 再試新鮮
  if (validateType(second) && isFresh(second)) return second;
  if (validateType(second)) return second; // 收近似，保證有卡
  if (validateType(first)) return first;   // 收近似，保證有卡
  console.warn(`[AI Chef] ${expectedType} slot type-invalid, dropped`);
  return null;
}

// 3餸1湯 AI 生成：並行 4 個獨立 call（1 湯 + 3 餸），每個 ~8-10s，總時間 ~10s（比起一次過生成 4 個 20-30s 快好多）
async function generateMealRecipesParallel(
  exclude: string[],
  familyId: number | undefined,
  userId: number | undefined
): Promise<SuggestedRecipe[]> {
  const types = [
    { label: "肉類主菜（如豬/牛/雞）", expectedType: "meat" as DishType },
    { label: "海鮮/其他蛋白主菜（如魚/蝦/豆腐蛋）", expectedType: "seafood" as DishType },
    { label: "蔬菜/小炒", expectedType: "vegetable" as DishType },
    { label: "湯水", expectedType: "soup" as DishType },
  ];
  // 每個類型並行生成 1 個候選（共 4 個）—— 快（少一半 LLM call，唔會並行 8 個互相排隊拖慢）。
  // 若某類型失敗，交返 meal backfill（缺失類別）補返，保證 4 卡。
  const results = await Promise.allSettled(
    types.map(t => generateOneType(t.label, t.expectedType, exclude))
  );
  // 去重：同一個名 / 近似名出現兩次就刪，確保每道唔重複（只喺「並行結果內部」去重）。
  // 唔再對「已睇過 exclude」做近似去重 —— 令 parallel 唔會 drop 到 0（觸發慢嘅 16s 順序 fallback）；
  // 跨 session 去重交返最後 mergedExclude filter（line 2569）做，backfill 會針對缺失類別快速並行補返。
  const seen = new Set<string>();
  return results.flatMap((r): SuggestedRecipe[] => {
    if (r.status !== "fulfilled" || !r.value) return [];
    const recipe = r.value;
    const k = normalizeName(recipe.name);
    if (seen.has(k)) return [];
    seen.add(k);
    return [recipe];
  });
}

// 由 parallel 嘅候選池揀「多樣化」：每個類型最多一個（湯/肉/海鮮/菜），唔好重複類別。
// 若某類型（例如蔬菜）冇候選 → 回傳 <4（唔會用「第 2 個海鮮」填位）→ 交返下面 backfill 針對缺失類別補返。
function pickDiverseMeal(candidates: SuggestedRecipe[], exclude: string[]): SuggestedRecipe[] {
  const byType: Record<DishType, SuggestedRecipe[]> = { meat: [], seafood: [], vegetable: [], soup: [], other: [], dessert: [], drink: [] };
  const excluded = exclude.map(normalizeName).filter(Boolean);
  const isSeen = (name: string) => {
    const n = normalizeName(name);
    return excluded.some(e => e && (e === n || nameSimilarity(e, n) >= 0.6));
  };
  for (const c of candidates) {
    const t = mealTypeOf(c);
    if (byType[t]) byType[t].push(c);
  }
  const order: DishType[] = ["soup", "meat", "seafood", "vegetable"];
  const picked: SuggestedRecipe[] = [];
  // 每個類型最多一個 —— 唔再用「多餘候選」填位，避免「冇菜 + 雙海鮮」
  // 每個類型優先揀「未睇過」嗰個候選，減少最後 filter drop → 少行 backfill（更快）
  for (const t of order) {
    const list = byType[t];
    if (list.length === 0) continue;
    const fresh = list.find(c => !isSeen(c.name));
    picked.push(fresh ?? list[0]);
  }
  return picked;
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
function buildSystemPrompt(libSummary: string, soupIntent = false, lang = "zh-TW"): string {
  let modeSection = `\n\n你係 AI 助手，一個親切嘅烹飪對話夥伴。判斷用戶意圖：

**如果用戶想食譜**（例如「今晚食咩」、「我想整番茄炒蛋」、「有咩好煮」、「beef」）：
你必須用以下 JSON 格式回覆，唔可以用純文字，因為系統要顯示食譜卡。
每個食譜請同時提供：name（中文名）、nameEn（英文名）；每個 ingredient 同樣提供 nameEn；steps 係中文步驟，同時提供 stepsEn（英文步驟，每一步對應）。
{"replyText":"...","recipes":[{"name":"...","nameEn":"...","cookTime":30,"servings":4,"difficulty":"簡單","description":"...","ingredients":[{"name":"...","nameEn":"...","quantity":"...","unit":"..."}],"steps":["..."],"stepsEn":["..."]}]}

**如果用戶純粹傾偈**（例如「hi」、「多謝」、「你好」）：
用正常文字回覆，唔好加 JSON。

**如果用戶問烹飪技巧**（例如「煎牛扒幾耐」、「點樣蒸魚」）：
用正常文字回答，可以不加 JSON。`;
  
  if (libSummary) {
    modeSection += `\n\n（用戶食譜庫參考：${libSummary}）`;
  }
  
  if (soupIntent) {
    modeSection += `\n\n🍲 湯水請在 JSON 中標示湯類型、功效、水量。`;
  }

  // 回覆語言：非中文裝置 → 對話文字用該語言（食譜內容仍 name 中文 + nameEn 英文）
  if (lang && lang !== "zh-TW") {
    const langName = lang === "en" ? "English" : lang === "fil" ? "Filipino (Tagalog)" : lang === "id" ? "Indonesian" : "English";
    modeSection += `\n\n【回覆語言】請用 ${langName} 撰寫所有對話文字（replyText 及一般回覆）。食譜內容：name 欄用繁體中文、nameEn 用英文、steps 用中文、stepsEn 用英文。`;
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
  return /(湯水|老火湯|滾湯|燉湯|煲湯|湯|湯品|soup|tonic|3\s*餸\s*1\s*湯|3\s*菜\s*1\s*湯|三餸一湯|三菜一湯|3 餸 1 湯|3 菜 1 湯|今晚食咩|晚餐推薦)/i.test(text);
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

⚠️【AI Chef 智能生成與追問規則】（最高優先級）

1. 互動模式與零追問機制：
   - 點擊 UI 按鈕（如「AI 生成」、「食譜庫」）：禁止任何追問，100% 立即輸出 JSON 食譜卡。
   - 完整請求（帶動作/情境/組合/時間，例如：「今晚食咩」、「整個湯」、「3 餸 1 湯」、「30 分鐘搞定」）：100% 立即輸出 JSON 食譜卡。
   - 極簡關鍵字（≤ 3 字且無脈絡，例如：「湯」、「雞」、「湯水」、「快手」）：允許簡短詢問 1 次（人數/口味）；若使用者下一句未補全或要求直接生成，立即套用預設值輸出 JSON 食譜卡。

2. 預設值與情境動態覆寫 (Scenario Overrides)：
   - 標準預設：4 人份 | 清淡 | 簡單~中等 | 30-60 分鐘
   - 情境覆寫：
     * 「情侶 / 二人世界」 -> 2 人份 | 浪漫精緻 | 中等難度
     * 「減肥 / 瘦身 / 減脂 / 健身」 -> 2 人份 | 高蛋白低卡 | 簡單快手
     * 「小朋友 / 寶寶」 -> 2 人份 | 清淡不辣 | 簡單安全
     * 「宴客 / 聚會 / 招待」 -> 6 人份 | 賣相大氣精緻 | 簡單~中等（優先推薦可提前準備、蒸烤或冷盤類料理）

3. 經典款食譜：
   - 允許經典家常菜與湯水重複出現，以實用度與常見度優先。

4. 兜底提示：
   - 使用預設值出卡時，於文末附帶一行友善提示：「已為你提供標準預設食譜。如需調整人數、口味或忌口，隨時告訴我！」

5. If user input is ambiguous and no further parameters provided within one turn, you can either ask a follow-up question OR generate a recipe with default standard values. Prefer generating recipes when user seems to want food recommendations.

⚠️【JSON 輸出規則】
- 如果用戶想食譜/問今晚食咩/提及食材菜式：必須用 JSON 格式返回食譜，包含 replyText 同 recipes
- 如果用戶純粹傾偈（例如「hi」、「多謝」、「早晨」）：正常文字回覆，唔好加 JSON
- 如果用戶問烹飪問題（例如「煎牛扒幾耐」、「點樣蒸魚」）：可以純文字回答，唔需要食譜格式
- 如果用戶表達想食嘢但冇指定菜式：返回 JSON 格式，包含 1 個食譜建議（除非用戶明確要求「3 餸 1 湯」先出 4 個）

⚠️ 重要規則：
1. 當你無法辨識食材、用戶問題唔係問食譜、或者未能提供完整食譜時，請用**對話式回覆**，**切勿**使用「食譜一：類別 —— 名稱」格式
2. 只有真係推薦可煮食譜時，先使用食譜格式同輸出 \`---next-steps---\`
3. 優先使用 searchRecipes 搵用戶已有嘅官方 / 自訂食譜，搵唔到啱先 AI 生成新食譜
4. 當用戶影雪櫃相或問「我有呢啲食材可以煮咩」，先 call getPantryItems 了解庫存，再 call searchRecipes 搵現有食譜
5. 當用戶要求「加入排餐」時，請以食譜格式輸出完整食譜，然後提示用戶直接㩒呢度推薦卡片上嘅「加排餐」掣（唔係叫用戶去排餐頁）
6. ⚠️ 你**冇任何**「加入排餐／加入購物清單／收藏食譜／寫入庫」嘅工具。當用戶要求「加入排餐」「加入購物清單」「收藏」，你**唔可以**話「已幫你加入」「搞掂」「完成」，亦**絕對唔可以**叫用戶「去排餐頁／餐牌頁／購物頁／食譜庫手動加入」。正確做法：如果上面已經推薦咗食譜，話「你㩒上面卡片上嘅『加排餐』／『加入購物清單』／『收藏』掣就可以」；如果未推薦任何食譜，請先按格式推薦完整食譜，再提示用戶直接㩒呢度卡片上嘅掣操作。若同時唔想加入，可用對話式回覆引導

每次回覆煮食建議或食譜推薦時，**必須用 JSON 格式輸出**（包含 replyText + recipes）。如果只係回答烹飪問題、純傾偈或技巧查詢，可以用對話式文字。

請每次都提供不同的食譜建議，考慮不同菜系（中菜、西餐、日式、韓式、東南亞等）、不同蛋白質（雞、豬、牛、魚、蝦、豆腐等）、不同煮法（炒、蒸、炆、焗、燉、煲湯等）、不同季節食材，確保每次推薦都有新鮮感。

⚠️ 新鮮感但唔好太難：所謂「新鮮感」係指未煮過嘅家常菜，或者用返平日常見食材但換個新煮法。**嚴禁**推出需要特殊工具、罕見/難買食材、或者步驟極度複雜嘅菜式。保持喺「香港家庭日常可煮」嘅難度範圍內（避免慢火濃縮、低溫慢煮、分子料理、異國稀有食材等）。

⚠️【JSON 格式要求】食譜必須完整，唔好截斷：
{"replyText":"...","recipes":[{"name":"...","nameEn":"...","cookTime":30,"servings":4,"difficulty":"簡單","description":"...","ingredients":[{"name":"...","nameEn":"...","quantity":"...","unit":"..."}],"steps":["..."],"stepsEn":["..."]}]}

⚠️【3 餸 1 湯】強制規則：當用戶請求「3 餸 1 湯」「三餸一湯」「3 菜 1 湯」「今晚食咩」時，你**必須生成剛好 4 個食譜**（唔可以係 3 個或 5 個）：
- 食譜一：肉類主菜（如豬/牛/雞）
- 食譜二：海鮮/其他蛋白（如魚/蝦/豆腐/蛋）
- 食譜三：蔬菜/小炒
- 食譜四：湯水（必須有湯類型、功效、水量）
除咗 3 餸 1 湯，其他情況一律只輸出 **1 個食譜**。

規則：
- 繁體中文，親切語氣
- 每個食譜必須有 4-6 個步驟，步驟要具體（動作、火力、時間）
- 每次推薦不同菜系、不同蛋白質、不同季節食材
- 用戶發送圖片時，幫佢睇圖入面有咩食材或菜式
- 必須輸出**完整 JSON**，唔好省略任何欄位，唔好喺中途截斷`;

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
  const normalizedText = String(text ?? "")
    .replace(/```(?:json|markdown|text)?/gi, "")
    .replace(/```/g, "")
    .replace(/\r\n/g, "\n")
    .trim();

  // Match recipe headers: 食譜一：類別 —— 名稱（約XX分鐘）
  // Also supports: 食譜1、食譜 1、食譜 一、1. 名稱（約XX分鐘）
  let recipeBlocks = normalizedText.split(/(?=食譜\s*[一二三四五六七八九十\d]+[：:\s])/);
  // 若完全搵唔到「食譜X」header，改用 --- 或空行做分隔嘅兜底
  if (recipeBlocks.length <= 1) {
    recipeBlocks = normalizedText.split(/\n?\s*---\s*\n?/).filter(Boolean);
  }
  if (recipeBlocks.length <= 1) {
    recipeBlocks = normalizedText.split(/(?=^#{1,3}\s*)/gm).filter(Boolean);
  }
  if (recipeBlocks.length <= 1) {
    recipeBlocks = normalizedText.split(/(?=^(?:第?\s*[一二三四五六七八九十\d]+[.、．:：]|食譜))/gm);
  }
  
  for (const block of recipeBlocks) {
    // Try to parse header
    const headerMatch = block.match(
      /^(?:#{1,3}\s*)?(?:食譜\s*[一二三四五六七八九十\d]+|[一二三四五六七八九十\d]+[.、．])?\s*[：:]?\s*(.+?)\s*(?:——|—|--|-)\s*(.+?)(?:[（(]約?\s*(\d+)\s*分鐘[）)])?(?:\n|$)/
    );
    let category = "家常菜";
    let name = "";
    let cookTime = 30;
    if (headerMatch) {
      category = headerMatch[1].trim() || category;
      name = headerMatch[2].replace(/^[—\-]+\s*/, "").trim();
      cookTime = headerMatch[3] ? parseInt(headerMatch[3], 10) : 30;
    } else {
      const firstLine = block.split("\n").find((l) => l.trim())?.replace(/^#{1,3}\s*/, "").trim() || "";
      const titleLine = firstLine.replace(/^食譜\s*[一二三四五六七八九十\d]+\s*[：:]\s*/, "").trim();
      const timeMatch = titleLine.match(/(?:約|大約)?\s*(\d+)\s*分鐘/);
      if (timeMatch) cookTime = parseInt(timeMatch[1], 10);
      const dashParts = titleLine.split(/\s*(?:——|—|--|-)\s*/).filter(Boolean);
      if (dashParts.length >= 2) {
        category = dashParts[0].trim() || category;
        name = dashParts.slice(1).join(" - ").trim();
      } else {
        const colonParts = titleLine.split(/\s*[：:]\s*/).filter(Boolean);
        if (colonParts.length >= 2) {
          category = colonParts[0].trim() || category;
          name = colonParts.slice(1).join("：").trim();
        } else {
          name = titleLine;
        }
      }
    }
    
    if (!name || name.length < 2) continue;
    
    // Parse ingredients section
    const ingredients: SuggestedRecipe["ingredients"] = [];
    // 放寬：接受 🛒 食材 / 食材 / 材料 / 原料 / Ingredients 前綴（有冇 emoji 都得）
    const ingSection = block.match(/(?:🛒\s*)?(?:食材|材料|原料|Ingredients?|配料)[：:]?([\s\S]*?)(?=(?:🍳\s*)?(?:步驟|做法|方法|Instructions?|流程|程序)|---|$)/i);
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
    const stepsSection = block.match(/(?:🍳\s*)?(?:步驟|做法|方法|Instructions?|流程|程序)[：:]?([\s\S]*?)(?=---|$)/i);
    if (stepsSection) {
      const stepLines = stepsSection[1].split("\n").filter(l => l.trim());
      for (const line of stepLines) {
        // Match: 1. 步驟標題（第 X-Y 分鐘）：詳細描述
        const stepMatch = line.match(/^(?:\d+[.、．)]\s*)?(.+)/);
        if (stepMatch?.[1]?.trim()) steps.push(stepMatch[1].trim());
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
  enableSearch?: boolean,
  forceJson = false
): Promise<{ finalContent: string; allMessages: Message[] }> {
  const db = await getDb();
  const MAX_ITER = 3;

  for (let i = 0; i < MAX_ITER; i++) {
    let llmResp;
    try {
      llmResp = await invokeLLM({
        messages,
        maxTokens: AI_RECIPE_MAX_TOKENS,
        temperature: 0.5,
        timeoutMs: AI_RECIPE_LLM_TIMEOUT_MS,
        enableSearch: enableSearch ?? true,
        tools: enableSearch && i === 0 ? TOOLS as any : undefined,
        responseFormat: forceJson ? { type: "json_object" } : undefined,
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
  mode: "chat" | "ai" | "library" = "chat",
  excludeNames: string[] = [],
  search?: { query?: string; tags?: string[]; cookTimeMax?: number; category?: string; count?: number; rank?: "shortestTime" | "default"; excludeCategories?: string[] },
  lang: string = "zh-TW"
): Promise<{ content: string; recipes: SuggestedRecipe[]; llmUsed: boolean }> {
  // llmUsed: 呢次請求有冇真係 call 過 LLM（router 用嚟扣 quota —— 純食譜庫唔扣）
  let llmUsed = false;
  // Fix2: 合併後端自己記住嘅已推薦名單（唔靠前端 state），確保去重一定生效
  const seenFromCache = await getFamilySeenNames(familyId);
  const mergedExclude = [...new Set([...excludeNames, ...seenFromCache])];
  // 參考「熱門」風格 + 唔重複：攞近期熱門菜名，加入 exclude（AI 唔會出返呢啲），
  // 並生成一段「流行風格」hint 注入 prompt，令 AI 生成偏向多人食嘅家常菜（似 Gemini AI Overview）。
  let popularHint = "";
  try {
    const trending = await getTrendingRecipes(7, 15);
    if (trending.length > 0) {
      const trendingNames = trending.map(t => t.recipeName).filter(Boolean);
      // 熱門菜名加入 exclude → AI 唔會出返（微調生成新版本，唔重複）
      mergedExclude.push(...trendingNames);
      popularHint = `參考以下近期人氣/熱門家常菜嘅風格（但唔好直接出返呢啲名，要微調生成全新、唔重複嘅版本）：${trendingNames.slice(0, 8).join("、")}`;
    }
  } catch (e) {
    console.warn("[AI Chef] trending fetch failed:", (e as Error)?.message);
  }
  const textOf = (m: any): string =>
    typeof m?.content === "string"
      ? m.content
      : Array.isArray(m?.content)
        ? m.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ")
        : "";
  const lastUserMsg = inputMessages.filter(m => m.role === "user").pop();
  const lastUserText = textOf(lastUserMsg).trim();
  const lastUserLower = lastUserText.toLowerCase();
  // 淨係睇「最後一條 user 訊息」有冇圖片（唔睇成個 history，避免影相後所有 call 都被誤判）
  const hasImage = Array.isArray(lastUserMsg?.content) && lastUserMsg.content.some((c: any) => c.type === "image_url");

  const greetingPattern = /^(hi|hello|hey|yo|你好|您好|早安|早晨|午安|晚安|多謝|謝謝|唔該|thanks|thank you|thx|hihi|早晨好|早晨！|hello!|hi!|嗨)$/i;
  const isGreeting = greetingPattern.test(lastUserLower);
  // 技巧／知識題：純文字答，唔出食譜卡
  const isTechnique = !isGreeting && lastUserText.length < 80 &&
    /(幾耐|點樣|如何|怎樣|秘訣|技巧|點解|溫度|幾多度|要幾耐|幾多分鐘|點先|點至|how\s*(long|to|many)|temperature|煮幾耐|蒸幾耐|焗幾耐|煎幾耐|煲幾耐)/i.test(lastUserText);
  const isPlain = isGreeting || isTechnique; // 純對話/技巧題：文字答，唔出卡
  const forceNoCards = isPlain || hasImage;  // 圖片辨識：只返回文字（前端自己拆食材）

  const db = await getDb();

  // ── 本機 helpers ─────────────────────────────────────────────
  const trySearch = async (query: string, limit = 24, cookTimeMax?: number): Promise<Record<string, unknown>[]> => {
    if (!db) return [];
    try {
      const res = await withTimeout(execSearchRecipes(db, { query, limit, cookTimeMax }, familyId), 8000, "lib search");
      return (res.recipes || []) as Record<string, unknown>[];
    } catch (e) {
      console.warn("[AI Chef] lib search failed:", e);
      return [];
    }
  };

  const shuffleArr = <T,>(a: T[]): T[] => {
    const c = [...a];
    for (let i = c.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [c[i], c[j]] = [c[j], c[i]];
    }
    return c;
  };

  // 將 DB search rows 轉成正確 SuggestedRecipe（source 由 r.source 決定，官方=official）
  const rowsToSuggested = (rows: Record<string, unknown>[], exclude: string[], count: number): SuggestedRecipe[] => {
    const excluded = new Set(exclude.map(normalizeName).filter(Boolean));
    const fresh: SuggestedRecipe[] = [];
    const reused: SuggestedRecipe[] = [];
    for (const r of rows) {
      const name = String(r?.name ?? "").trim();
      if (!name || name.length < 2) continue;
      const steps = (Array.isArray(r?.steps) ? r.steps : [])
        .map((s: any) => typeof s === "string" ? s : String(s?.instruction ?? s?.text ?? s ?? ""))
        .map((t: string) => t.trim()).filter(Boolean);
      if (steps.length === 0) continue;
      const official = r.source === "official";
      const rec: SuggestedRecipe = {
        name,
        description: String(r?.description ?? "").trim(),
        cookTime: Number(r?.cookTime ?? 30) || 30,
        servings: Number(r?.servings ?? 4) || 4,
        difficulty: (String(r?.difficulty ?? "medium")) as "easy" | "medium" | "hard",
        ingredients: (Array.isArray(r?.ingredients) ? r.ingredients : []).map((i: any) => ({
          name: String(i?.name ?? "").trim(),
          quantity: String(i?.quantity ?? "").trim(),
          unit: String(i?.unit ?? "").trim(),
        })).filter(x => x.name),
        steps,
        tags: Array.isArray(r?.tags) ? r.tags.map(String) : [],
        source: official ? "official" : "custom",
        officialId: official ? Number(r.id) : undefined,
        customId: !official ? Number(r.id) : undefined,
        thumbnailUrl: String((r as any)?.thumbnailUrl ?? "").trim() || undefined,
        image: String((r as any)?.image ?? "").trim() || undefined,
        dishType: String((r as any)?.dishType ?? "").trim() || undefined,
        soupType: (r as any).soupType || undefined,
        benefits: (r as any).benefits || undefined,
        waterVolume: (r as any).waterVolume || undefined,
      };
      (excluded.has(normalizeName(name)) ? reused : fresh).push(rec);
    }
    // 優先非排除，池盡先翻兜（永遠有卡）
    return [...shuffleArr(fresh), ...shuffleArr(reused)].slice(0, count);
  };

// 由句子抽 keyword（剷走口語填充字＋數字）；抽唔到 → 空 = 用 generic 池
  const cleanFoodQuery = (raw: string): string => {
    const q = raw
      .replace(/[。，、！？!?.,;；：:…\s]+/g, " ")
.replace(/[0-9]+/g, " ")
      .replace(/(我|我想|想要|要|嚟|幫我|請|希望|可以|可否|推薦|推介|介紹|提供|搵|選|選擇|整個|煮個|煮|整|食譜庫|唔同|唔該|今晚|今日|早餐|午餐|晚餐|宵夜|有咩|有乜|咩|乜|乜嘢|咩嘢|嗎|呢|呀|啊|喔|哦|啦|喎|please|give|me|some|for|tonight|dinner|lunch|breakfast|today|recommend|suggest|suggestion|recipes|food|what|to|eat|cook|make|want|i|和|同|同埋|又|仲有|還有|或者|定係|邊個|邊種|好唔好|想|要|嚟)/gi, " ")
      .trim();
    return q.length >= 2 ? q : "";
  };

  // ══════════ mode === "library"：快路徑（3餸1湯 → 1湯3餸 + AI補；一般 → 1 個）══════════
  if (mode === "library") {
    const isMealLib = /3\s*餸\s*1\s*湯|4\s*個唔同嘅食譜|肉\/海鮮\/蔬菜\/湯/.test(lastUserText);
    const rows = await trySearch("", 1000);

    if (isMealLib) {
      // 1) 先從庫揀 1 湯 + 3 餸（可能少過 4）
      const libPicked = pickSoupMeal(rows, mergedExclude);
      const libNames = libPicked.map(r => r.name);
      await recordFamilySeenNames(familyId, libNames);
      // 2) 唔夠 4 個 → 按「缺失類別」逐類 AI 補缺（保證 1肉+1海鮮+1菜+1湯）
      if (libPicked.length < 4) {
        const missing = 4 - libPicked.length;
        const haveTypes = new Set(libPicked.map(mealTypeOf));
        const neededTypes = (["soup", "meat", "seafood", "vegetable"] as DishType[]).filter(t => !haveTypes.has(t)).slice(0, missing);
        const aiPicked = await generateMissingRecipes(neededTypes.length, false, [...mergedExclude, ...libNames], familyId, userId, neededTypes);
        if (aiPicked.length > 0) llmUsed = true;
        await recordFamilySeenNames(familyId, aiPicked.map(r => r.name));
        const all = [...libPicked, ...aiPicked].slice(0, 4);
        console.log(`[AI Chef] library meal: ${libPicked.length} lib + ${aiPicked.length} ai`);
        return { content: `我喺食譜庫搵到 ${libPicked.length} 個 + AI 幫你補 ${aiPicked.length} 個：`, recipes: all, llmUsed };
      }
      console.log(`[AI Chef] library meal: ${libPicked.length} lib`);
      return { content: `我喺食譜庫搵到呢套 3 餸 1 湯：`, recipes: libPicked, llmUsed };
    }

    // 單卡：支援「庫內搜尋：X」marker（前端「換」用，指定類別換同類），亦支援結構化 search（hotkey/pantry 用）
    // 注意：要停喺「；」（同類別 marker）之前，否則會連「；同類別：meat」一齊食入 keyword → 搜唔到 → fallback AI
    const swapQuery = (lastUserText.match(/庫內搜尋：([^\n。；]+)/)?.[1] || "").trim();
    let picked: SuggestedRecipe[] = [];
    if (search) {
      // 結構化搜尋（hotkey / pantry）：execSearchRecipes 支援 tags/cookTimeMax，行 7 日去重 + fresh 優先
      const searchCount = search.count ?? 1;
      let searchRows: Record<string, unknown>[] = [];
      if (db) {
        try {
          const res = await withTimeout(
            execSearchRecipes(db, {
              query: search.query ?? "",
              category: search.category,
              tags: search.tags,
              cookTimeMax: search.cookTimeMax,
              excludeCategories: search.excludeCategories,
              limit: 30,
            }, familyId),
            8000, "lib search"
          );
          searchRows = (res.recipes || []) as Record<string, unknown>[];
        } catch (e) {
          console.warn("[AI Chef] structured lib search failed:", e);
        }
      }
      picked = rowsToSuggested(applySearchFilters(searchRows, search), mergedExclude, searchCount);
      if (search.rank === "shortestTime" && picked.length > 1) {
        picked = [...picked].sort((a, b) => (a.cookTime || 999) - (b.cookTime || 999));
      }
      if (picked.length > 0) {
        console.log(`[AI Chef] library structured: ${picked.length} recipes (${search.query || search.tags?.join("、") || "generic"})`);
        await recordFamilySeenNames(familyId, picked.map(r => r.name));
        const content = search.tags?.join("、") || search.query
          ? `我喺食譜庫搵到呢個配合「${search.tags?.join("、") || search.query}」嘅食譜：`
          : `我喺食譜庫搵到呢個食譜：`;
        return { content, recipes: picked, llmUsed };
      }
      // 結構化搜尋 0 結果 → 用「已過濾」嘅 generic 池補（確保時間/類別一致，唔會出 90 分鐘湯/甜品/飲品）
      const filteredRows = applySearchFilters(rows, search);
      picked = rowsToSuggested(filteredRows, mergedExclude, searchCount);
      if (search.rank === "shortestTime" && picked.length > 1) {
        picked = [...picked].sort((a, b) => (a.cookTime || 999) - (b.cookTime || 999));
      }
      if (picked.length > 0) {
        console.log(`[AI Chef] library structured fallback: ${picked.length} recipes (${search.query || search.tags?.join("、") || "generic"})`);
        await recordFamilySeenNames(familyId, picked.map(r => r.name));
        return { content: `我喺食譜庫搵到呢個食譜：`, recipes: picked, llmUsed };
      }
    } else if (swapQuery) {
      const singleRows = await trySearch(swapQuery, 30);
      // 換卡：用「前端傳嚟嘅 exclude」做去重（現卡 + 已換過），而唔係加埋 7 日 seen——
      // 否則類別 pool 被 7 日去重過度收窄，第二次撳換就搜唔到 → 誤 fallback AI。
      const swapExclude = [...new Set(excludeNames)];
      let picked = rowsToSuggested(singleRows, swapExclude, 6);
      if (picked.length > 1) {
        // 名直接含 swapQuery 嘅排最前（換湯先至係真湯），fresh 優先次序保留喺第二層
        picked = [...picked].sort((a, b) => (b.name.includes(swapQuery) ? 1 : 0) - (a.name.includes(swapQuery) ? 1 : 0));
      }
      // 強制「同 dishType 替換」（前端 marker「同類別：meat/soup/...」）—— 湯卡換湯、肉卡換肉
      const swapDishType = (lastUserText.match(/同類別：([a-z]+)/)?.[1] || "").trim();
      if (swapDishType) {
        const filtered = picked.filter(r => classifyDishType({ name: r.name, tags: r.tags, dishType: r.dishType, soupType: r.soupType } as unknown as Record<string, unknown>) === swapDishType);
        picked = filtered;
      }
      // 食譜庫換 = 純食譜庫：唔用 AI 生成、唔落 generic 池（避免換錯類 / 變 AI 卡）。
      // 搵唔到同類 → 返回空，由前端決定 repeat 定轉 AI。
      if (picked.length > 0) {
        console.log(`[AI Chef] library mode: ${picked.length} recipes (swapQuery="${swapQuery}" dishType="${swapDishType}")`);
        await recordFamilySeenNames(familyId, [picked[0].name]);
        if (swapDishType) {
          const sameType = picked.filter(r => classifyDishType({ name: r.name, tags: r.tags, dishType: r.dishType, soupType: r.soupType } as unknown as Record<string, unknown>) === swapDishType);
          if (sameType.length > 0) picked = sameType;
        }
        return { content: `我從食譜庫搵到呢個食譜：`, recipes: picked.slice(0, 3), llmUsed };
      }
    } else {
      picked = rowsToSuggested(rows, mergedExclude, 1);
      if (picked.length > 0) {
        console.log(`[AI Chef] library mode: ${picked.length} recipes`);
        await recordFamilySeenNames(familyId, [picked[0].name]);
        return { content: `我從食譜庫搵到呢個食譜：`, recipes: picked, llmUsed };
      }
    }
    return { content: "食譜庫暫時未有合適食譜，可以試吓按「AI 生成」幫你創作新菜式。", recipes: [], llmUsed };
  }

  // ══════════ chat 非圖片：先試食譜庫（library-first）══════════
  const keyword = cleanFoodQuery(lastUserText);
  const isVague = !keyword; // 抽唔到關鍵字 = 模糊想食
  if (mode === "chat" && !isPlain && !hasImage) {
    // 打字「N分鐘」都尊重時間：由 raw text 抽 cookTimeMax（cleanFoodQuery 會剷走數字，所以要喺 raw 度抽）
    const chatTimeMatch = lastUserText.match(/(\d{1,3})\s*分鐘/);
    const chatCookTimeMax = chatTimeMatch ? parseInt(chatTimeMatch[1], 10) : undefined;
    const rows = keyword ? await trySearch(keyword, 30, chatCookTimeMax) : await trySearch("", 1000, chatCookTimeMax);
    const picked = rowsToSuggested(rows, mergedExclude, 1);
    if (picked.length > 0) {
      console.log(`[AI Chef] library-first: ${picked.length} for "${keyword || "(generic)"}"`);
      await recordFamilySeenNames(familyId, picked.map(r => r.name));
      return {
        content: keyword
          ? `我喺食譜庫搵到呢個「${keyword}」相關食譜：`
          : `我喺食譜庫搵到呢個食譜：`,
        recipes: picked,
        llmUsed,
      };
    }
    console.log(`[AI Chef] library-first: 0 results for "${keyword || "(generic)"}" -> LLM`);
  }

  // ══════════ LLM 路徑（greeting/technique/ai mode/library 0 結果）══════════
  const resolvedMsgs = await withTimeout(
    resolveImageUrls(inputMessages),
    AI_RECIPE_CONTEXT_TIMEOUT_MS,
    "resolve image urls"
  ).catch((err) => {
    console.warn("[AI Chef] resolveImageUrls timeout/failure:", err);
    return inputMessages;
  });

  const llmMsgs = toLLMMessages(resolvedMsgs);
  const soupIntent = detectSoupIntent(llmMsgs);

  // Auto-search library for context
  const ctxQuery = extractSearchQuery(llmMsgs) || keyword;
  let libSummary = "";
  let libResults: Record<string, unknown>[] = [];
  if (db) {
    try {
      const searchResult = await withTimeout(
        execSearchRecipes(db, { query: ctxQuery, limit: 15 }, familyId),
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

  let systemPrompt = buildSystemPrompt(libSummary, soupIntent, lang);
  if (popularHint) systemPrompt += `\n\n${popularHint}`;
  // 純對話（greeting/technique/圖片）-> 強調唔好出食譜 JSON
  if (isPlain) {
    systemPrompt += "\n\n（本輪為純對話/技巧查詢：請用正常文字親切回覆，不要輸出 JSON，也不要附食譜。）";
  } else if (mergedExclude.length > 0) {
    systemPrompt += `\n\n⚠️ 絕對唔可以推薦以下用戶最近睇過嘅菜式，諗一啲全新嘅：${mergedExclude.slice(0, 10).join("、")}`;
  }
  // 單菜 AI 生成（非 3餸1湯）：明確只出 1 個，避免 LLM 浪費 tokens 喺多餘菜式（同時令生成更快）
  if (mode === "ai" && !soupIntent && !isPlain) {
    systemPrompt += "\n\n（本輪係單一食譜請求：recipes array 只需包含 1 個食譜，唔好出多個。）";
  }

  // Fix3: 將已睇過名單直接加入最後一條 user message，令 flash 直接睇到（比淨係 system prompt 更有效）
  const llmMsgsWithExclude = [...llmMsgs];
  if (!isPlain && mergedExclude.length > 0) {
    const lastIdx = llmMsgsWithExclude.length - 1;
    const last = llmMsgsWithExclude[lastIdx];
    if (last && last.role === "user") {
      const lastText = typeof last.content === "string" ? last.content : "";
      if (lastText) {
        llmMsgsWithExclude[lastIdx] = {
          ...last,
          content: `${lastText}\n\n（絕對唔可以重複以下已推薦過嘅菜式，必須揀全新嘅：${mergedExclude.slice(0, 10).join("、")}）`,
        };
      }
    }
  }

  const msgs: Message[] = [
    { role: "system", content: systemPrompt },
    ...llmMsgsWithExclude,
  ];

  const enableSearch = false; // 一律唔行 tools loop / web search：單輪 LLM，快靚正（library-first 已做查庫）
  // JSON mode：想食譜（非純對話/非圖片）→ 強制 LLM 輸出 JSON，避免 flash 出純文字導致 0 卡
  const wantCards = !isPlain && !hasImage;
  let finalContent = AI_RECIPE_FALLBACK_CONTENT;
  let allMessages = msgs;

  const callLLM = async (): Promise<boolean> => {
    llmUsed = true; // 有叫 LLM 就標記（即使 timeout 都計，因為有 call 過）
    try {
      ({ finalContent, allMessages } = await withTimeout(
        runToolsLoop(msgs, familyId, userId, enableSearch, wantCards),
        mode === "ai" ? 35000 : AI_RECIPE_CHAT_TIMEOUT_MS,
        "ai chef chat",
      ));
      return true;
    } catch (e) {
      console.warn("[AI Chef] chat timed out or failed:", e);
      return false;
    }
  };

  // 3餸1湯 AI 生成：並行 4 個獨立 call（1 湯 + 3 餸），每個 ~8-10s，總時間 ~10s
  let usedParallel = false;
  let parallelContent = "";
  let parallelRecipes: SuggestedRecipe[] = [];
  if (soupIntent && mode === "ai" && wantCards) {
    const mealRecipes = await generateMealRecipesParallel(mergedExclude, familyId, userId);
    if (mealRecipes.length > 0) {
      usedParallel = true;
      llmUsed = true; // 並行 meal 每個 item 都係 LLM call
      parallelContent = "我幫你諗好咗今晚 3 餸 1 湯：";
      parallelRecipes = mealRecipes;
      console.log(`[AI Chef] Parallel meal generated: ${mealRecipes.length} recipes`);
    } else {
      // 並行失敗 → 落返單輪 LLM
      if (!(await callLLM())) {
        return { content: "暫時未能推薦，請再試", recipes: [], llmUsed };
      }
    }
  } else {
    if (!(await callLLM())) {
      return { content: "暫時未能推薦，請再試", recipes: [], llmUsed };
    }
  }

  // Parse LLM response to extract content and recipes
  let parsed = parseRecipeWithFallback(finalContent);
  let content = parsed.content;
  let recipes = parsed.recipes;

  // 並行 3餸1湯：直接採用並行結果（唔再經 parse，避免 SuggestedRecipe 唔合 schema 導致 0 卡再 retry）
  if (usedParallel && parallelRecipes.length > 0) {
    content = parallelContent;
    recipes = parallelRecipes;
  } else if (wantCards && recipes.length === 0) {
    console.warn("[AI Chef] 0 recipes parsed, retrying LLM once with JSON mode...");
    llmUsed = true; // retry 都係 LLM call
    try {
      const retried = await retryLLMJson(msgs, familyId, userId);
      const retryParsed = parseRecipeWithFallback(retried);
      if (retryParsed.recipes.length > 0) {
        content = retryParsed.content;
        recipes = retryParsed.recipes;
        console.log(`[AI Chef] Retry succeeded: ${recipes.length} recipes`);
      }
    } catch (e) {
      console.warn("[AI Chef] Retry failed:", e);
    }
  }

  // 純對話（greeting/technique）-> 一定唔可以有卡
  if (forceNoCards) {
    recipes = [];
  } else {
    // 撳 AI（mode="ai"/chat）→ 一律保持 source="ai"（AI 生成），唔會因為個名 match 到食譜庫就 relabel 做食譜庫
    // （mode="library" 已經喺上面快路徑 return 咗；淨係 AI/chat 會到呢度）
    for (const r of recipes) {
      r.source = "ai";
      delete r.officialId;
      delete r.customId;
    }
    // 3餸1湯 AI：由並行候選池揀「每類型各一」（跳過 hard mergedExclude filter，改由「新鮮優先」處理，
    // 保證唔會成個類型被刪走；缺類型由下面 meal backfill 針對缺失類別補返）
    if (soupIntent && usedParallel) {
      recipes = pickDiverseMeal(recipes, mergedExclude);
      console.log(`[AI Chef] Parallel candidates picked diverse: ${recipes.length}`);
    } else if (mergedExclude.length > 0 && recipes.length > 0) {
      // 其他（單菜 AI / chat）：保留 hard mergedExclude filter
      const excluded = mergedExclude.map(normalizeName).filter(Boolean);
      recipes = recipes.filter(r => {
        const n = normalizeName(r.name);
        return !excluded.some(e => e && (e === n || nameSimilarity(e, n) >= 0.6));
      });
    }
    for (const r of recipes) {
      if (!r.source || r.source === "ai") r.source = "ai";
    }
    // 單菜 AI 生成（非 3餸1湯）：強制 1 卡（LLM 有時會出 2-3 個，前端「AI 生成」期望 1 個）
    if (!soupIntent && mode === "ai" && recipes.length > 1) {
      recipes = recipes.slice(0, 1);
      console.log(`[AI Chef] Single AI forced to 1 card`);
    }

    // 純文字抽卡：LLM 出咗純文字描述（冇 JSON）但內容有 **菜名** → 抽菜名去食譜庫 match，出真卡
    if (recipes.length === 0 && db && content) {
      const boldName = extractBoldRecipeName(content);
      if (boldName) {
        console.log(`[AI Chef] Extracted recipe name from text: "${boldName}"`);
        const matchRows = await trySearch(boldName, 10);
        let matched = rowsToSuggested(matchRows, mergedExclude, 1);
        // 揀同抽到嘅名最相近嘅（唔係 random）
        const bySim = matchRows
          .map((r: any) => ({ r, sim: recipeNameSimilarity(normalizeName(String(r.name ?? "")), normalizeName(boldName)) }))
          .filter(x => x.sim >= 0.3)
          .sort((a, b) => b.sim - a.sim);
        if (bySim.length > 0) {
          matched = rowsToSuggested(bySim.slice(0, 1).map(x => x.r), mergedExclude, 1);
        }
        if (matched.length > 0) {
          recipes = matched;
          content = `我喺食譜庫搵到「${matched[0].name}」呢個食譜：`;
          console.log(`[AI Chef] Text-card matched library: ${matched[0].name}`);
        }
      }
    }

    // 3餸1湯：hard filter 之後少過 4 卡 → AI 補返（補嗰啲都避開已睇過；按「缺失類別」逐類補，保證結構）
    // 用 retry loop：逐類補，邊類缺就補邊類，最多 retry 兩輪，保證「湯/肉/海鮮/菜」齊 4 卡
    if (soupIntent && recipes.length > 0 && recipes.length < 4) {
      for (let round = 0; round < 2; round++) {
        if (recipes.length >= 4) break;
        const haveTypes = new Set(recipes.map(mealTypeOf));
        const neededTypes = (["soup", "meat", "seafood", "vegetable"] as DishType[]).filter(t => !haveTypes.has(t));
        if (neededTypes.length === 0) break;
        const aiPicked = await generateMissingRecipes(
          neededTypes.length,
          false,
          [...mergedExclude, ...recipes.map(r => r.name)],
          familyId,
          userId,
          neededTypes
        );
        if (aiPicked.length > 0) {
          llmUsed = true;
          // 只補「缺嘅類別」（唔會重複類別）
          const haveNow = new Set(recipes.map(mealTypeOf));
          const fresh = aiPicked.filter(r => !haveNow.has(mealTypeOf(r)));
          recipes = [...recipes, ...fresh].slice(0, 4);
          console.log(`[AI Chef] Meal flow topped up round ${round + 1}: +${fresh.length} (total ${recipes.length})`);
        } else {
          break;
        }
      }
    }

    // 最後保證 4 卡：如果 AI 補缺都唔夠（某類 LLM 一直失敗），由食譜庫 pool 補返（快，唔等 LLM）——
    // 確保「湯/肉/海鮮/菜」齊 4 卡，唔會出「3 卡」。
    if (soupIntent && recipes.length > 0 && recipes.length < 4) {
      const haveTypes = new Set(recipes.map(mealTypeOf));
      const poolRows = await trySearch("", 1000);
      const poolCandidates = poolRows
        .map((r: any) => rowsToSuggested([r], mergedExclude, 1)[0])
        .filter((r: SuggestedRecipe | undefined): r is SuggestedRecipe => !!r)
        .filter((r) => !haveTypes.has(mealTypeOf(r)) && !["dessert", "drink"].includes(mealTypeOf(r)));
      for (const r of poolCandidates) {
        if (recipes.length >= 4) break;
        if (haveTypes.has(mealTypeOf(r))) continue;
        haveTypes.add(mealTypeOf(r));
        recipes = [...recipes, r];
        console.log(`[AI Chef] Meal library-pool filled: ${r.name} (${mealTypeOf(r)})`);
      }
    }
    // 具體指定菜式（例如番茄炒蛋）就唔好 random 呃人，出文字算
    const wantsFallbackCards = db && recipes.length === 0 && (mode === "ai" || isVague);
    if (wantsFallbackCards) {
      // 明確撳「AI 生成」（mode=ai，非模糊）：先叫 AI 重新諗一個全新菜（避免「AI 生成」跌去食譜庫）
      if (mode === "ai" && !isVague) {
        const freshAi = await generateMissingRecipes(1, false, mergedExclude, familyId, userId);
        if (freshAi.length > 0) {
          llmUsed = true;
          freshAi.forEach(r => { if (!r.source || r.source === "ai") r.source = "ai"; });
          recipes = freshAi;
          content = `我幫你諗咗個新菜式：`;
          console.log(`[AI Chef] AI fresh retry: ${freshAi[0].name}`);
        }
      }
      if (recipes.length === 0) {
        let fbRows = await trySearch(isVague ? "" : keyword || "", 30);
        let fb = rowsToSuggested(fbRows, mergedExclude, 1);
        if (fb.length === 0 && keyword) {
          // keyword 搜唔到合適替代 → fallback 去 generic pool，保證一定有卡（排除咗已睇過）
          const genRows = await trySearch("", 1000);
          fb = rowsToSuggested(genRows, mergedExclude, 1);
        }
        if (fb.length > 0) {
          recipes = fb;
          content = `我喺食譜庫搵到呢個食譜：`;
        }
      }
    }
  }

  if (recipes.length > 0) {
    console.log(`[AI Chef] Returning ${recipes.length} recipes`);
    // Fix2: 記低今次出咗嘅卡，之後自動排除（唔靠前端 state）
    await recordFamilySeenNames(familyId, recipes.map(r => r.name));
  }

  return { content, recipes, llmUsed };
}

// ─── Exported: streaming chat (yields text tokens, then recipes) ──

export async function* streamAIChefChat(
  inputMessages: Array<{ role: string; content: string | Array<TextContent | ImageContent> }>,
  familyId?: number,
  userId?: number
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

  // Auto-search library for context
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
  const systemPrompt = buildSystemPrompt(libSummary, soupIntent);
  const sysMsg: Message = { role: "system", content: systemPrompt };
  const msgs: Message[] = [sysMsg, ...toLLMMessages(resolvedMsgs)];

  const enableSearch = true;
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

  // Parse LLM response
  const lastAssistantMsg = allMessages.filter(m => m.role === "assistant").pop();
  let lastAssistantContent = typeof lastAssistantMsg?.content === "string" ? lastAssistantMsg.content : "";
  const { content, recipes: streamRecipes } = parseRecipeWithFallback(lastAssistantContent);
  lastAssistantContent = content;

  if (lastAssistantContent) {
    // Stream character by character for smooth UX
    for (let i = 0; i < lastAssistantContent.length; i += 50) {
      yield { type: "text", value: lastAssistantContent.slice(i, i + 50) };
    }
  }

  // Mark recipes as AI-generated
  for (const r of streamRecipes) {
    r.source = "ai";
  }
  
  yield { type: "recipes", value: streamRecipes };
  yield { type: "done" };
}

// ─── Router ──────────────────────────────────────────────

// AI Edit only produces the app's four content languages (zh / en / fil / id).
// Detect requests to switch to another language and fail fast with a friendly message.
const UNSUPPORTED_LANG_PATTERNS = [
  "泰文", "泰語", "thai", "日文", "日語", "japanese", "韓文", "韓語", "korean",
  "法文", "法語", "french", "德文", "德語", "german", "西班牙", "spanish",
  "越南", "vietnamese", "阿拉伯", "arabic", "俄文", "俄語", "russian",
  "意大利文", "義大利文", "italian", "葡萄牙", "portuguese", "印地", "hindi",
  "馬來", "malay", "緬甸", "泰國語言", "thailand language",
];

function assertSupportedEditLanguage(prompt: string) {
  const p = (prompt ?? "").toLowerCase();
  const wantsTranslate = /翻譯|translate|轉做|轉成|改成|變成|語言|language/.test(p);
  if (!wantsTranslate) return;
  const hit = UNSUPPORTED_LANG_PATTERNS.find((k) => p.includes(k.toLowerCase()));
  if (hit) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "AI 編輯暫時只支援中文、英文、菲律賓文及印尼文。",
    });
  }
}

// 共用 AI 編輯：用 editor prompt 產生完整新食譜 JSON（唔係 AI Chef 對話）
async function runAiEdit(
  input: { recipe: any; editPrompt: string },
  familyId: string | number,
  userId: string,
): Promise<z.infer<typeof aiEditOutputSchema>> {
  const systemPrompt = `你是一個專業食譜編輯助手。請根據原始食譜和修改要求，產生一個完整可儲存的新食譜。

要求：
1. 必須保留原食譜的核心風格，但要按修改要求調整
2. 主要文字使用繁體中文；同時為菜式名、簡介、每個步驟、每項食材提供英文（En）、菲律賓文（Fil）、印尼文（Id）譯文，翻譯要互相一致（同一食材喺名/步驟/食材清單用同一譯法）
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
    maxTokens: AI_EDIT_MAX_TOKENS,
    timeoutMs: AI_EDIT_LLM_TIMEOUT_MS,
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "ai_edit_recipe",
        strict: true,
        schema: {
          type: "object",
          properties: {
            name: { type: "string" },
            nameEn: { type: "string" },
            nameFil: { type: "string" },
            nameId: { type: "string" },
            description: { type: "string" },
            descriptionEn: { type: "string" },
            descriptionFil: { type: "string" },
            descriptionId: { type: "string" },
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
                  nameEn: { type: "string" },
                  nameFil: { type: "string" },
                  nameId: { type: "string" },
                  quantity: { type: "string" },
                  unit: { type: "string" },
                  category: { type: "string" },
                },
                required: ["name", "nameEn", "nameFil", "nameId"],
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
            stepsEn: {
              type: "array",
              items: {
                type: "object",
                properties: { instruction: { type: "string" }, tip: { type: "string" } },
                required: ["instruction"],
              },
            },
            stepsFil: {
              type: "array",
              items: {
                type: "object",
                properties: { instruction: { type: "string" }, tip: { type: "string" } },
                required: ["instruction"],
              },
            },
            stepsId: {
              type: "array",
              items: {
                type: "object",
                properties: { instruction: { type: "string" }, tip: { type: "string" } },
                required: ["instruction"],
              },
            },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["name", "nameEn", "nameFil", "nameId", "description", "descriptionEn", "descriptionFil", "descriptionId", "cookTime", "servings", "difficulty", "recipeCategory", "ingredients", "steps", "stepsEn", "stepsFil", "stepsId", "tags"],
        },
      },
    },
  });

  const rawContent = response.choices[0]?.message?.content;
  const parsedContent = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
  if (!parsedContent) throw new Error("AI returned empty response");

  // Robust parse: prefer the first complete JSON value (balanced-bracket scan),
  // then fall back to the legacy extract+repair path.
  let rawParsed: any = extractFirstJson<any>(parsedContent);
  if (!rawParsed) {
    const extracted = extractJSON(parsedContent);
    const repaired = repairJSON(JSON.stringify(extracted));
    try {
      rawParsed = JSON.parse(repaired);
    } catch {
      rawParsed = extracted;
    }
  }
  const parsed = aiEditOutputSchema.parse(rawParsed);
  
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

  // Fallback: if the edit call did not return translations (or returned a
  // misaligned step count), backfill name + steps via the shared translator.
  const stepTexts = (parsed.steps ?? []).map((s: any) => String(s?.instruction ?? "")).filter(Boolean);
  const enOk = (parsed.stepsEn?.length ?? 0) === stepTexts.length;
  const filOk = (parsed.stepsFil?.length ?? 0) === stepTexts.length;
  const idOk = (parsed.stepsId?.length ?? 0) === stepTexts.length;
  if (!parsed.nameEn || !parsed.nameFil || !parsed.nameId || !parsed.descriptionEn || !enOk || !filOk || !idOk) {
    try {
      const tr = await translateRecipeContent(parsed.name, stepTexts, parsed.description ?? "");
      if (!parsed.nameEn && tr.nameEn) parsed.nameEn = tr.nameEn;
      if (!parsed.nameFil && tr.nameFil) parsed.nameFil = tr.nameFil;
      if (!parsed.nameId && tr.nameId) parsed.nameId = tr.nameId;
      if (!parsed.descriptionEn && tr.descriptionEn) parsed.descriptionEn = tr.descriptionEn;
      if (!parsed.descriptionFil && tr.descriptionFil) parsed.descriptionFil = tr.descriptionFil;
      if (!parsed.descriptionId && tr.descriptionId) parsed.descriptionId = tr.descriptionId;
      if (!enOk && tr.stepsEn) parsed.stepsEn = tr.stepsEn.map((instruction) => ({ instruction }));
      if (!filOk && tr.stepsFil) parsed.stepsFil = tr.stepsFil.map((instruction) => ({ instruction }));
      if (!idOk && tr.stepsId) parsed.stepsId = tr.stepsId.map((instruction) => ({ instruction }));
      console.log("[AI Edit] Translation fallback applied");
    } catch (e) {
      console.warn("[AI Edit] Translation fallback failed:", (e as Error)?.message);
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

      assertSupportedEditLanguage(input.editPrompt);
      const parsed = await runAiEdit(input, ctx.activeFamilyId, ctx.user.id);

      return {
        name: parsed.name || input.recipe.name,
        nameEn: parsed.nameEn,
        nameFil: parsed.nameFil,
        nameId: parsed.nameId,
        description: parsed.description || input.recipe.description,
        descriptionEn: parsed.descriptionEn,
        descriptionFil: parsed.descriptionFil,
        descriptionId: parsed.descriptionId,
        cookTime: parsed.cookTime ?? input.recipe.cookTime,
        servings: parsed.servings ?? input.recipe.servings,
        difficulty: parsed.difficulty || input.recipe.difficulty,
        recipeCategory: parsed.recipeCategory || input.recipe.recipeCategory,
        ingredients: parsed.ingredients.length > 0 ? parsed.ingredients : input.recipe.ingredients,
        steps: parsed.steps.length > 0 ? parsed.steps : input.recipe.steps,
        stepsEn: parsed.stepsEn,
        stepsFil: parsed.stepsFil,
        stepsId: parsed.stepsId,
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

      assertSupportedEditLanguage(input.editPrompt);
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
        nameEn: parsed.nameEn,
        nameFil: parsed.nameFil,
        nameId: parsed.nameId,
        description: parsed.description || input.recipe.description,
        descriptionEn: parsed.descriptionEn,
        descriptionFil: parsed.descriptionFil,
        descriptionId: parsed.descriptionId,
        image: input.recipe.thumbnailUrl ?? input.recipe.image,
        thumbnailUrl: input.recipe.thumbnailUrl ?? input.recipe.image,
        cookTime: parsed.cookTime ?? input.recipe.cookTime,
        servings: parsed.servings ?? input.recipe.servings,
        difficulty: parsed.difficulty ?? input.recipe.difficulty,
        recipeCategory: parsed.recipeCategory ?? input.recipe.recipeCategory,
        ingredients: JSON.stringify(parsed.ingredients.length > 0 ? parsed.ingredients : input.recipe.ingredients),
        steps: JSON.stringify(parsed.steps.length > 0 ? parsed.steps : input.recipe.steps),
        stepsEn: parsed.stepsEn ? JSON.stringify(parsed.stepsEn) : undefined,
        stepsFil: parsed.stepsFil ? JSON.stringify(parsed.stepsFil) : undefined,
        stepsId: parsed.stepsId ? JSON.stringify(parsed.stepsId) : undefined,
        tags: JSON.stringify(mergedTags),
        sourceType: "manual",
        sourceAuthor: input.recipe.sourceAuthor,
      });

      return { success: true, id: saved.id, name: saved.name };
    }),

  chat: protectedProcedure
    .input(z.object({
      messages: z.array(messageSchema).min(1),
      mode: z.enum(["chat", "ai", "library"]).optional(),
      excludeNames: z.array(z.string()).optional(),
      lang: z.string().optional(),
      search: z.object({
        query: z.string().optional(),
        tags: z.array(z.string()).optional(),
        cookTimeMax: z.number().optional(),
        category: z.string().optional(),
        count: z.number().int().min(1).max(10).optional(),
        rank: z.enum(["shortestTime", "default"]).optional(),
        excludeCategories: z.array(z.string()).optional(),
      }).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const familyId = ctx.activeFamilyId ?? undefined;
      const userId = ctx.user?.id ? Number(ctx.user.id) : undefined;
      const mode = input.mode ?? "chat";
      const excludeNames = input.excludeNames ?? [];

      // AI Chef chat quota（soft cap：唔硬擋，只提示 —— 升級導向）
      let quota: { limit: number; used: number; nearLimit: boolean } | undefined;
      if (familyId) {
        const aiSub = await getFamilySubscription(familyId);
        const aiLimit = aiSub?.aiChatLimit ?? 30;
        const aiUsage = await getAiChatUsage(familyId);
        quota = { limit: aiLimit, used: aiUsage, nearLimit: aiUsage >= aiLimit };
      }

      const result = await processAIChefChat(
        input.messages.map(m => ({ role: m.role, content: m.content })),
        familyId,
        userId,
        mode,
        excludeNames,
        input.search,
        input.lang,
      );

      // 真用咗 LLM 先扣 quota（library mode / library-first 命中 / 換卡 = 免費）
      if (familyId && result.llmUsed) {
        const hasMedia = input.messages.some(m => {
          if (typeof m.content === "string") return /(https?:\/\/|data:image)/i.test(m.content);
          return m.content.some(c => c.type === "image_url");
        });
        await incrementAiChatUsage(familyId, String(ctx.user.id), hasMedia ? 2 : 1);
        if (quota) {
          quota.used += hasMedia ? 2 : 1;
          quota.nearLimit = quota.used >= quota.limit;
        }
      }

      return { ...result, quota };
    }),
});
