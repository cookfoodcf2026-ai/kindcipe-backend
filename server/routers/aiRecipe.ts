import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, or, ilike, desc, lte, gt, sql, notInArray } from "drizzle-orm";
import { protectedProcedure, familyWriteProcedure, router } from "../_core/trpc";
import { invokeLLM, extractJSON, extractFirstJson, repairJSON, salvageJSON, startLlmMeter, Message, MessageContent, TextContent, ImageContent } from "../_core/llm";
import { aiReply, dishLabel } from "../_core/aiReply";
import { resolveChefIntent, lastUserText, previousUserText, isMealFollowUp, isCannedMealPrompt, extractMealIngredients, type ChefIntent, type RequestedRole } from "../services/chefIntent";
import { fallbackQueriesForFoodTerm, findFoodTerm, foodItemType, hasRequestVerb, roleForFoodTerm } from "../services/foodLexicon";
import { getChatQuotaState } from "../services/chatQuota";
import { dispatchChefTurn, type ChefDispatch } from "../services/chefDispatcher";
import { lookupFaqAnswer } from "../services/chefFaq";
import { assembleRecipeSet, type RecipeCandidate } from "../services/recipeSetAssembler";
import { translateRecipeContent, translateRecipesForLang } from "../utils/translateContent";
import { withIngredientTranslations, localizeIngredientNames } from "../utils/recipeTranslations";
import { normalizeDifficulty } from "../utils/difficulty";
import { getDb, incrementAiChatUsage, insertCustomRecipe, getTrendingRecipes } from "../db";
import { normalizeRecipeIngredients } from "../utils/ingredientNormalize";
import { storageGetSignedUrl } from "../storage";
import { officialRecipes, customRecipes, pantryItems, aiChefSeenRecipes } from "../../drizzle/schema";
import { normalizeQuery, segmentQuery, resolveForeignToChinese, getKeywordVariants } from "./recipes";
import { getFamilyEntitlements } from "../services/entitlements";
import { shouldChargeChefRequest } from "../services/aiChefPolicy";
import { applyTruthfulContract, buildChefReply, hashChefPayload } from "../services/aiChefLifecycle";
import { validateChefReply, claimsRecipeCards } from "../services/chefResponse";
import { createAiChefRequestStore } from "../services/aiChefRequestStore";
import { finalizeChefRequest } from "../services/aiChefFinalization";
import { getAiChefMode, getAiChefCapMicros, getFeatureFlags } from "../services/aiChefFlags";
import {
  LlmBudgetError,
  finalizeLlmBudget,
  getLlmBudgetState,
  getNextResetAt,
  releaseLlmBudget,
  reserveLlmBudget,
} from "../services/llmCost";
import {
  commitUsage,
  getUsageSummary,
  refundUsage,
  reserveUsage,
  runWithUsage,
  usageLimitToTRPC,
} from "../services/usage";

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
  description: z.string().default(""),
  descriptionEn: z.string().optional(),
  descriptionFil: z.string().optional(),
  descriptionId: z.string().optional(),
  cookTime: z.number().int().default(30),
  servings: z.number().int().default(4),
  difficulty: z.string().default("中等"),
  recipeCategory: z.string().default("其他"),
  dishType: z.string().optional(),
  image: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  ingredients: z.array(aiRecipeIngredientSchema).default([]),
  steps: z.array(aiRecipeStepSchema).default([]),
  stepsEn: z.array(aiRecipeStepSchema).optional(),
  stepsFil: z.array(aiRecipeStepSchema).optional(),
  stepsId: z.array(aiRecipeStepSchema).optional(),
  tags: z.array(z.string()).default([]),
});

/**
 * Persist payload for an AI edit. The client sends back the *previewed* recipe
 * (the exact result it showed the user), so the backend does NOT need to call
 * the LLM again. This guarantees one LLM call per edit (no double cost / double
 * quota), "what you previewed is exactly what gets saved", and no way to abuse
 * `save` to burn tokens. `editPrompt` is kept for audit only.
 */
const aiEditPersistInputSchema = z.object({
  recipe: aiEditOutputSchema,
  editPrompt: z.string().min(1).max(1000),
});

/**
 * Four-Layer Protection Schema for AI Chef JSON parsing
 * Layer 3: Zod validation with default values to prevent crashes
 */
const aiRecipeCardSchema = z.object({
  title: z.string().optional(),
  name: z.string().min(2),
  nameEn: z.string().optional(),
  nameFil: z.string().optional(),
  nameId: z.string().optional(),
  ingredients: z.array(z.object({
    name: z.string().min(1),
    nameEn: z.string().optional(),
    nameFil: z.string().optional(),
    nameId: z.string().optional(),
    quantity: z.string().default("適量"),
    unit: z.string().default(""),
  })).min(2),
  instructions: z.array(z.string()).default([]),
  steps: z.array(z.string().min(1)).min(5),
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

const AI_CHEF_NOODLE_ROLE = process.env.AI_CHEF_NOODLE_ROLE !== "0";
const AI_CHEF_MULTI_ROLE = process.env.AI_CHEF_MULTI_ROLE !== "0";
const AI_RECIPE_MAX_TOKENS = 2600;
const AI_RECIPE_CONTEXT_TIMEOUT_MS = 4000;
const AI_RECIPE_LLM_TIMEOUT_MS = 45000;
const AI_RECIPE_CHAT_TIMEOUT_MS = 30000;
// AI Edit returns the recipe in 4 languages (zh + en/fil/id) → needs a bigger budget.
const AI_EDIT_MAX_TOKENS = 7000;
const AI_EDIT_LLM_TIMEOUT_MS = 80000;
const AI_RECIPE_FALLBACK_CONTENT = "AI 暫時未能回應，請再試。";

// Fix2: 後端自己記住最近推薦過嘅菜式（per-family，last 30，7 日內有效）—— DB 持久化 + memory fallback
const SEEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 日
// Custom (user's own) recipes resurface sooner so users keep seeing their own
// imports; official recipes keep the full 7-day freshness window.
const SEEN_CUSTOM_EXPIRY_MS = 24 * 60 * 60 * 1000; // 1 日
type SeenEntry = { name: string; seenAt: number };
const FAMILY_RECENT_RECIPES: Map<number | string, SeenEntry[]> = new Map();
const LIBRARY_POOL_CACHE: Map<number, { at: number; rows: Record<string, unknown>[] }> = new Map();
const LIBRARY_POOL_TTL_MS = 60_000;
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

/** Split recently-shown names by window: official uses 7d, custom uses 1d. */
export async function getFamilySeenNamesSplit(familyId?: number): Promise<{ seen7d: string[]; seen1d: string[] }> {
  if (familyId === undefined) return { seen7d: [], seen1d: [] };
  const now = Date.now();
  try {
    const db = await getDb();
    if (db) {
      const cutoff = new Date(now - SEEN_EXPIRY_MS);
      const rows = await db
        .select({ name: aiChefSeenRecipes.name, seenAt: aiChefSeenRecipes.seenAt })
        .from(aiChefSeenRecipes)
        .where(and(eq(aiChefSeenRecipes.familyId, familyId), gt(aiChefSeenRecipes.seenAt, cutoff)))
        .orderBy(desc(aiChefSeenRecipes.seenAt))
        .limit(MAX_RECENT_PER_FAMILY);
      const seen7d = rows.map(r => r.name);
      const seen1d = rows.filter(r => now - new Date(r.seenAt).getTime() < SEEN_CUSTOM_EXPIRY_MS).map(r => r.name);
      return { seen7d, seen1d };
    }
  } catch (e) {
    console.warn("[AI Chef] getFamilySeenNamesSplit DB failed, fallback memory:", (e as Error)?.message);
  }
  const entries = FAMILY_RECENT_RECIPES.get(familyId) ?? [];
  return {
    seen7d: entries.filter(e => now - e.seenAt < SEEN_EXPIRY_MS).map(e => e.name),
    seen1d: entries.filter(e => now - e.seenAt < SEEN_CUSTOM_EXPIRY_MS).map(e => e.name),
  };
}

export async function recordFamilySeenNames(familyId: number | undefined, names: string[]): Promise<void> {
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
export function zeroCardFoodReply(lang: string): string {
  return String(lang ?? "").startsWith("zh")
    ? "我今次整唔到食譜卡（解析失敗），冇扣你 credit。可以再試一次，或者按「食譜庫」／「AI 生成」直接攞。"
    : "I couldn't build the recipe cards this time (parse failed). No credit was charged. Please try again, or use Library / AI generate.";
}

export function getRecipeRetryReason(input: {
  content: string;
  finishReason: string;
  recipes: SuggestedRecipe[];
  wantCards: boolean;
}): string {
  if (input.recipes.length > 0) return "";
  if (input.finishReason === "length" && (input.wantCards || input.content.includes('"recipes"'))) return "finish_reason=length";
  if (input.content.includes('"recipes"')) return "recipes_parse_failed";
  if (input.wantCards) return "empty_card_output";
  return "";
}

/** Retry exactly once with a card-sized budget; testable without a live LLM. */
export async function retryRecipeOutputOnce(
  input: {
    content: string;
    finishReason: string;
    recipes: SuggestedRecipe[];
    wantCards: boolean;
    lang?: string;
  },
  retry: () => Promise<string>,
): Promise<{ content: string; recipes: SuggestedRecipe[]; retried: boolean; retrySucceeded: boolean; reason: string }> {
  const reason = getRecipeRetryReason(input);
  if (!reason) return { ...input, retried: false, retrySucceeded: false, reason };
  const retriedContent = await retry();
  const parsed = parseRecipeWithFallback(retriedContent, input.lang ?? "zh-TW");
  return {
    content: parsed.content,
    recipes: parsed.recipes,
    retried: true,
    retrySucceeded: parsed.recipes.length > 0,
    reason,
  };
}

async function retryLLMJson(
  messages: Message[],
  familyId: number | undefined,
  userId: number | undefined,
  reason = "parse_failure"
): Promise<string> {
  const retryMsg = [
    ...messages,
    { role: "user" as const, content: "上次輸出嘅 JSON 唔完整/格式錯咗，請重新輸出完整食譜，必須係完整 JSON（唔好省略任何欄位，唔好截斷）。" },
  ];
  console.log(`[AI Chef] retry reason=${reason} maxTokens=3500`);
  const { finalContent, finishReason } = await runToolsLoop(
    retryMsg,
    familyId,
    userId,
    false,
    true,
    { maxTokens: 3500, timeoutMs: 35000 },
  );
  console.log(`[AI Chef] retry complete finish_reason=${finishReason} chars=${finalContent.length}`);
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

function parseRecipeWithFallback(llmContent: string, lang: string = "zh-TW"): { content: string; recipes: SuggestedRecipe[] } {
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
          content = manualReplyText || aiReply(lang, "recommendN", { n: recipes.length });
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
          content = manualReplyText || aiReply(lang, "recommendN", { n: recipes.length });
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
              content = manualReplyText || aiReply(lang, "recommendN", { n: recipes.length });
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
          content = manualReplyText || aiReply(lang, "recommendN", { n: recipes.length });
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
            content = manualReplyText || aiReply(lang, "recommendN", { n: recipes.length });
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
      content = aiReply(lang, "foundIncomplete");
    }
  }

  console.log(`[AI Chef] No recipes parsed in ${Date.now() - parseStart}ms`);
  return { content, recipes };
}

/**
 * Manual recipe converter - converts recipe data without strict Zod validation
 * Used as fallback when schema validation fails
 */
function manuallyConvertRecipes(recipes: any[], replyText?: string, minSteps = 5): SuggestedRecipe[] {
  if (!Array.isArray(recipes)) return [];
  
  return recipes.map((r: any): SuggestedRecipe | null => {
    try {
      const name = String(r.name ?? r.title ?? "").trim();
      if (!name || name === "未命名食譜" || name.length < 2) return null;
      
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
      
      if (steps.length < minSteps) return null;
      const validIngredients = ingredients.filter((i: any) => i.name && i.name !== "未知食材");
      if (validIngredients.length < 2) return null;

      return {
        name,
        nameEn: r.nameEn ? String(r.nameEn) : undefined,
        nameFil: r.nameFil ? String(r.nameFil) : undefined,
        nameId: r.nameId ? String(r.nameId) : undefined,
        description: String(r.description ?? ""),
        cookTime: Number(r.cookTime ?? 30),
        servings: Number(r.servings ?? 4),
        difficulty: (String(r.difficulty ?? "中等") as "easy" | "medium" | "hard"),
        ingredients: normalizeRecipeIngredients(ingredients),
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
      name: (item.title && item.title !== "未命名食譜" ? item.title : item.name || "").trim(),
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
    const isValid = recipe.name && recipe.name !== "未命名食譜" && recipe.name.length > 1 && actualSteps.length >= 5 && actualIngredients.length >= 2;
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
  descriptionEn?: string;
  descriptionFil?: string;
  descriptionId?: string;
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

// Avoid-list matching is intentionally conservative: allergens must never be
// suggested just because the library result happened to look tasty.
const AVOID_TERM_EXPANSIONS: Record<string, string[]> = {
  花生: ["花生", "peanut", "groundnut"],
  堅果: ["堅果", "果仁", "花生", "杏仁", "腰果", "核桃", "合桃", "榛子", "開心果", "almond", "cashew", "walnut", "pecan", "nut"],
  海鮮: ["海鮮", "魚", "蝦", "蟹", "蜆", "蠔", "魷魚", "章魚", "帶子", "海參", "鮑魚", "seafood", "fish", "shrimp", "prawn", "crab", "squid", "oyster", "scallop"],
  甲殼類: ["蝦", "蟹", "龍蝦", "甲殼", "shrimp", "prawn", "crab", "lobster", "crustacean"],
  蛋: ["蛋", "雞蛋", "蛋黃", "蛋白", "egg"],
  奶: ["奶", "牛奶", "芝士", "牛油", "忌廉", "奶油", "乳酪", "milk", "cheese", "butter", "cream", "yogurt"],
  麩質: ["麵", "麵包", "麵粉", "意粉", "烏冬", "麥", "麩", "wheat", "flour", "bread", "pasta", "noodle", "gluten"],
  大豆: ["大豆", "黃豆", "豆腐", "豆乾", "豆皮", "腐竹", "豉油", "生抽", "老抽", "醬油", "soy", "tofu"],
  芝麻: ["芝麻", "sesame"],
};

function expandAvoidTerms(avoid: string[]): string[] {
  const terms = new Set<string>();
  for (const raw of avoid) {
    const key = String(raw ?? "").trim();
    if (!key) continue;
    terms.add(key.toLowerCase());
    for (const term of AVOID_TERM_EXPANSIONS[key] ?? []) terms.add(term.toLowerCase());
  }
  return [...terms];
}

function recipeText(value: { name?: unknown; description?: unknown; tags?: unknown; ingredients?: unknown; recipeCategory?: unknown }): string {
  const ingredients = Array.isArray(value.ingredients)
    ? value.ingredients.map((ing: any) => typeof ing === "string" ? ing : ing?.name ?? "").join(" ")
    : "";
  const tags = Array.isArray(value.tags) ? value.tags.join(" ") : "";
  return [value.name, value.description, value.recipeCategory, tags, ingredients]
    .filter(Boolean)
    .map((part) => String(part).toLowerCase())
    .join(" ");
}

export function recipeContainsAvoid(
  recipe: { name?: unknown; description?: unknown; tags?: unknown; ingredients?: unknown; recipeCategory?: unknown },
  avoid: string[],
): boolean {
  if (!avoid.length) return false;
  const haystack = recipeText(recipe);
  return expandAvoidTerms(avoid).some((term) => term.length > 0 && haystack.includes(term));
}

function rowContainsAvoid(row: Record<string, unknown>, avoid: string[]): boolean {
  return recipeContainsAvoid(row as any, avoid);
}

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

export async function execSearchRecipes(
  db: Db, args: { query: string; category?: string; limit?: number; tags?: string[]; cookTimeMax?: number; excludeCategories?: string[]; scenario?: string }, familyId?: number
) {
  const limit = args.limit ?? 15;

  // 時間約束：單獨抽「N 分鐘」→ cookTime ≤ N；其餘字詞照常 AND 搜尋
  // 時間命中（cookTime 合符）可獨立命中，唔受關鍵字完全吻合限制（例如「30分鐘快煮」搵 30 分鐘食譜）
  const timeMatch = args.query.trim().toLowerCase().match(/(\d{1,3})\s*分鐘/);
  const minutes = timeMatch ? parseInt(timeMatch[1], 10) : undefined;
  const rawQuery = minutes && minutes > 0 ? args.query.replace(/(\d{1,3})\s*分鐘/g, " ") : args.query;
  const cookTimeMax = args.cookTimeMax ?? minutes;

  // 與食譜搜尋一致：外文 → 中文 → 繁簡歸一 → 分詞。
  // 注意：外文（菲/印/英）經 resolveForeignToChinese 只會「部分」翻譯，故：
  //   ① 搜尋擴至雙語欄位（nameEn/nameFil/nameId），令未翻譯 token 都可以命中；
  //   ② AND 命中 0 → OR 保底，避免一個未譯 token 令全盤 0（→ 唔會誤跌 LLM 扣數）。
  const hasForeign = /[a-z]/i.test(rawQuery);
  const resolved = hasForeign ? await resolveForeignToChinese(rawQuery) : rawQuery.trim().toLowerCase();
  const normalized = normalizeQuery(resolved);
  const keywords = segmentQuery(normalized);

  const searchTable = async (
    table: any,
    cols: any,
    extraWhere: any[],
    mode: "and" | "or",
  ): Promise<Record<string, unknown>[]> => {
    // Scenario (hotkey) is the primary selector: when present, do NOT also AND the
    // fuzzy text/tag conditions (that over-narrows, e.g. healthy = scenario AND text
    // "清淡"). Time (quick) still applies.
    const scenarioPrimary = !!args.scenario;
    const textCond = !scenarioPrimary && keywords.length > 0
      ? (mode === "and" ? and : or)(
          ...keywords.map(kw => {
            const variants = getKeywordVariants(kw);
            // 雙語欄位：中文 token 唔會 match 英文欄位，安全；反之令外文 token 命中
            return or(...[
              table.name, table.description, table.tags, table.ingredients,
              table.nameEn, table.nameFil, table.nameId, table.recipeCategory,
            ].flatMap(f => variants.map(v => ilike(f, `%${v}%`))));
          }),
        )
      : undefined;
    const timeCond = cookTimeMax && cookTimeMax > 0 ? lte(table.cookTime, cookTimeMax) : undefined;
    const tagConds = !scenarioPrimary ? (args.tags ?? []).map(tag => ilike(table.tags, `%"${tag}"%`)) : [];
    const tagCond = tagConds.length > 0 ? and(...tagConds) : undefined;
    const combined = [textCond, tagCond].filter(Boolean) as any[];
    const mainCond = combined.length > 0 ? and(...combined) : undefined;
    const where = and(
      mainCond && timeCond ? or(mainCond, timeCond) : (mainCond ?? timeCond),
      ...extraWhere,
    );
    return (await db.select(cols).from(table).where(where).orderBy(desc(table.createdAt)).limit(limit)) as Record<string, unknown>[];
  };

  const officialCols = {
    id: officialRecipes.id, name: officialRecipes.name, nameEn: officialRecipes.nameEn, nameFil: officialRecipes.nameFil, nameId: officialRecipes.nameId, description: officialRecipes.description, descriptionEn: officialRecipes.descriptionEn, descriptionFil: officialRecipes.descriptionFil, descriptionId: officialRecipes.descriptionId,
    cookTime: officialRecipes.cookTime, servings: officialRecipes.servings, difficulty: officialRecipes.difficulty,
    recipeCategory: officialRecipes.recipeCategory, ingredients: officialRecipes.ingredients,
    steps: officialRecipes.steps, stepsEn: officialRecipes.stepsEn, stepsFil: officialRecipes.stepsFil, stepsId: officialRecipes.stepsId,
    tags: officialRecipes.tags, thumbnailUrl: officialRecipes.thumbnailUrl, image: officialRecipes.image,
    dishType: officialRecipes.dishType,
  };
  const customCols = {
    id: customRecipes.id, name: customRecipes.name, nameEn: customRecipes.nameEn, nameFil: customRecipes.nameFil, nameId: customRecipes.nameId, description: customRecipes.description, descriptionEn: customRecipes.descriptionEn, descriptionFil: customRecipes.descriptionFil, descriptionId: customRecipes.descriptionId,
    cookTime: customRecipes.cookTime, servings: customRecipes.servings, difficulty: customRecipes.difficulty,
    recipeCategory: customRecipes.recipeCategory, ingredients: customRecipes.ingredients,
    steps: customRecipes.steps, stepsEn: customRecipes.stepsEn, stepsFil: customRecipes.stepsFil, stepsId: customRecipes.stepsId,
    tags: customRecipes.tags, thumbnailUrl: customRecipes.thumbnailUrl, image: customRecipes.image,
    dishType: customRecipes.dishType,
  };

  const officialWhere = [
    eq(officialRecipes.isActive, true),
    args.category ? eq(officialRecipes.recipeCategory, args.category) : undefined,
    args.excludeCategories && args.excludeCategories.length > 0 ? notInArray(officialRecipes.recipeCategory, args.excludeCategories) : undefined,
    args.scenario ? ilike(officialRecipes.scenarioTags, `%"${args.scenario}"%`) : undefined,
  ].filter(Boolean);
  let officialRows = await searchTable(officialRecipes, officialCols, officialWhere, "and");
  if (officialRows.length === 0) {
    officialRows = await searchTable(officialRecipes, officialCols, officialWhere, "or");
  }

  let customRows: Record<string, unknown>[] = [];
  if (familyId) {
    const customWhere = [
      or(
        eq(customRecipes.familyId, familyId),
        and(
          eq(customRecipes.familyId, 0),
          eq(customRecipes.visibility, "public"),
        ),
      ),
      eq(customRecipes.isDraft, false),
      args.category ? eq(customRecipes.recipeCategory, args.category) : undefined,
      args.excludeCategories && args.excludeCategories.length > 0 ? notInArray(customRecipes.recipeCategory, args.excludeCategories) : undefined,
      args.scenario ? ilike(customRecipes.scenarioTags, `%"${args.scenario}"%`) : undefined,
    ].filter(Boolean);
    customRows = await searchTable(customRecipes, customCols, customWhere, "and");
    if (customRows.length === 0) {
      customRows = await searchTable(customRecipes, customCols, customWhere, "or");
    }
  }

  const mapRow = (r: Record<string, unknown>, source: "official" | "custom") => ({
    source, id: r.id, name: r.name, nameEn: r.nameEn, nameFil: r.nameFil, nameId: r.nameId, description: r.description,
    descriptionEn: r.descriptionEn, descriptionFil: r.descriptionFil, descriptionId: r.descriptionId, cookTime: r.cookTime,
    servings: r.servings, difficulty: r.difficulty, category: r.recipeCategory,
    ingredients: safeParseJsonArray(r.ingredients as string).slice(0, 8),
    steps: safeParseJsonArray(r.steps as string), stepsEn: safeParseJsonArray(r.stepsEn as string), stepsFil: safeParseJsonArray(r.stepsFil as string), stepsId: safeParseJsonArray(r.stepsId as string),
    tags: safeParseJsonArray(r.tags as string),
    thumbnailUrl: r.thumbnailUrl, image: r.image, dishType: r.dishType,
  });

  // custom 優先，但唔可以擠走全部 official（避免 family 自訂太多令換卡只剩 AI）：
  // custom 先佔最多一半，其餘 official，再補 custom。
  const mapCustom = customRows.map(r => mapRow(r, "custom"));
  const mapOfficial = officialRows.map(r => mapRow(r, "official"));
  const capCustom = Math.max(1, Math.ceil(limit / 2));
  const ordered = [...mapCustom.slice(0, capCustom), ...mapOfficial, ...mapCustom.slice(capCustom)];
  const seen = new Set<string>();
  const merged: Record<string, unknown>[] = [];
  for (const r of ordered) {
    const key = String(r.name ?? "").trim().toLowerCase();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    merged.push(r);
  }

  return { count: merged.length, recipes: merged.slice(0, limit) };
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
  excludeNames: Set<string> = new Set(),
  query = "家常",
): Promise<{ recipes: SuggestedRecipe[]; fromDb: number }> {
  const recipes: SuggestedRecipe[] = [];
  let fromDb = 0;

  if (!db) return { recipes, fromDb: 0 };

  try {
    // Search from both official and custom recipes
    const searchResult = await execSearchRecipes(db, { query: query || "家常", limit: 50 }, familyId);
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
type DishType = "soup" | "meat" | "seafood" | "vegetable" | "carb" | "appetizer" | "dessert" | "drink" | "other";

const DISH_TYPE_MAP: Record<string, DishType> = {
  "湯": "soup", "湯水": "soup", "湯品": "soup", "煲湯": "soup", "老火湯": "soup", "燉湯": "soup", "滾湯": "soup",
  "肉類": "meat", "主菜": "meat", "肉": "meat", "豬": "meat", "牛": "meat", "雞": "meat", "肉類主菜": "meat",
  "海鮮": "seafood", "魚": "seafood", "蝦": "seafood", "蟹": "seafood", "海鮮類": "seafood", "蛋白": "seafood", "海鮮/蛋白": "seafood",
  "蔬菜": "vegetable", "菜": "vegetable", "素菜": "vegetable", "蔬果": "vegetable", "蔬菜類": "vegetable", "小炒": "vegetable",
  "主食": "carb", "飯": "carb", "麵": "carb", "粉": "carb", "飯麵": "carb", "飯麵/主食": "carb",
  "前菜": "appetizer", "小食": "appetizer", "小吃": "appetizer", "涼拌": "appetizer", "沙律": "appetizer", "前菜/小食": "appetizer",
  "甜品": "dessert", "糖水": "dessert", "糕": "dessert", "點心": "dessert",
  "飲品": "drink", "涼茶": "drink", "飲料": "drink", "清熱飲": "drink",
};

const CANONICAL_DISH_TYPES: DishType[] = ["soup", "meat", "seafood", "vegetable", "carb", "appetizer", "dessert", "drink", "other"];

function normalizeDishType(v: string | undefined): DishType | undefined {
  if (!v) return undefined;
  const s = String(v).trim();
  const lower = s.toLowerCase() as DishType;
  if (CANONICAL_DISH_TYPES.includes(lower)) return lower; // 已係 canonical key
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
  if (/湯水|煲湯|燉湯|老火湯|滾湯|湯品|魚湯|雞湯|排骨湯|濃湯|清湯|湯羹|羅宋湯|粟米湯|番茄湯|(^|[\s,、])湯($|[\s,、])|\bsoup\b|\bbroth\b|\bbisque\b|\bchowder\b|\bconsomm[eé]\b/i.test(tagsStr)) return "soup";
  if (/涼茶|飲品|飲料|清熱|竹蔗茅根|茅根水|山楂水|薏米水|蘆根|羅漢果|菊花茶|檸檬茶|雪梨水|陳皮水|汽水|果汁|鮮榨|梳打/.test(tagsStr)) return "drink";
  if (/甜品|糖水|西米露|布甸|布丁|啫喱|慕斯|雪糕|蛋糕|蛋撻|曲奇|奶凍|糕點|甜點|芝麻糊|紅豆沙|綠豆沙|楊枝甘露|芋圓/.test(tagsStr)) return "dessert";

  // 4) 菜名湯/甜品/飲品（優先過 tags 蛋白/蔬菜，避免「魚湯/蜆湯」被當海鮮餸，令一餐兩個湯）
  if (/湯$|湯水|煲湯|燉湯|老火湯|滾湯|湯品|魚湯|雞湯|排骨湯|濃湯|清湯|湯羹|羅宋湯|粟米湯|番茄湯|\b(soup|broth|bisque|chowder|consomm[eé])\b/i.test(name)) return "soup";
  if (/糖水|西米露|布甸|布丁|啫喱|慕斯|雪糕|蛋糕|蛋撻|曲奇|奶凍|糕點|甜點|芝麻糊|紅豆沙|綠豆沙|楊枝甘露|芋圓|糕$/.test(name)) return "dessert";
  if (/水$|涼茶|竹蔗茅根|茅根水|山楂水|薏米水|蘆根|羅漢果|菊花茶|檸檬茶|雪梨水|陳皮水|汽水|果汁|茶飲/.test(name)) return "drink";
  // 4b) 菜名含明確蔬菜字 → 蔬菜（優先過 tags 蛋白，避免「蠔油芥蘭」因為蠔油=蠔而被誤判海鮮）
  if (/菜心|芥蘭|通菜|菠菜|生菜|白菜|椰菜|西蘭花|時蔬|素菜|青菜|蔬菜|南瓜|蘿蔔|薯仔|番茄|茄子|青椒|洋蔥|節瓜|勝瓜|苦瓜|西洋菜|冬瓜|青瓜|黃瓜|絲瓜|豆芽|豆角|青豆|毛豆|雲耳|木耳|菇|菌|芽菜/.test(name)) return "vegetable";

  // 4c) Noodle / rice dishes: carb, not "other".
  if (dishFamily(name) === "noodle" || dishFamily(name) === "rice") return "carb";

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

function isDessertRecipe(recipe: SuggestedRecipe): boolean {
  return classifyDishType({
    name: recipe.name,
    tags: recipe.tags,
    dishType: recipe.dishType,
    soupType: recipe.soupType,
  } as unknown as Record<string, unknown>) === "dessert";
}

function isSoupRecipe(recipe: SuggestedRecipe): boolean {
  const name = String(recipe?.name ?? "");
  const tags = Array.isArray(recipe?.tags) ? recipe.tags.join(" ") : "";
  const soupType = String((recipe as any)?.soupType ?? "");
  return classifyDishType({
    name,
    tags: recipe.tags,
    dishType: recipe.dishType,
    soupType,
  } as unknown as Record<string, unknown>) === "soup" || /湯|羹|soup|broth|bisque|chowder|consomme|consommé/i.test(`${name} ${tags} ${soupType}`);
}

// 將餸再細分「家族」（麵/飯/點心/其他），避免 3 餸 1 湯抽到兩款麵/兩款飯
function dishFamily(name: string): string {
  if (/麵|面|粉|米線|米线|河粉|烏冬|乌冬|拉麵|拉面|伊麵|意粉|通粉|粉絲|粉丝|炒麵|炒面|撈麵|公仔麵|noodle|ramen|udon|soba|pasta|laksa|pho/i.test(name)) return "noodle";
  if (/飯|饭|炒飯|炒饭|焗飯|糯米|煲仔飯|丼|蓋飯|rice/i.test(name)) return "rice";
  if (/包|饅頭|饅头|餃|饺|雲吞|云吞|點心|点心|dumpling/i.test(name)) return "dumpling";
  return "other";
}

// 由 library rows 揀「1 湯 + 3 餸」；排除已睇過（優先 fresh，池盡翻兜）
// Source-aware exclusion: official uses the 7-day set, custom uses the 1-day set,
// so a user's own recipes are not hidden for a week after being shown once.
type ExcludeSets = { official: Set<string>; custom: Set<string> };
export const mkExcludeSets = (official: Iterable<string>, custom: Iterable<string>): ExcludeSets => ({
  official: new Set([...official].map(normalizeName).filter(Boolean)),
  custom: new Set([...custom].map(normalizeName).filter(Boolean)),
});
const isRowExcluded = (ex: ExcludeSets, r: Record<string, unknown>): boolean => {
  const set = r.source === "official" ? ex.official : ex.custom;
  return set.has(normalizeName(String(r.name ?? "")));
};

export function pickSoupMeal(rows: Record<string, unknown>[], ex: ExcludeSets, dishCount = 3, soupCount = 1): SuggestedRecipe[] {

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
  const otherPool = pool.filter(r => (classify(r) === "other" || classify(r) === "appetizer") && noCarb(r));
  const dishPool = [...meatPool, ...seafoodPool, ...vegPool, ...otherPool];
  console.log(`[pickSoupMeal] pool=${pool.length} soup=${soupPool.length} meat=${meatPool.length} seafood=${seafoodPool.length} veg=${vegPool.length} other=${otherPool.length} (raw rows=${rows.length}, noSteps=${rows.length - pool.length})`);

  // custom 優先（段內才 shuffle），令用戶自己嘅食譜排先；同時保留排除去重
  const shuffleLocal = <T,>(a: T[]): T[] => {
    const out = [...a];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const customFirst = (arr: Record<string, unknown>[]): Record<string, unknown>[] => [
    ...shuffleLocal(arr.filter((r) => r.source !== "official")),
    ...shuffleLocal(arr.filter((r) => r.source === "official")),
  ];
  const pickN = (arr: Record<string, unknown>[], n: number): Record<string, unknown>[] => {
    if (n <= 0 || arr.length === 0) return [];
    const fresh = arr.filter(r => !isRowExcluded(ex, r));
    const reused = arr.filter(r => isRowExcluded(ex, r));
    return customFirst(fresh.length > 0 ? fresh : reused).slice(0, n);
  };

  const soup = pickN(soupPool, Math.min(soupCount, 3));
  const usedFams = new Set<string>();
  // 揀餸時偏好同已揀「唔同家族」嘅餸（避免兩款麵/兩款飯），custom 優先，fresh 優先次序保留
  const pickNByFamily = (arr: Record<string, unknown>[], n: number): Record<string, unknown>[] => {
    if (n <= 0 || arr.length === 0) return [];
    const fresh = arr.filter(r => !isRowExcluded(ex, r));
    const reused = arr.filter(r => isRowExcluded(ex, r));
    const pool = (fresh.length > 0 ? fresh : reused).sort((a, b) => {
      const ca = a.source === "official" ? 1 : 0;
      const cb = b.source === "official" ? 1 : 0;
      if (ca !== cb) return ca - cb;
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
  // 主食（麵/飯）唔做餸（上面 pool 已排除）。先 1肉+1海鮮+1菜，缺就先由 otherPool 補，再到全 dishPool 補齊 dishCount 餸
  let want = dishCount - dishes.length;
  if (want > 0) {
    const already = new Set(dishes.map(r => r));
    dishes = dishes.concat(addDish(otherPool.filter(r => !already.has(r)), want));
  }
  if (dishes.length < dishCount) {
    const already = new Set(dishes.map(r => r));
    dishes = dishes.concat(addDish(dishPool.filter(r => !already.has(r)), dishCount - dishes.length));
  }
  // 極兜底：連非主食餸都唔夠先准用主食（保證唔少過 dishCount 餸）
  if (dishes.length < dishCount) {
    const already = new Set(dishes.map(r => r));
    dishes = dishes.concat(addDish(dishPool.filter(r => !already.has(r)), dishCount - dishes.length));
  }

  let picked = [...soup, ...dishes];
  // 兜底：唔夠 total 張 → 由全庫非甜品/飲品/主食補（保證有卡，之後 AI 補尾數）
  const totalWanted = dishCount + soupCount;
  if (picked.length < totalWanted) {
    const already = new Set(picked.map(r => r));
    const rest = pool.filter(r => !already.has(r) && !isCarb(r) && classify(r) !== "dessert" && classify(r) !== "drink")
      .sort(() => Math.random() - 0.5);
    picked = picked.concat(rest.slice(0, totalWanted - picked.length));
  }
  // 極兜底：全庫都係甜品/飲品/主食先准用
  if (picked.length < totalWanted) {
    const already = new Set(picked.map(r => r));
    const rest = pool.filter(r => !already.has(r)).sort(() => Math.random() - 0.5);
    picked = picked.concat(rest.slice(0, totalWanted - picked.length));
  }

  return picked.map((r: any): SuggestedRecipe | null => {
    const steps = (Array.isArray(r.steps) ? r.steps : [])
      .map((st: any) => typeof st === "string" ? st : String(st?.instruction ?? st?.text ?? st ?? ""))
      .map((t: string) => t.trim()).filter(Boolean);
    if (steps.length === 0) return null;
    const official = r.source === "official";
    const str = (v: unknown): string | undefined => { const s = String(v ?? "").trim(); return s ? s : undefined; };
    const stepsOf = (v: unknown): string[] | undefined => {
      const arr = Array.isArray(v) ? v : [];
      const out = arr.map((s: any) => typeof s === "string" ? s : String(s?.instruction ?? s?.text ?? s ?? "")).map((t: string) => t.trim()).filter(Boolean);
      return out.length > 0 ? out : undefined;
    };
    return {
      name: String(r.name ?? "").trim(),
      nameEn: str((r as any).nameEn),
      nameFil: str((r as any).nameFil),
      nameId: str((r as any).nameId),
      description: String(r.description ?? "").trim(),
      cookTime: Number(r.cookTime ?? 30) || 30,
      servings: Number(r.servings ?? 4) || 4,
      difficulty: String(r.difficulty ?? "medium"),
      ingredients: (Array.isArray(r.ingredients) ? r.ingredients : []).map((i: any) => ({
        name: String(i?.name ?? "").trim(),
        nameEn: str(i?.nameEn),
        nameFil: str(i?.nameFil),
        nameId: str(i?.nameId),
        quantity: String(i?.quantity ?? "").trim(),
        unit: String(i?.unit ?? "").trim(),
      })).filter((x: any) => x.name),
      steps,
      stepsEn: stepsOf((r as any).stepsEn),
      stepsFil: stepsOf((r as any).stepsFil),
      stepsId: stepsOf((r as any).stepsId),
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
    if (search.cookTimeMax) {
      // Match the DB layer (`lte(cookTime, max)`): unknown cookTime (NULL) does NOT
      // pass a time filter. Previously null was coerced to 0 → included, which made
      // hotkey results depend on whether the primary search returned anything.
      const raw = r.cookTime;
      if (raw === null || raw === undefined || raw === "") return false;
      const ct = Number(raw);
      if (!Number.isFinite(ct) || ct > search.cookTimeMax) return false;
    }
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
  carb: { label: "麵食/湯麵（拉麵/烏冬/米線/意粉）", isSoup: false },
  dessert: { label: "甜品（糖水/糕點/凍品）", isSoup: false },
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

function dishTypeForRole(role: RequestedRole): DishType {
  return role === "noodle" ? "carb" : (role as DishType);
}

const ROLE_LIBRARY_QUERY: Partial<Record<RequestedRole, string>> = {
  dessert: "甜品",
  soup: "湯",
  meat: "肉",
  seafood: "海鮮",
  vegetable: "菜",
  noodle: "麵",
};

function matchesLibraryRole(row: Record<string, unknown>, role: RequestedRole): boolean {
  if (role === "noodle") return dishFamily(String(row.name ?? "")) === "noodle";
  return classifyDishType(row) === dishTypeForRole(role);
}

// 由 AI 補缺（library 唔夠時）。neededTypes 指定缺失類別 → 逐類生成，確保 3餸1湯 結構。
async function generateMissingRecipes(
  count: number,
  needSoup: boolean,
  exclude: string[],
  familyId: number | undefined,
  userId: number | undefined,
  neededTypes?: DishType[],
  avoidIngredients: string[] = [],
): Promise<SuggestedRecipe[]> {
  if (count <= 0) return [];
  // 指定缺失類別 → 逐類生成（避免 AI 亂補出麵/飯/錯類）
  if (neededTypes && neededTypes.length > 0) {
    const results = await Promise.all(
      neededTypes.map(t => {
        return generateOneType(MEAL_TYPE_LABEL[t]?.label ?? "家常菜", t, exclude, avoidIngredients);
      })
    );
    return results.filter((r): r is SuggestedRecipe => !!r).slice(0, count);
  }
  try {
    const soupHint = needSoup ? "必須包含 1 個湯水食譜。" : "";
    const avoidLine = avoidIngredients.length > 0
      ? `必須完全避免以下敏感食材，任何食譜都唔可以包含：${avoidIngredients.join("、")}。`
      : "";
    const prompt = `請生成 ${count} 個家常菜食譜。${soupHint}${avoidLine} 絕對唔可以重複以下已推薦過嘅菜式，必須全新（名唔同但同一款菜、近似嘅都唔可以）：${dedupeNames(exclude).slice(0, 15).join("、")}。每個食譜請包含：名稱、描述、煮食時間（分鐘）、難度、份量、食材清單（名稱、數量、單位）、步驟（請精簡，5-6 步）。用繁體中文。每個食譜同每個 ingredient 請同時提供 nameEn/nameFil/nameId；steps 係中文步驟，同時提供 stepsEn/stepsFil/stepsId（每一步對應）；description 同時提供 descriptionEn/descriptionFil/descriptionId。回傳 JSON：{"recipes":[{"name":"...","nameEn":"...","nameFil":"...","nameId":"...","cookTime":30,"servings":4,"difficulty":"簡單","description":"...","descriptionEn":"...","descriptionFil":"...","descriptionId":"...","ingredients":[{"name":"...","nameEn":"...","nameFil":"...","nameId":"...","quantity":"...","unit":"..."}],"steps":["..."],"stepsEn":["..."],"stepsFil":["..."],"stepsId":["..."]}]}`;
    const resp = await invokeLLM({
      messages: [{ role: "user", content: prompt }],
      maxTokens: 3500 * Math.max(1, count),
      temperature: 0.7,
      timeoutMs: AI_RECIPE_LLM_TIMEOUT_MS,
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
  exclude: string[],
  avoidIngredients: string[] = [],
): Promise<SuggestedRecipe | null> {
  const isSoup = expectedType === "soup";
  const isVeg = expectedType === "vegetable";
  const isDessert = expectedType === "dessert";
  const isCarb = expectedType === "carb";
  // 由 exclude 抽「出過嘅湯」：湯位用完整清單（唔 slice-15），確保唔再出返已睇過嘅湯
  const soupExclude = exclude.filter(n => /湯|羹/.test(String(n ?? "")));
  const avoidList = isSoup ? soupExclude : exclude.slice(0, 15);
  const soupHint = isSoup
    ? `必須係湯水。唔好淨係出例湯/老火湯，試下唔同種類嘅湯（清湯/燉湯/羹/西式/素湯等），要同之前唔同。絕對唔可以再出以下出過嘅湯：${soupExclude.join("、")}。`
    : isDessert
      ? "呢道必須係甜品/甜點（例如糖水、西米露、布甸、奶凍、糕點、雪糕）；唔可以係湯、主菜、麵或飯。步驟 4–6 步即可。"
      : isCarb
        ? "呢道必須係一道麵食/湯麵（例如拉麵、烏冬、米線、意粉、湯麵）；唔可以係純湯、純肉或甜品。步驟 5–6 步。"
        : isVeg
          ? "呢道必須係一道蔬菜（清淡為主，唔好配肉/海鮮做主角，例如蒜蓉炒菜心、清炒西蘭花、上湯浸時蔬）；唔可以係湯、唔可以係麵/飯。"
          : "呢道必須係一道主菜/小炒，唔可以係湯（例如湯、羹、湯麵都唔得）、唔可以係麵、唔可以係飯（主食）。";
  const avoidLine = avoidIngredients.length > 0
    ? `必須完全避免以下敏感食材，任何食譜都唔可以包含：${avoidIngredients.join("、")}。`
    : "";
  const basePrompt = `請生成 1 個${label}家常菜食譜（只此一道）。${soupHint}${avoidLine} name 欄只寫呢道餸本身嘅名（例如「紅燒肉」「清蒸鱸魚」），絕對唔可以加入其他菜式或湯水喺名入面。絕對唔可以重複以下已推薦過嘅菜式，必須全新（名唔同但同一款菜、近似嘅都唔可以）：${avoidList.join("、")}。用繁體中文。每個 ingredient 請提供 nameEn/nameFil/nameId；呢道餸本身提供 nameEn/nameFil/nameId。steps 係中文步驟（請精簡，5-6 步）；請同時提供 stepsEn/stepsFil/stepsId（每一步對應，份量/時間一致）。description 同時提供 descriptionEn/descriptionFil/descriptionId。回傳以下 JSON 格式（單一食譜 object，唔好加 array wrapper）：{"name":"...","nameEn":"...","nameFil":"...","nameId":"...","cookTime":30,"servings":4,"difficulty":"簡單","description":"...","descriptionEn":"...","descriptionFil":"...","descriptionId":"...","ingredients":[{"name":"...","nameEn":"...","nameFil":"...","nameId":"...","quantity":"...","unit":"..."}],"steps":["..."],"stepsEn":["..."],"stepsFil":["..."],"stepsId":["..."]}`;

  const attempt = async (extra: string): Promise<SuggestedRecipe | null> => {
    try {
      const resp = await invokeLLM({
        messages: [{ role: "user", content: basePrompt + extra }],
        maxTokens: 4000,
        temperature: 0.7,
        timeoutMs: AI_RECIPE_LLM_TIMEOUT_MS,
        maxRetries: 1,
        enableSearch: false,
        responseFormat: { type: "json_object" },
      });
      const raw = resp.choices?.[0]?.message?.content || "";
      const extracted = extractJSON<Record<string, unknown>>(raw);
      if (!extracted || typeof extracted !== "object" || !extracted.name) {
        console.warn("[AI Chef] meal item bad JSON:", raw.slice(0, 120));
        return null;
      }
      const converted = manuallyConvertRecipes([extracted], undefined, (isDessert || isSoup) ? 4 : 5);
      const recipe = converted[0] ?? null;
      if (recipe && !recipe.dishType) recipe.dishType = expectedType;
      return recipe;
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
    if (isDessert) return t === "dessert";
    if (isCarb) return t === "carb" || String(rec.name || "").match(/麵|面|拉麵|拉面|烏冬|乌冬|米線|米线|意粉|noodle|ramen|udon|soba|pasta/i) !== null;
    return t !== "soup" && t !== "dessert" && t !== "drink";
  };

  // 速度優先：最多 2 次 attempt —— 淨係「類型唔啱」先 retry（唔係「唔新鮮」就 retry，嗰個先係 55s 元兇）。
  // 第一次類型啱就收；類型錯先補一個「強調類型」嘅 hint 再試一次，保證 4 卡結構唔會因為一次失手而缺位。
  let first = await attempt("");
  if (validateType(first)) return first;
  const retryHint = isSoup
    ? "（再強調：你一定要生成一個湯水食譜，名要有「湯」或「羹」字，絕對唔可以係小炒/主菜。）"
    : isVeg
      ? "（再強調：你一定要生成一道純蔬菜菜式，例如蒜蓉炒菜心、清炒西蘭花、上湯浸時蔬，唔可以配肉/海鮮做主食材，唔可以係湯、麵、飯。）"
      : "（再強調：你一定要生成一道主菜/小炒，唔可以係湯、羹、湯麵、飯。）";
  const second = await attempt(retryHint);
  if (validateType(second)) return second;
  // Never drop the slot (that caused missing 3餸1湯 cards / failed single generation).
  // Return the best attempt we have so the meal keeps its card count.
  const fallback = second ?? first;
  console.warn(`[AI Chef] ${expectedType} slot type-invalid — keeping best attempt (no drop)`);
  return fallback;
}

// 3餸1湯 AI 生成：並行 4 個獨立 call（1 湯 + 3 餸），每個 ~8-10s，總時間 ~10s（比起一次過生成 4 個 20-30s 快好多）
async function generateMealRecipesParallel(
  exclude: string[],
  familyId: number | undefined,
  userId: number | undefined,
  dishCount = 3,
  soupCount = 1
): Promise<SuggestedRecipe[]> {
  // 先 1 湯 + 每個「食物類型」各 1（meat/seafood/veg），其餘 dishCount-3 由 other 補
  const types = [
    { label: "肉類主菜（如豬/牛/雞）", expectedType: "meat" as DishType },
    { label: "海鮮/其他蛋白主菜（如魚/蝦/豆腐蛋）", expectedType: "seafood" as DishType },
    { label: "蔬菜/小炒", expectedType: "vegetable" as DishType },
  ];
  const soupTypes = Array.from({ length: Math.min(Math.max(soupCount, 1), 3) }, () =>
    ({ label: "湯水", expectedType: "soup" as DishType }));
  const otherCount = Math.max(0, dishCount - types.length);
  const otherTypes = Array.from({ length: Math.min(otherCount, 5) }, () =>
    ({ label: "家常菜（主食以外，例如豆腐/蛋/豆類/涼菜）", expectedType: "other" as DishType }));
  const allTypes = [...types, ...otherTypes, ...soupTypes];
  // 每個類型並行生成 1 個候選 —— 快（唔會並行太多互相排隊拖慢）。
  const results = await Promise.allSettled(
    allTypes.map(t => generateOneType(t.label, t.expectedType, exclude))
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
  const byType: Record<DishType, SuggestedRecipe[]> = { meat: [], seafood: [], vegetable: [], soup: [], other: [], dessert: [], drink: [], carb: [], appetizer: [] };
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

// Chat/technique should not carry the 3k-token recipe JSON schema. Keep this
// light prompt in sync with the Version A chat-cost budget.
export const LIGHT_CHAT_MAX_TOKENS = 400;
export const LIGHT_CHAT_SYSTEM_PROMPT = `你係 Kindcipe 嘅 AI 廚房助手。用繁體中文簡潔回答煮食、食材、技巧同廚房問題。只提供實用步驟、時間、火候同小貼士；唔好輸出 JSON、食譜卡或長篇食譜。若問題未清楚，先問一個簡短問題。唔確定就老實講唔肯定，唔好亂作。`;

function buildLightChatPrompt(lang: string): string {
  if (lang.startsWith("en")) return `${LIGHT_CHAT_SYSTEM_PROMPT}
Reply in English. Do not output recipe cards or JSON.`;
  if (lang.startsWith("fil")) return `${LIGHT_CHAT_SYSTEM_PROMPT}
Sumagot sa Filipino. Huwag mag-output ng recipe card o JSON.`;
  if (lang.startsWith("id")) return `${LIGHT_CHAT_SYSTEM_PROMPT}
Jawab dalam Bahasa Indonesia. Jangan keluarkan recipe card atau JSON.`;
  return LIGHT_CHAT_SYSTEM_PROMPT;
}

// Build dynamic system prompt based on mode and library context
function buildSystemPrompt(libSummary: string, soupIntent = false, lang = "zh-TW"): string {
  let modeSection = `\n\n你係 AI 助手，一個親切嘅烹飪對話夥伴。判斷用戶意圖：

**如果用戶想食譜**（例如「今晚食咩」、「我想整番茄炒蛋」、「有咩好煮」、「beef」）：
你必須用以下 JSON 格式回覆，唔可以用純文字，因為系統要顯示食譜卡。
每個食譜請同時提供 4 種語言：name（繁中名）、nameEn（英）、nameFil（菲）、nameId（印尼）；每個 ingredient 同樣提供 nameEn/nameFil/nameId；steps 係繁中步驟，同時提供 stepsEn/stepsFil/stepsId（每一步對應）；description 用繁中，同時提供 descriptionEn/descriptionFil/descriptionId。
{"replyText":"...","recipes":[{"name":"...","nameEn":"...","nameFil":"...","nameId":"...","cookTime":30,"servings":4,"difficulty":"簡單","description":"...","descriptionEn":"...","descriptionFil":"...","descriptionId":"...","ingredients":[{"name":"...","nameEn":"...","nameFil":"...","nameId":"...","quantity":"...","unit":"..."}],"steps":["..."],"stepsEn":["..."],"stepsFil":["..."],"stepsId":["..."]}]}

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
    modeSection += `\n\n【回覆語言】請用 ${langName} 撰寫所有對話文字（replyText 及一般回覆）。食譜內容：name 用繁體中文、nameEn 英、nameFil 菲、nameId 印尼；steps 用中文，同時 stepsEn/stepsFil/stepsId；description 同時提供 descriptionEn/descriptionFil/descriptionId。`;
  }
  
  return SYSTEM_PROMPT + modeSection;
}

// 由「最後一條用戶訊息」判斷 3餸N湯/自由要求。只讀最後一條（唔再用成段歷史），
// 令「自由對答」真正聽用戶最新講嘅嘢，唔會被之前任何一句「湯」字綁住。
function detectSoupIntent(messages: Message[]): boolean {
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) return false;
  const text = typeof last.content === "string"
    ? last.content
    : last.content.filter((b) => b.type === "text").map((b) => b.text).join(" ");
  // 用戶明確「唔要湯」→ 唔係湯水意圖
  if (/(唔要湯|不要湯|冇湯|無湯|唔飲湯|no\s*soup|without\s*soup)/i.test(text)) return false;
  return /(湯水|老火湯|滾湯|燉湯|煲湯|湯品|soup|tonic|[\d一二兩三四五六七八九十]+\s*[送餸]\s*湯|[送餸]\s*[\d一二兩三四五六七八九十]+\s*湯|3\s*餸\s*1\s*湯|3\s*菜\s*1\s*湯|三餸一湯|三菜一湯|3 餸 1 湯|3 菜 1 湯|今晚食咩|晚餐推薦|設計晚餐)/i.test(text);
}

// 解析「N送M湯」/「N餸M湯」/自然語言數量（兩個餸/一個菜一個肉/一個菜）→ { dishCount, soupCount }。
// 抽唔到就用 default。允許 soupCount = 0（用戶明確唔要湯）。
function parseMealCount(text: string, defDish = 3, defSoup = 1): { dishCount: number; soupCount: number } {
  const cn: Record<string, number> = { 零: 0, 一: 1, 兩: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const toNum = (s: string): number => {
    const t = s.trim();
    if (!t) return NaN;
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    if (cn[t] != null) return cn[t];
    return NaN;
  };
  // 1) 明確「唔要湯」→ soupCount = 0
  let soup = defSoup;
  if (/(唔要湯|不要湯|冇湯|無湯|唔飲湯|no\s*soup|without\s*soup)/i.test(text)) soup = 0;
  // 2) 「N送M湯」/「N餸M湯」/「N送一湯」—— 容忍空格
  let dish = defDish;
  const m = text.match(/([\d一二兩三四五六七八九十]+)\s*[送餸]\s*(?:([\d一二兩三四五六七八九十]+)\s*湯|湯)/);
  if (m) {
    const d = toNum(m[1]);
    if (!isNaN(d)) dish = Math.max(0, Math.min(d, 10));
    const s = m[2] ? toNum(m[2]) : 1;
    if (!isNaN(s) && soup !== 0) soup = Math.max(1, Math.min(s, 5));
  } else {
    // 3) 自然語言。先用「複合表述」優先（一個菜一個肉→2、兩個餸→2），
    //    再認「N個送/餸/菜/碟」（容忍空格同「2個送」呢種口語）。
    const two = /(兩個餸|二個餸|2個餸|兩道菜|二道菜|2道菜|一個菜\s*一個肉|一菜一肉|一餸一肉|兩個菜|二個菜|兩碟|2\s*個送|兩個送)/.test(text);
    const one = /(淨係一個菜|只要一個菜|一個菜就夠|只要一個|淨係一個|一個就夠)/.test(text);
    if (two) dish = 2;
    else if (one) dish = 1;
    else {
      // 任意「N個/道/碟 送/餸/菜」→ dish=N
      const mm = text.match(/([\d一二兩三四五六七八九十]+)\s*[個道碟]\s*(?:送|餸|菜)/);
      if (mm) { const dd = toNum(mm[1]); if (!isNaN(dd)) dish = Math.max(1, Math.min(dd, 10)); }
      else {
        // 「N個送」冇「個」隔住中間都試：淨係數字+送/餸
        const m2 = text.match(/([\d一二兩三四五六七八九十]+)\s*(?:送|餸|碟)/);
        if (m2) { const dd = toNum(m2[1]); if (!isNaN(dd) && dd >= 1) dish = Math.max(1, Math.min(dd, 10)); }
      }
    }
  }
  return { dishCount: dish, soupCount: soup };
}

// 綜合意圖：回傳 { isMeal, dishCount, soupCount }。isMeal = 用戶想要一餐（湯水/N餸N湯/今晚食咩）。

function parseMealIntent(messages: Message[]): { isMeal: boolean; dishCount: number; soupCount: number } {
  const last = [...messages].reverse().find((m) => m.role === "user");
  const text = last ? (typeof last.content === "string" ? last.content : last.content.filter((b) => b.type === "text").map((b) => b.text).join(" ")) : "";
  const soupIntent = detectSoupIntent(messages);
  // 抽到明確數量（即使冇湯字，例如「兩個餸」/「2個送」）都算 meal 要求
  const count = parseMealCount(text, 3, soupIntent ? 1 : 0);
  const hasCount = /[送餸]\s*(?:[\d一二兩三四五六七八九十]+\s*)?湯|[\d一二兩三四五六七八九十]+\s*[個道碟]\s*[送餸菜]|兩個餸|二個餸|兩個菜|兩道菜|一個菜\s*一個肉|一個菜|一菜一肉|2\s*個送/.test(text);
  // 淨係講「唔要湯」都算一餐（冇湯），預設 3 餸
  const wantsNoSoupMeal = /(唔要湯|不要湯|冇湯|無湯|唔飲湯)/.test(text);
  const isMeal = soupIntent || hasCount || wantsNoSoupMeal;
  return { isMeal, dishCount: count.dishCount, soupCount: count.soupCount };
}

// 由 prompt/文字抽「幾多人食」（適合 N 人食用 / N 人份）→ 用作卡片 servings 覆蓋
function extractPeopleCount(text: string): number | null {
  const cn: Record<string, number> = { 一: 1, 兩: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const m = text.match(/([\d一二兩三四五六七八九十]+)\s*(?:人份|人食用|人食|人)/);
  if (!m) return null;
  const t = m[1];
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  return cn[t] ?? null;
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
    soupType: readField([/(?:湯類型|湯種|類型|Soup\s*Type)[：:]\s*([^\n]+)/i]),    benefits: readField([/(?:功效|Benefits?)[：:]\s*([^\n]+)/i]),
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
{"replyText":"...","recipes":[{"name":"...","nameEn":"...","nameFil":"...","nameId":"...","cookTime":30,"servings":4,"difficulty":"簡單","description":"...","descriptionEn":"...","descriptionFil":"...","descriptionId":"...","ingredients":[{"name":"...","nameEn":"...","nameFil":"...","nameId":"...","quantity":"...","unit":"..."}],"steps":["..."],"stepsEn":["..."],"stepsFil":["..."],"stepsId":["..."]}]}

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
  forceJson = false,
  opts: { maxTokens?: number; timeoutMs?: number } = {}
): Promise<{ finalContent: string; allMessages: Message[]; finishReason: string }> {
  const db = await getDb();
  const MAX_ITER = 3;

  for (let i = 0; i < MAX_ITER; i++) {
    let llmResp;
    try {
      llmResp = await invokeLLM({
        messages,
        maxTokens: opts.maxTokens ?? AI_RECIPE_MAX_TOKENS,
        temperature: 0.5,
        timeoutMs: opts.timeoutMs ?? AI_RECIPE_LLM_TIMEOUT_MS,
        enableSearch: enableSearch ?? true,
        tools: enableSearch && i === 0 ? TOOLS as any : undefined,
        responseFormat: forceJson ? { type: "json_object" } : undefined,
      });
    } catch (err) {
      console.warn("[AI Chef] LLM call failed:", err);
      messages.push({ role: "assistant", content: AI_RECIPE_FALLBACK_CONTENT });
      return { finalContent: AI_RECIPE_FALLBACK_CONTENT, allMessages: messages, finishReason: "error" };
    }

    const choice = llmResp.choices[0];
    if (!choice) return { finalContent: "", allMessages: messages, finishReason: "empty" };

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
      return { finalContent: content, allMessages: messages, finishReason: String(choice.finish_reason ?? "stop") };
    }
  }

  messages.push({ role: "assistant", content: AI_RECIPE_FALLBACK_CONTENT });
  return { finalContent: AI_RECIPE_FALLBACK_CONTENT, allMessages: messages, finishReason: "max_iterations" };
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

/**
 * Fill en/fil/id for a SuggestedRecipe (name/description/steps/ingredients)
 * when missing — dictionary-first for ingredients, LLM for the rest. Never throws.
 */
const containsCjk = (value: unknown): boolean => /[\u3400-\u9FFF\uF900-\uFAFF]/.test(String(value ?? ""));
const hasTargetText = (value: unknown): boolean => {
  const text = String(value ?? "").trim();
  return text.length > 0 && !containsCjk(text);
};
const hasTargetSteps = (steps: unknown): boolean =>
  Array.isArray(steps) && steps.length > 0 && steps.every((step) => hasTargetText(step));

async function localizeSuggestedRecipe(rec: SuggestedRecipe): Promise<SuggestedRecipe> {
  if (!rec) return rec;
  try {
    const needName = !hasTargetText(rec.nameEn) || !hasTargetText(rec.nameFil) || !hasTargetText(rec.nameId);
    const steps = Array.isArray(rec.steps) ? rec.steps : [];
    const needSteps = steps.length > 0 && (!hasTargetSteps(rec.stepsEn) || !hasTargetSteps(rec.stepsFil) || !hasTargetSteps(rec.stepsId));
    const needDesc = !!rec.description && (!hasTargetText(rec.descriptionEn) || !hasTargetText(rec.descriptionFil) || !hasTargetText(rec.descriptionId));
    if (needName || needSteps || needDesc) {
      const tr = await translateRecipeContent(rec.name || "", steps, rec.description || "");
      if (needName) {
        if (!hasTargetText(rec.nameEn)) rec.nameEn = tr.nameEn;
        if (!hasTargetText(rec.nameFil)) rec.nameFil = tr.nameFil;
        if (!hasTargetText(rec.nameId)) rec.nameId = tr.nameId;
      }
      if (needDesc) {
        if (!hasTargetText(rec.descriptionEn)) rec.descriptionEn = tr.descriptionEn;
        if (!hasTargetText(rec.descriptionFil)) rec.descriptionFil = tr.descriptionFil;
        if (!hasTargetText(rec.descriptionId)) rec.descriptionId = tr.descriptionId;
      }
      if (needSteps) {
        if (!hasTargetSteps(rec.stepsEn)) rec.stepsEn = tr.stepsEn;
        if (!hasTargetSteps(rec.stepsFil)) rec.stepsFil = tr.stepsFil;
        if (!hasTargetSteps(rec.stepsId)) rec.stepsId = tr.stepsId;
      }
    }
    const ings = Array.isArray(rec.ingredients) ? rec.ingredients : [];
    if (ings.some((i: any) => i?.name && (!i.nameEn || !i.nameFil || !i.nameId))) {
      const merged = await localizeIngredientNames(ings);
      if (merged) rec.ingredients = merged as any;
    }
  } catch (e) {
    console.warn("[localizeSuggestedRecipe] failed:", (e as Error)?.message);
  }
  return rec;
}

/**
 * Batch version of localizeSuggestedRecipe for a multi-recipe AI response.
 * Recipe name/description/steps still need one translation call per recipe, but
 * ingredient names are deduped and translated in ONE call across the whole meal.
 */
async function localizeSuggestedRecipes(
  recipes: SuggestedRecipe[],
  lang?: string
): Promise<SuggestedRecipe[]> {
  if (!recipes || recipes.length === 0) return recipes;
  const localizeStartedAt = Date.now();
  const target = lang?.startsWith("en") ? "en" : lang?.startsWith("fil") ? "fil" : lang?.startsWith("id") ? "id" : null;

  if (target) {
    const missing: Array<{ index: number; name: string; description?: string; steps: string[] }> = [];
    for (let i = 0; i < recipes.length; i++) {
      const rec = recipes[i];
      if (!rec) continue;
      const steps = Array.isArray(rec.steps) ? rec.steps : [];
      const hasName = target === "en" ? hasTargetText(rec.nameEn) : target === "fil" ? hasTargetText(rec.nameFil) : hasTargetText(rec.nameId);
      const hasSteps = target === "en" ? hasTargetSteps(rec.stepsEn) : target === "fil" ? hasTargetSteps(rec.stepsFil) : hasTargetSteps(rec.stepsId);
      if (hasName && hasSteps) continue;
      missing.push({ index: i, name: rec.name || "", description: rec.description, steps });
    }
    if (missing.length > 0) {
      const translated = await translateRecipesForLang(missing, target);
      for (let j = 0; j < missing.length; j++) {
        const rec = recipes[missing[j].index];
        const tr = translated[j];
        if (!rec || !tr) continue;
        if (target === "en") {
          if (!hasTargetText(rec.nameEn) && hasTargetText(tr.name)) rec.nameEn = tr.name;
          if (!hasTargetText(rec.descriptionEn) && hasTargetText(tr.description)) rec.descriptionEn = tr.description;
          if (!hasTargetSteps(rec.stepsEn) && tr.steps?.every((x) => hasTargetText(x))) rec.stepsEn = tr.steps;
        } else if (target === "fil") {
          if (!hasTargetText(rec.nameFil) && hasTargetText(tr.name)) rec.nameFil = tr.name;
          if (!hasTargetText(rec.descriptionFil) && hasTargetText(tr.description)) rec.descriptionFil = tr.description;
          if (!hasTargetSteps(rec.stepsFil) && tr.steps?.every((x) => hasTargetText(x))) rec.stepsFil = tr.steps;
        } else {
          if (!hasTargetText(rec.nameId) && hasTargetText(tr.name)) rec.nameId = tr.name;
          if (!hasTargetText(rec.descriptionId) && hasTargetText(tr.description)) rec.descriptionId = tr.description;
          if (!hasTargetSteps(rec.stepsId) && tr.steps?.every((x) => hasTargetText(x))) rec.stepsId = tr.steps;
        }
      }
    }
  } else {
    await Promise.all(recipes.map(async (rec) => {
      if (!rec) return;
      try {
        const needName = !hasTargetText(rec.nameEn) || !hasTargetText(rec.nameFil) || !hasTargetText(rec.nameId);
        const steps = Array.isArray(rec.steps) ? rec.steps : [];
        const needSteps = steps.length > 0 && (!hasTargetSteps(rec.stepsEn) || !hasTargetSteps(rec.stepsFil) || !hasTargetSteps(rec.stepsId));
        const needDesc = !!rec.description && (!hasTargetText(rec.descriptionEn) || !hasTargetText(rec.descriptionFil) || !hasTargetText(rec.descriptionId));
        if (!needName && !needSteps && !needDesc) return;
        const tr = await translateRecipeContent(rec.name || "", steps, rec.description || "");
        if (needName) { rec.nameEn = rec.nameEn || tr.nameEn; rec.nameFil = rec.nameFil || tr.nameFil; rec.nameId = rec.nameId || tr.nameId; }
        if (needDesc) {
          rec.descriptionEn = rec.descriptionEn || tr.descriptionEn;
          rec.descriptionFil = rec.descriptionFil || tr.descriptionFil;
          rec.descriptionId = rec.descriptionId || tr.descriptionId;
        }
        if (needSteps) {
          rec.stepsEn = rec.stepsEn?.length ? rec.stepsEn : tr.stepsEn;
          rec.stepsFil = rec.stepsFil?.length ? rec.stepsFil : tr.stepsFil;
          rec.stepsId = rec.stepsId?.length ? rec.stepsId : tr.stepsId;
        }
      } catch (e) {
        console.warn("[localizeSuggestedRecipes] recipe translation failed:", (e as Error)?.message);
      }
    }));
  }

  const recipeTranslationMs = Date.now() - localizeStartedAt;
  const ingredientStartedAt = Date.now();
  const unique = new Map<string, { name: string }>();
  for (const rec of recipes) {
    for (const ing of (Array.isArray(rec.ingredients) ? rec.ingredients : []) as any[]) {
      const name = String(ing?.name ?? "").trim();
      if (!name || (ing.nameEn && ing.nameFil && ing.nameId)) continue;
      unique.set(name.toLowerCase(), { name });
    }
  }
  if (unique.size > 0) {
    try {
      const localized = await localizeIngredientNames([...unique.values()]);
      if (localized) {
        const byName = new Map(localized.map((ing: any) => [String(ing?.name ?? "").trim().toLowerCase(), ing]));
        for (const rec of recipes) {
          if (!Array.isArray(rec.ingredients)) continue;
          rec.ingredients = rec.ingredients.map((ing: any) => {
            const hit = byName.get(String(ing?.name ?? "").trim().toLowerCase());
            if (!hit) return ing;
            return {
              ...ing,
              nameEn: ing.nameEn || hit.nameEn,
              nameFil: ing.nameFil || hit.nameFil,
              nameId: ing.nameId || hit.nameId,
            };
          });
        }
      }
    } catch (e) {
      console.warn("[localizeSuggestedRecipes] ingredient translation failed:", (e as Error)?.message);
    }
  }
  console.log(`[AI Chef] localize recipesMs=${recipeTranslationMs} ingredientMs=${Date.now() - ingredientStartedAt} recipes=${recipes.length}`);
  return recipes;
}

const SMALL_TALK_RE = /^(hi|hello|hey|how are (you|u)|how r u|i am (so )?sad|i'?m (so )?sad|feeling sad|thanks|thank you|thx|ok|okay|多謝|謝謝|唔該|你好|您好|早晨|晚安|好|好的|得|收到)[.!?。！？\s]*$/i;
const AMBIGUOUS_FOOD_RE = /(我唔知|唔知|隨便|求其|你話事|食咩好|煮咩好|有咩好|i don'?t know|not sure|surprise me|help me decide)/i;

function smallTalkReply(lang: string): string {
  if (lang.startsWith("en")) return "I'm here. Tell me what ingredients you have, or what kind of meal you want, and I'll help.";
  if (lang.startsWith("fil")) return "Narito ako. Sabihin mo kung anong ingredients ang meron ka, o anong klaseng ulam ang gusto mo.";
  if (lang.startsWith("id")) return "Saya di sini. Beri tahu bahan yang ada atau jenis masakan yang Anda inginkan.";
  return "我喺度。可以話我知你有咩食材，或者想食邊類型嘅菜，我幫你諗。";
}

function clarifyFoodReply(lang: string): string {
  if (lang.startsWith("en")) return "Sure — do you want Chinese, Western, quick, or light? And how many people?";
  if (lang.startsWith("fil")) return "Sige — gusto mo ba ng Chinese, Western, mabilis, o light? Ilang tao?";
  if (lang.startsWith("id")) return "Boleh — mau Chinese, Western, cepat, atau ringan? Untuk berapa orang?";
  return "好呀 — 你想中式、西式、快煮，定清淡？幾多人食？";
}

function libraryMissReply(lang: string, item: string, alternatives: string[]): string {
  const alt = alternatives.filter(Boolean).slice(0, 3).join("、") || "暫時冇相近庫存";
  if (lang.startsWith("en")) {
    return `I couldn't find "${item}" in the library. You can: 1) use Import recipe (uses 1 import quota), 2) look at the closest library items: ${alt}, or 3) ask AI to make it now (1 credit).`;
  }
  if (lang.startsWith("fil")) {
    return `Wala sa library ang "${item}". Maaari mong: 1) gamitin ang Import recipe (1 import quota), 2) tingnan ang pinakamalapit na library: ${alt}, o 3) hilingin sa AI na gawin ito ngayon (1 credit).`;
  }
  if (lang.startsWith("id")) {
    return `Tidak ada "${item}" di pustaka. Anda bisa: 1) memakai Import resep (1 kuota import), 2) melihat resep pustaka terdekat: ${alt}, atau 3) meminta AI membuatnya sekarang (1 credit).`;
  }
  return `我未有你指定嘅「${item}」食譜。你可以：
1. 去「匯入食譜」（會扣 1 次匯入額度）
2. 睇最接近嘅庫存：${alt}
3. AI 即場煮（1 credit）`;
}

function searchFailureReply(lang: string): string {
  if (lang.startsWith("en")) return "The recipe library search failed just now. I won't guess. You can retry, ask AI to make it now (1 credit), or try again later.";
  if (lang.startsWith("fil")) return "Nabigo ang paghahanap sa library. Huwag akong manghula. Maaari mong subukan muli, hilingin sa AI na gawin ito ngayon (1 credit), o bumalik mamaya.";
  if (lang.startsWith("id")) return "Pencarian pustaka gagal. Saya tidak akan menebak. Anda bisa mencoba lagi, meminta AI membuatnya sekarang (1 credit), atau mencoba lagi nanti.";
  return "我今次搜尋食譜庫失敗，未敢亂出卡。你可以重試、叫 AI 即場煮（1 credit），或者稍後再試。";
}

function categoryMissReply(lang: string, item: string, cards: string[]): string {
  const names = cards.filter(Boolean).slice(0, 3).join("、") || "暫時冇相近庫存";
  if (lang.startsWith("en")) return `I couldn't find a "${item}" match. Closest: ${names}. You can ask AI to make one (1 credit).`;
  if (lang.startsWith("fil")) return `Wala akong makitang "${item}". Pinakamalapit: ${names}. Maaari mong hilingin sa AI (1 credit).`;
  if (lang.startsWith("id")) return `Tidak ada padanan untuk "${item}". Terdekat: ${names}. Anda bisa meminta AI (1 credit).`;
  return `庫存冇「${item}」嘅合適選擇。最接近：${names}。可以叫 AI 即場煮（1 credit）。`;
}

function ingredientMissReply(lang: string, item: string, cards: string[]): string {
  const names = cards.filter(Boolean).slice(0, 3).join("、") || "暫時冇相近庫存";
  if (lang.startsWith("en")) return `The library has no "${item}". Closest similar dishes: ${names}. You can also ask AI to make it now (1 credit).`;
  if (lang.startsWith("fil")) return `Wala sa library ang "${item}". Pinakamalapit: ${names}. Maaari mo ring hilingin sa AI na gawin ito ngayon (1 credit).`;
  if (lang.startsWith("id")) return `Tidak ada "${item}" di pustaka. Yang terdekat: ${names}. Anda juga bisa meminta AI membuatnya sekarang (1 credit).`;
  return `庫存冇「${item}」，以下係同類食譜：${names}。亦可以叫 AI 即場煮（1 credit）。`;
}

export async function processAIChefChat(
  inputMessages: Array<{ role: string; content: string | Array<TextContent | ImageContent> }>,
  familyId?: number,
  userId?: number,
  mode: "chat" | "ai" | "library" = "chat",
  excludeNames: string[] = [],
  search?: { query?: string; tags?: string[]; cookTimeMax?: number; category?: string; count?: number; rank?: "shortestTime" | "default"; excludeCategories?: string[]; scenario?: string },
  lang: string = "zh-TW",
  avoidIngredients: string[] = [],
  forceText: boolean = false,
  featureFlags: {
    ai_chef_single_card_library?: boolean;
    ai_chef_any_library_miss_offer?: boolean;
  } = {},
  operation: "replace" | "append" = "replace",
  allowAiFallback: boolean = true,
  allowChatLlm: boolean = true,
  searchOverride?: (query: string, limit: number, cookTimeMax?: number) => Promise<Record<string, unknown>[]>,
  dispatchOverride?: (messages: Array<{ role: string; content: string }>) => Promise<ChefDispatch | null>,
): Promise<{ content: string; recipes: SuggestedRecipe[]; llmUsed: boolean; missingRoles?: RequestedRole[]; clarifyReason?: "ambiguous_food" | "library_miss" | "ingredient_miss" | "ai_failed" | "ai_partial" | "lib_search_fail"; intentOverride?: ChefIntent }> {
  // llmUsed: 呢次請求有冇真係 call 過 LLM（router 用嚟扣 quota —— 純食譜庫唔扣）
  let llmUsed = false;
  // Actual role shortfall from the assembler (router uses this instead of
  // guessing by slicing the requested roles).
  let resultMissingRoles: RequestedRole[] | null = null;

  // FAQ must not wait for seen/trending DB queries. Keep this before the DB
  // warm-up so verified technique answers stay <50ms.
  const earlyUserMsg = inputMessages.filter((m) => m.role === "user").pop();
  const earlyUserText = typeof earlyUserMsg?.content === "string"
    ? earlyUserMsg.content.trim()
    : Array.isArray(earlyUserMsg?.content)
      ? earlyUserMsg.content.filter((b) => b.type === "text").map((b: any) => b.text).join(" ").trim()
      : "";
  const requestItemLog = extractMealIngredients(earlyUserText).join("|") || "none";
  console.log(`[AI Chef] req mode=${mode} lang=${lang} items=${requestItemLog}`);
  if (earlyUserText) {
    const earlyIntent = resolveChefIntent(earlyUserText, { mode, forceText, noodleRole: AI_CHEF_NOODLE_ROLE });
    if (!earlyIntent.wantsCards) {
      const faq = lookupFaqAnswer(earlyUserText);
      if (faq) {
        console.log(`[AI Chef] faq hit early query="${earlyUserText}"`);
        return { content: faq, recipes: [], llmUsed: false };
      }
    }
  }
  // Fix2: 合併後端自己記住嘅已推薦名單（唔靠前端 state），確保去重一定生效
  const seenSplit = await getFamilySeenNamesSplit(familyId);
  const fusedOfficial = [...new Set([...excludeNames, ...seenSplit.seen7d])];
  const mergedExclude = [...fusedOfficial];
  // 參考「熱門」風格 + 唔重複：攞近期熱門菜名，加入 exclude（AI 唔會出返呢啲），
  // 並生成一段「流行風格」hint 注入 prompt，令 AI 生成偏向多人食嘅家常菜（似 Gemini AI Overview）。
  let popularHint = "";
  let trendingNames: string[] = [];
  try {
    const trending = await getTrendingRecipes(7, 15);
    if (trending.length > 0) {
      trendingNames = trending.map(t => t.recipeName).filter(Boolean);
      // 熱門菜名加入 exclude → AI 唔會出返（微調生成新版本，唔重複）
      mergedExclude.push(...trendingNames);
      popularHint = `參考以下近期人氣/熱門家常菜嘅風格（但唔好直接出返呢啲名，要微調生成全新、唔重複嘅版本）：${trendingNames.slice(0, 8).join("、")}`;
    }
  } catch (e) {
    console.warn("[AI Chef] trending fetch failed:", (e as Error)?.message);
  }
  // Source-aware exclusion for library picking: official → 7d (+trending), custom → 1d.
  const excludeSets: ExcludeSets = mkExcludeSets(
    [...fusedOfficial, ...trendingNames],
    [...new Set([...excludeNames, ...seenSplit.seen1d])],
  );
  const textOf = (m: any): string =>
    typeof m?.content === "string"
      ? m.content
      : Array.isArray(m?.content)
        ? m.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ")
        : "";
  const lastUserMsg = inputMessages.filter(m => m.role === "user").pop();
  const lastUserText = textOf(lastUserMsg).trim();
  const previousText = previousUserText(inputMessages);
  // 淨係睇「最後一條 user 訊息」有冇圖片（唔睇成個 history，避免影相後所有 call 都被誤判）
  const hasImage = Array.isArray(lastUserMsg?.content) && lastUserMsg.content.some((c: any) => c.type === "image_url");

  // Single source of truth for free-text intent. `forceText` is legacy and no
  // longer allowed to override a clear food request. A short follow-up such as
  // 「比另一set我」inherits the preceding meal shape.
  let chefIntent: ChefIntent = resolveChefIntent(lastUserText, { hasImage, mode, forceText, noodleRole: AI_CHEF_NOODLE_ROLE, previousUserText: previousText });
  let requestedCount = chefIntent.requested.total > 0 ? chefIntent.requested.total : null;
  let forceNoCards = hasImage || !chefIntent.wantsCards;
  let isPlain = !chefIntent.wantsCards;
  let wantCards = !forceNoCards;
  const smallTalk = !hasImage && SMALL_TALK_RE.test(lastUserText.trim());
  const ambiguousFood = !hasImage && !smallTalk && AMBIGUOUS_FOOD_RE.test(lastUserText.trim());
  if (smallTalk) {
    return { content: smallTalkReply(lang), recipes: [], llmUsed: false };
  }
  if (ambiguousFood) {
    return { content: clarifyFoodReply(lang), recipes: [], llmUsed: false };
  }
  // Verified FAQ answers are always free and work even when chat quota is low.
  if (!wantCards) {
    const faq = lookupFaqAnswer(lastUserText);
    if (faq) {
      console.log(`[AI Chef] faq hit query="${lastUserText}"`);
      return { content: faq, recipes: [], llmUsed: false };
    }
  }

  const db = await getDb();

  // ── 本機 helpers ─────────────────────────────────────────────
  type RecipeSearchResult =
    | { ok: true; rows: Record<string, unknown>[] }
    | { ok: false; reason: "timeout" | "throw" };
  let searchFailed = false;
  const trySearch = async (query: string, limit = 24, cookTimeMax?: number): Promise<RecipeSearchResult> => {
    if (searchOverride) {
      try {
        const rows = await searchOverride(query, limit, cookTimeMax);
        return { ok: true, rows };
      } catch (error) {
        const message = String((error as Error)?.message ?? error);
        return { ok: false, reason: /timeout/i.test(message) ? "timeout" : "throw" };
      }
    }
    // No DB is a harness/no-DB mode; preserve legacy auto-LLM behaviour there.
    // Real transient DB failures/timeouts still return ok:false.
    if (!db) return { ok: true, rows: [] };
    const startedAt = Date.now();
    const run = () => withTimeout(execSearchRecipes(db, { query, limit, cookTimeMax }, familyId), 8000, "lib search");
    try {
      const res = await run();
      const rows = (res.recipes || []) as Record<string, unknown>[];
      console.log(`[AI Chef] lib search query="${query}" limit=${limit} rows=${rows.length} time=${Date.now() - startedAt}ms`);
      return { ok: true, rows };
    } catch (firstError) {
      console.warn(`[AI Chef] lib search failed after ${Date.now() - startedAt}ms; retrying once:`, firstError);
      try {
        const res = await run();
        const rows = (res.recipes || []) as Record<string, unknown>[];
        console.log(`[AI Chef] lib search retry query="${query}" limit=${limit} rows=${rows.length} time=${Date.now() - startedAt}ms`);
        return { ok: true, rows };
      } catch (retryError) {
        searchFailed = true;
        const message = String((retryError as Error)?.message ?? retryError);
        const reason = /timeout/i.test(message) ? "timeout" : "throw";
        console.warn(`[AI Chef] lib search failed permanently query="${query}" reason=${reason}:`, retryError);
        return { ok: false, reason };
      }
    }
  };
  const rowsOrEmpty = (result: RecipeSearchResult, label: string): Record<string, unknown>[] => {
    if (result.ok) return result.rows;
    searchFailed = true;
    console.warn(`[AI Chef] lib_search_fail label=${label} reason=${result.reason}`);
    return [];
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
  const rowsToSuggested = (rows: Record<string, unknown>[], ex: ExcludeSets, count: number): SuggestedRecipe[] => {
    const fresh: SuggestedRecipe[] = [];
    const reused: SuggestedRecipe[] = [];
    for (const r of rows) {
      const name = String(r?.name ?? "").trim();
      if (!name || name.length < 2) continue;
      const steps = (Array.isArray(r?.steps) ? r.steps : [])
        .map((s: any) => typeof s === "string" ? s : String(s?.instruction ?? s?.text ?? s ?? ""))
        .map((t: string) => t.trim()).filter(Boolean);
      if (steps.length === 0) continue;
      const stepsOf = (v: unknown): string[] | undefined => {
        const arr = Array.isArray(v) ? v : [];
        const out = arr.map((s: any) => typeof s === "string" ? s : String(s?.instruction ?? s?.text ?? s ?? "")).map((t: string) => t.trim()).filter(Boolean);
        return out.length > 0 ? out : undefined;
      };
      const str = (v: unknown): string | undefined => {
        const s = String(v ?? "").trim();
        return s ? s : undefined;
      };
      const official = r.source === "official";
      const rec: SuggestedRecipe = {
        name,
        nameEn: str(r?.nameEn),
        nameFil: str(r?.nameFil),
        nameId: str(r?.nameId),
        description: String(r?.description ?? "").trim(),
        descriptionEn: str(r?.descriptionEn),
        descriptionFil: str(r?.descriptionFil),
        descriptionId: str(r?.descriptionId),
        cookTime: Number(r?.cookTime ?? 30) || 30,
        servings: Number(r?.servings ?? 4) || 4,
        difficulty: (String(r?.difficulty ?? "medium")) as "easy" | "medium" | "hard",
        ingredients: (Array.isArray(r?.ingredients) ? r.ingredients : []).map((i: any) => ({
          name: String(i?.name ?? "").trim(),
          nameEn: str(i?.nameEn),
          nameFil: str(i?.nameFil),
          nameId: str(i?.nameId),
          quantity: String(i?.quantity ?? "").trim(),
          unit: String(i?.unit ?? "").trim(),
        })).filter(x => x.name),
        steps,
        stepsEn: stepsOf(r?.stepsEn),
        stepsFil: stepsOf(r?.stepsFil),
        stepsId: stepsOf(r?.stepsId),
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
      (isRowExcluded(ex, r) ? reused : fresh).push(rec);
    }
    // 優先非排除，池盡先翻兜（永遠有卡）
    return [...shuffleArr(fresh), ...shuffleArr(reused)].slice(0, count);
  };

// 由句子抽 keyword（剷走口語填充字＋數字）；抽唔到 → 空 = 用 generic 池
  const cleanFoodQuery = (raw: string): string => {
    const q = raw
      .replace(/[。，、！？!?.,;；：:…\s]+/g, " ")
      .replace(/[0-9]+/g, " ")
      // 拉丁語系虛詞（菲/印尼/英）：用 \b 避免誤刪內容字（例如 bawang 內嘅 "ng"）
      .replace(/\b(gusto|ko|mo|ng|namin|natin|ang|mga|at|pwede|puwede|ba|ano|anong|sa|para|ngayon|ako|kami|tayo|po|lang|din|rin|yung|ito|iyon|may|meron|walang|saya|aku|mau|ingin|untuk|dengan|dan|atau|yang|di|ke|ini|itu|ada|tidak|tanpa|bisa|tolong|kasih|beri|apa|gimana|bagaimana|dong)\b/gi, " ")
      .replace(/(我|我想|想要|要|嚟|幫我|請|希望|可以|可否|推薦|推介|介紹|提供|搵|選|選擇|整個|煮個|煮|整|食譜庫|唔同|唔該|今晚|今日|早餐|午餐|晚餐|宵夜|有咩|有乜|咩|乜|乜嘢|咩嘢|嗎|呢|呀|啊|喔|哦|啦|喎|please|give|me|some|for|tonight|dinner|lunch|breakfast|today|recommend|suggest|suggestion|recipes|food|what|to|eat|cook|make|want|\bi\b|和|同|同埋|又|仲有|還有|或者|定係|邊個|邊種|好唔好|想|要|諗|好|食|吃|下|哋)/gi, " ")
       .trim();
    return q.length >= 2 ? q : "";
  };

  // Dispatcher path: free-text chat is understood by the model first; this
  // replaces the old per-sentence rule path for normal conversation.
  const hasDispatcherKey = Boolean(process.env.DASHSCOPE_API_KEY || process.env.GEMINI_API_KEY);
  const dispatcherEnabled = mode === "chat"
    && Boolean(db)
    && allowChatLlm
    && (hasDispatcherKey || Boolean(dispatchOverride))
    && !hasImage
    && !forceText
    && !isCannedMealPrompt(lastUserText)
    && !smallTalk
    && !ambiguousFood;
  if (dispatcherEnabled) {
    const dispatcherMessages = inputMessages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string"
        ? m.content
        : m.content.filter((b) => b.type === "text").map((b: any) => b.text).join(" "),
    }));
    const dispatch = dispatchOverride
      ? await dispatchOverride(dispatcherMessages)
      : await dispatchChefTurn(dispatcherMessages);
    if (!dispatch) {
      return {
        content: lang.startsWith("en")
          ? "I'm not sure I understood that. Tell me what you'd like to eat, or which dish you mean."
          : "我唔係好肯定你想食咩。你可以講多少少，例如想食邊款、幾多人、或者有咩食材。",
        recipes: [],
        llmUsed: true,
        clarifyReason: "ai_failed",
      };
    }
    const dispatchItems = dispatch.items;
    const dispatchTotal = Math.max(1, dispatchItems.reduce((sum, item) => sum + item.qty, 0));
    const dispatchRoles: RequestedRole[] = [];
    for (const item of dispatchItems) {
      const role = item.kind === "ingredient" ? roleForFoodTerm(item.label) : "any";
      for (let i = 0; i < item.qty; i++) dispatchRoles.push(role);
    }
    const dispatchIntent: ChefIntent = {
      kind: dispatchTotal > 1 ? "meal" : dispatch.intent === "technique" ? "technique" : dispatch.intent === "chat" || dispatch.intent === "non_food" || dispatch.intent === "action" ? "chat" : "recipe",
      wantsCards: dispatch.intent === "cards",
      requested: { total: dispatch.intent === "cards" ? dispatchTotal : 0, roles: dispatch.intent === "cards" ? dispatchRoles : [] },
      confidence: dispatch.confidence,
      reason: "dispatcher",
    };
    if (dispatch.ask.needed || dispatch.confidence < 0.7) {
      return {
        content: dispatch.ask.question || dispatch.replyText || (lang.startsWith("en") ? "Can you tell me a bit more?" : "你可以講多少少嗎？"),
        recipes: [],
        llmUsed: true,
        clarifyReason: "ambiguous_food",
        intentOverride: { ...dispatchIntent, kind: "clarify", wantsCards: false, requested: { total: 0, roles: [] } },
      };
    }
    if (dispatch.intent === "technique" || dispatch.intent === "chat" || dispatch.intent === "non_food" || dispatch.intent === "action") {
      return {
        content: dispatch.replyText || (lang.startsWith("en") ? "Tell me what you'd like to eat." : "話我知你想食咩。"),
        recipes: [],
        llmUsed: true,
        intentOverride: { ...dispatchIntent, kind: dispatch.intent === "technique" ? "technique" : "chat", wantsCards: false, requested: { total: 0, roles: [] } },
      };
    }
    if (dispatchItems.length === 0) {
      return {
        content: dispatch.replyText || (lang.startsWith("en") ? "What would you like to eat?" : "你想食咩？"),
        recipes: [],
        llmUsed: true,
        clarifyReason: "ambiguous_food",
        intentOverride: { ...dispatchIntent, kind: "clarify", wantsCards: false, requested: { total: 0, roles: [] } },
      };
    }

    const pickedCards: SuggestedRecipe[] = [];
    const usedNames = new Set<string>();
    for (const item of dispatchItems) {
      const search = await trySearch(item.label, Math.max(20, item.qty * 5));
      if (!search.ok) {
        return {
          content: searchFailureReply(lang),
          recipes: [],
          llmUsed: true,
          clarifyReason: "lib_search_fail",
          intentOverride: { ...dispatchIntent, kind: "clarify", wantsCards: false, requested: { total: 0, roles: [] } },
        };
      }
      const normalizedLabel = normalizeName(item.label);
      const exact = search.rows.filter((row) => normalizeName(String(row.name ?? "")) === normalizedLabel);
      const candidates = exact.length > 0
        ? exact
        : search.rows.filter((row) => {
            const rowName = normalizeName(String(row.name ?? ""));
            return normalizedLabel.length >= 2 && (rowName.includes(normalizedLabel) || normalizedLabel.includes(rowName));
          });
      if (candidates.length === 0) {
        const alternatives = search.rows.map((row) => String(row.name ?? "")).filter(Boolean).slice(0, 3);
        if (item.kind === "dish") {
          return { content: libraryMissReply(lang, item.label, alternatives), recipes: [], llmUsed: true, clarifyReason: "library_miss", intentOverride: { ...dispatchIntent, kind: "clarify", wantsCards: false, requested: { total: 0, roles: [] } } };
        }
        if (item.kind === "ingredient") {
          return { content: ingredientMissReply(lang, item.label, alternatives), recipes: [], llmUsed: true, clarifyReason: "ingredient_miss", intentOverride: { ...dispatchIntent, kind: "clarify", wantsCards: false, requested: { total: 0, roles: [] } } };
        }
        return { content: categoryMissReply(lang, item.label, alternatives), recipes: [], llmUsed: true, clarifyReason: "ingredient_miss", intentOverride: { ...dispatchIntent, kind: "clarify", wantsCards: false, requested: { total: 0, roles: [] } } };
      }
      const selected = candidates
        .filter((row) => !usedNames.has(normalizeName(String(row.name ?? ""))))
        .slice(0, item.kind === "category" ? Math.max(1, item.qty) : 1);
      for (const row of selected) {
        const nameKey = normalizeName(String(row.name ?? ""));
        if (usedNames.has(nameKey)) continue;
        usedNames.add(nameKey);
      }
      pickedCards.push(...rowsToSuggested(selected, excludeSets, selected.length));
    }
    const cards = pickedCards.slice(0, Math.max(dispatchItems.reduce((n, item) => n + item.qty, 0), 1));
    if (cards.length === 0) {
      return {
        content: dispatch.replyText || (lang.startsWith("en") ? "I couldn't find a suitable card." : "我搵唔到合適嘅食譜卡。"),
        recipes: [],
        llmUsed: true,
        clarifyReason: "library_miss",
        intentOverride: { ...dispatchIntent, kind: "clarify", wantsCards: false, requested: { total: 0, roles: [] } },
      };
    }
    return {
      content: dispatch.replyText || aiReply(lang, "libMealSet", { dish: dishLabel(cards.length, 0, lang) }),
      recipes: cards,
      llmUsed: true,
      intentOverride: dispatchIntent,
    };
  }

  // Layer 2: if deterministic intent rules miss, search the raw request text
  // against recipe name/tags/ingredients before falling back to chat. This is
  // the recall bridge for words not yet in foodLexicon (e.g. 沙律/打邊爐).
  let rawLibraryFallback = false;
  if (db && !hasImage && !wantCards && chefIntent.kind === "chat" && !smallTalk && !ambiguousFood) {
    const rawQuery = cleanFoodQuery(lastUserText);
    const asksForFood = hasRequestVerb(lastUserText) || /[?？]|呢|有冇|想要|想食/.test(lastUserText);
    if (rawQuery && asksForFood) {
      const rawSearch = await trySearch(rawQuery, 30);
      if (!rawSearch.ok) {
        console.log(`[AI Chef] lib_search_fail raw query="${rawQuery}" reason=${rawSearch.reason}`);
        return { content: searchFailureReply(lang), recipes: [], llmUsed: false, clarifyReason: "lib_search_fail" };
      }
      const rawRows = rawSearch.rows;
      if (rawRows.length > 0) {
        chefIntent = {
          kind: "recipe",
          wantsCards: true,
          requested: { total: 1, roles: ["any"] },
          confidence: 0.6,
          reason: "raw_library_fallback",
        };
        requestedCount = 1;
        forceNoCards = false;
        isPlain = false;
        wantCards = true;
        rawLibraryFallback = true;
        console.log(`[AI Chef] raw fallback query="${rawQuery}" rows=${rawRows.length} -> card path`);
      } else {
        console.log(`[AI Chef] unmatched_terms="${rawQuery}" query_rows=0 raw_fallback=miss`);
      }
    }
  }

  // Chat budget/quota exhausted: do not call the LLM. The raw/library fallback
  // above may already have turned this into a free library-card response.
  if (!allowChatLlm && !wantCards) {
    console.log(`[AI Chef] chat fallback reason=daily_or_monthly_quota_or_budget`);
    return {
      content: lang.startsWith("en")
        ? "I can't use free AI chat right now, but you can still search the recipe library or ask me a cooking-time FAQ. No credit was used."
        : "我暫時未能用免費 AI 對話，但仍然可以用食譜庫搜尋，或者問我煎牛扒／蒸魚／白灼蝦／氣炸雞翼等時間。冇扣 credit。",
      recipes: [],
      llmUsed: false,
    };
  }

  // A named dish/compound item that has no exact library row must not be
  // silently replaced by a generic role. Return a clarify response instead.
  const requestItems = extractMealIngredients(lastUserText).filter((term) => !/^(?:和|同|及|跟)$/.test(term));
  const genericMealRequest = /(是但|隨便|求其|煮個|整個|有咩好|食咩好)/.test(lastUserText);
  const hasExplicitRequestCount = /(?:\d+|[一二兩两三四五六七八九十])\s*(?:個|个|道|款|碟|樣|样|份)?\s*(?:餸|菜|肉|海鮮|魚|湯|麵|面|粉|甜品|dish|recipe|card)/i.test(lastUserText);
  const missingDishes: Array<{ term: string; alternatives: string[] }> = [];
  const missingIngredients: Array<{ term: string; alternatives: string[] }> = [];
  if (db && wantCards && mode !== "ai" && !rawLibraryFallback && !genericMealRequest && requestItems.length > 0 && !hasExplicitRequestCount) {
    for (const term of requestItems) {
      const search = await trySearch(term, 12);
      if (!search.ok) {
        console.log(`[AI Chef] lib_search_fail item="${term}" reason=${search.reason}`);
        return { content: searchFailureReply(lang), recipes: [], llmUsed: false, clarifyReason: "lib_search_fail" };
      }
      const rows = search.rows;
      const exact = rows.some((row) => normalizeName(String(row.name ?? "")) === normalizeName(term));
      if (exact) continue;
      const alternatives = rows.map((row) => String(row.name ?? "").trim()).filter(Boolean).slice(0, 3);
      if (foodItemType(term) === "dish") missingDishes.push({ term, alternatives });
      else missingIngredients.push({ term, alternatives });
    }
  }
  if (missingDishes.length > 0) {
    const first = missingDishes[0];
    console.log(`[AI Chef] library miss item="${first.term}" alternatives=${first.alternatives.join("|") || "none"} -> clarify`);
    return {
      content: libraryMissReply(lang, first.term, first.alternatives),
      recipes: [],
      llmUsed: false,
      missingRoles: chefIntent.requested.roles,
      clarifyReason: "library_miss",
    };
  }

  // ══════════ Free-text multi-card requests：library by role → AI fill missing ══════════
  // This is the server-owned path for requests such as「一肉一甜品」/「3餸1湯」.
  // It never returns after a single library hit; partial results are explicit.
  if ((mode === "chat" || mode === "library") && wantCards && db && chefIntent.requested.total > 1) {
    const requested = chefIntent.requested;
    // Use the user's ingredient words for this meal. On a follow-up, the
    // previous message is the meal context; otherwise use the latest message.
    const mealContextText = isMealFollowUp(lastUserText) && previousText ? previousText : lastUserText;
    const mealPath: "canned" | "user" = isCannedMealPrompt(mealContextText) ? "canned" : "user";
    // Canned questionnaire prompts are instructions, not ingredients. For real
    // user text keep only food words (no labels like 道菜/主菜/小炒).
    const mealSearchTerms = mealPath === "canned" ? [] : extractMealIngredients(mealContextText);
    const roleQueryFor = (role: RequestedRole): string => role === "any" ? "家常" : (ROLE_LIBRARY_QUERY[role] ?? "家常");
    console.log(`[AI Chef] meal path=${mealPath} context="${mealContextText}" terms=${mealSearchTerms.join("|") || "none"}`);
    const termsForRole = (role: RequestedRole): string[] => {
      if (mealPath === "canned") return [];
      const direct = mealSearchTerms.filter((term) => roleForFoodTerm(term) === role);
      if (direct.length > 0) return direct;
      // The flexible "any" slot should still be anchored to the user's words,
      // not a random generic pool pick (e.g. don't drop tofu into a chicken meal).
      if (role === "any") return mealSearchTerms;
      return [];
    };
    const fallbackQueriesForRole = (role: RequestedRole, terms: string[]): string[] => {
      const queries = terms.flatMap((term) => fallbackQueriesForFoodTerm(term));
      const unique = [...new Set(queries.filter(Boolean))];
      // Never fall back from a specific protein to a generic meat query; that is
      // exactly how «牛扒» became «雞腿».
      return unique.length > 0 ? unique : [roleQueryFor(role)];
    };
    const isTofuOrEgg = (text: string) => /豆腐|豆卜|豆干|豆乾|腐皮|腐竹|雞蛋|鸡蛋|蛋|蒸蛋|炒蛋|皮蛋|鹹蛋|咸蛋|tofu|egg/i.test(text);
    const hasMeatMarker = (text: string) => /豬|猪|牛|雞|鸡|羊|鴨|鸭|鵝|鹅|肉|排骨|腩|雞翼|雞翅|雞腿|雞髀|火腿|叉燒|烧肉|烧肉|肉丸|pork|beef|chicken|lamb|meat/i.test(text);
    const hasVegMarker = (text: string) => /菜|蔬|瓜|豆苗|豆芽|菇|菌|筍|笋|番茄|茄子|青椒|洋蔥|洋葱|薯|蘿蔔|萝卜|西蘭花|西兰花|菠菜|生菜|白菜|椰菜|芥蘭|芥兰|通菜|時蔬|时蔬|木耳|雲耳|云耳|veg|vegetable|broccoli|spinach|mushroom|tomato|potato|onion/i.test(text);
    const roleCandidate = (row: Record<string, unknown>, role: RequestedRole): boolean => {
      const name = String(row.name ?? "");
      const tags = Array.isArray(row.tags) ? row.tags.map(String).join(" ") : "";
      const text = `${name} ${tags}`;
      const type = classifyDishType(row);
      if (role === "any") return type !== "soup" && type !== "dessert" && type !== "drink" && type !== "carb";
      if (role === "meat") {
        // DB dishType can be wrong (e.g. 椒鹽豆腐 marked meat). Name/tags win.
        if (isTofuOrEgg(text) && !hasMeatMarker(name)) return false;
        return type === "meat" && hasMeatMarker(text);
      }
      if (role === "vegetable") return type === "vegetable" && hasVegMarker(name) && !isTofuOrEgg(name);
      if (role === "seafood") return type === "seafood";
      if (role === "soup") return type === "soup";
      if (role === "noodle") return type === "carb" || /麵|面|拉麵|拉面|烏冬|乌冬|米線|米线|意粉|noodle|ramen|udon|soba|pasta/i.test(name);
      if (role === "dessert") return type === "dessert";
      return true;
    };
    const roleRowsCache = new Map<string, Record<string, unknown>[]>();
    let roleSearchFailed = false;
    const loadRoleRows = async (queries: string[]): Promise<Record<string, unknown>[]> => {
      const cacheKey = queries.join("|");
      const cached = roleRowsCache.get(cacheKey);
      if (cached) return cached;
      const rows: Record<string, unknown>[] = [];
      for (const query of queries) {
        const search = await trySearch(query, 80);
        if (!search.ok) {
          roleSearchFailed = true;
          console.log(`[AI Chef] lib_search_fail role query="${query}" reason=${search.reason}`);
          return [];
        }
        rows.push(...search.rows);
      }
      const deduped = [...new Map(rows.map((row) => [String(row.source ?? "") + ":" + String(row.id ?? row.name ?? ""), row])).values()];
      roleRowsCache.set(cacheKey, deduped);
      return deduped;
    };
    const pickLibrary = async (role: RequestedRole, count: number, used: string[]): Promise<RecipeCandidate<SuggestedRecipe>[]> => {
      const usedSet = new Set(used.map((n) => normalizeName(n).toLowerCase()));
      const pickFrom = (rows: Record<string, unknown>[]) => {
        const safe = avoidIngredients.length === 0 ? rows : rows.filter((row) => !rowContainsAvoid(row, avoidIngredients));
        const filtered = safe.filter((row) => {
          const key = normalizeName(String(row?.name ?? "")).toLowerCase();
          return key && !usedSet.has(key) && roleCandidate(row, role);
        });
        const recipes = rowsToSuggested(filtered, excludeSets, count);
        const picked = recipes
          .filter((recipe) => {
            const key = normalizeName(recipe.name).toLowerCase();
            return key && !usedSet.has(key);
          })
          .map((recipe) => ({ recipe, role, source: "library" as const }));
        return { filtered, picked };
      };

      const userTerms = termsForRole(role);
      let source: "lib" | "lib-role" = userTerms.length > 0 ? "lib" : "lib-role";
      let queries = userTerms.length > 0 ? userTerms : [roleQueryFor(role)];
      let rows = await loadRoleRows(queries);
      let result = pickFrom(rows);

      // User term had zero valid role hits -> try the deterministic role query
      // before touching the LLM. This is the "0 hit" fallback required by E.
      if (result.picked.length === 0 && userTerms.length > 0) {
        const fallbackQueries = fallbackQueriesForRole(role, userTerms);
        if (fallbackQueries.some((query) => !queries.includes(query))) {
          queries = fallbackQueries;
          source = "lib-role";
          rows = await loadRoleRows(queries);
          result = pickFrom(rows);
        }
      }

      const queryLabel = queries.join("、");
      console.log(`[AI Chef] meal role=${role} source=${result.picked.length > 0 ? source : "ai"} query="${queryLabel}" rows=${rows.length} candidates=${result.filtered.length} picked=${result.picked.length}`);
      return result.picked;
    };
    const generateRole = async (role: RequestedRole, count: number, used: string[]): Promise<RecipeCandidate<SuggestedRecipe>[]> => {
      if (roleSearchFailed) return [];
      if (!allowAiFallback) {
        console.log(`[AI Chef] meal role=${role} source=ai-blocked reason=no_credit_reservation_or_ai_disabled`);
        return [];
      }
      const expected = role === "any" ? "other" : dishTypeForRole(role);
      const ingredientTerms = termsForRole(role);
      const baseLabel = role === "any" ? "家常菜" : (MEAL_TYPE_LABEL[expected]?.label ?? "家常菜");
      const label = ingredientTerms.length > 0 ? `${baseLabel}（用戶指定食材：${ingredientTerms.join("、")}）` : baseLabel;
      const recipe = await generateOneType(label, expected, [...mergedExclude, ...used], avoidIngredients);
      if (!recipe) return [];
      llmUsed = true;
      console.log(`[AI Chef] meal role=${role} source=ai reason=${ingredientTerms.length > 0 ? `no_library_match:${ingredientTerms.join("、")}` : "no_library_match"} picked=${recipe.name}`);
      return [{ recipe, role, source: "ai" as const }];
    };
    const validateRole = (recipe: SuggestedRecipe, role: RequestedRole): boolean => {
      const name = String(recipe?.name ?? "").trim();
      if (!name || name === "未命名食譜" || name.length < 2) return false;
      if (!Array.isArray(recipe.ingredients) || recipe.ingredients.filter((i) => String(i?.name ?? "").trim()).length < 2) return false;
      const isLibrary = recipe.source === "official" || recipe.source === "custom";
      const minSteps = isLibrary ? 1 : (role === "dessert" || role === "soup") ? 4 : 5;
      if (!Array.isArray(recipe.steps) || recipe.steps.filter((s) => String(s ?? "").trim()).length < minSteps) return false;
      return roleCandidate({
        name: recipe.name,
        tags: recipe.tags,
        dishType: recipe.dishType,
        soupType: recipe.soupType,
      } as unknown as Record<string, unknown>, role);
    };
    const assembled = await assembleRecipeSet<SuggestedRecipe>(requested, {
      pickLibrary,
      generate: generateRole,
      validate: validateRole,
      nameOf: (recipe) => recipe.name,
      maxRounds: 2,
    });
    if (roleSearchFailed) {
      return { content: searchFailureReply(lang), recipes: [], llmUsed: false, clarifyReason: "lib_search_fail" };
    }
    if (assembled.cards.length > 0) {
      const people = extractPeopleCount(lastUserText);
      const applyServings = (arr: SuggestedRecipe[]) => people && people > 0
        ? arr.map((r) => ({ ...r, servings: people }))
        : arr;
      const soupCount = requested.roles.filter((r) => r === "soup").length;
      const dishCount = Math.max(0, requested.total - soupCount);
      const dishSetLabel = dishLabel(dishCount, soupCount, lang);
      const cards = applyServings(assembled.cards);
      const missingIngredient = missingIngredients[0];
      const content = assembled.missingRoles.length > 0
        ? aiReply(lang, "partialSet", { served: assembled.served, total: assembled.requested })
        : missingIngredient && assembled.sources.ai === 0
          ? ingredientMissReply(lang, missingIngredient.term, cards.map((recipe) => recipe.name))
          : assembled.sources.ai > 0
            ? aiReply(lang, "libPlusAi", { lib: assembled.sources.library, ai: assembled.sources.ai })
            : aiReply(lang, "libMealSet", { dish: dishSetLabel });
      resultMissingRoles = assembled.missingRoles;
      await recordFamilySeenNames(familyId, cards.map((r) => r.name));
      console.log(`[AI Chef] role assembler: requested=${assembled.requested} served=${assembled.served} lib=${assembled.sources.library} ai=${assembled.sources.ai} missing=${assembled.missingRoles.join(",") || "none"}`);
      return {
        content,
        recipes: cards,
        llmUsed,
        clarifyReason: assembled.missingRoles.length > 0 && assembled.sources.ai > 0 ? "ai_partial" : undefined,
      };
    }
    console.warn(`[AI Chef] role assembler produced 0 cards for roles=${requested.roles.join(",")}`);
    if (missingIngredients.length > 0) {
      return {
        content: ingredientMissReply(lang, missingIngredients[0].term, missingIngredients[0].alternatives),
        recipes: [],
        llmUsed,
        clarifyReason: "ingredient_miss",
      };
    }
    return { content: aiReply(lang, "cantRecommend"), recipes: [], llmUsed };
  }

  // ══════════ mode === "library"：快路徑（3餸1湯 → 1湯3餸 + AI補；一般 → 1 個）══════════
  if (mode === "library") {
    const libMealIntent = parseMealIntent(inputMessages as Message[]);
    const reqCount = search?.count && search.count > 1 ? search.count : 0;
    const isMealLib = libMealIntent.isMeal || reqCount > 0 || /3\s*餸\s*1\s*湯|4\s*個唔同嘅食譜|肉\/海鮮\/蔬菜\/湯/.test(lastUserText);
    const cacheKey = familyId ?? 0;
    const cachedPool = LIBRARY_POOL_CACHE.get(cacheKey);
    let rows: Record<string, unknown>[];
    if (cachedPool && Date.now() - cachedPool.at < LIBRARY_POOL_TTL_MS) {
      rows = cachedPool.rows;
      console.log(`[AI Chef] library pool cache hit (${rows.length})`);
    } else {
      const poolStartedAt = Date.now();
      const poolSearch = await trySearch("", 400);
      if (!poolSearch.ok) {
        console.log(`[AI Chef] lib_search_fail library_pool reason=${poolSearch.reason}`);
        return { content: searchFailureReply(lang), recipes: [], llmUsed: false, clarifyReason: "lib_search_fail" };
      }
      rows = poolSearch.rows;
      LIBRARY_POOL_CACHE.set(cacheKey, { at: Date.now(), rows });
      console.log(`[AI Chef] library pool fetch ${rows.length} rows in ${Date.now() - poolStartedAt}ms`);
    }

    const safeRows = avoidIngredients.length > 0
      ? rows.filter((row) => !rowContainsAvoid(row, avoidIngredients))
      : rows;

    if (isMealLib) {
      // 尊重前端指定嘅總卡數（例如「辛辣3餸1湯」= 4），否則用 intent；再否則 fallback 3餸1湯
      let dishCount = libMealIntent.dishCount;
      let soupCount = libMealIntent.soupCount;
      if (reqCount > 0 && reqCount !== dishCount + soupCount) {
        soupCount = (libMealIntent.soupCount > 0 || /湯/.test(lastUserText)) ? 1 : 0;
        dishCount = Math.max(1, reqCount - soupCount);
      }
      const libCount = { dishCount, soupCount };
      const totalWanted = Math.max(libCount.dishCount + libCount.soupCount, 1);
      // 1) 先從庫揀 N 餸 + M 湯（可能唔夠）
      const libPicked = pickSoupMeal(safeRows, excludeSets, libCount.dishCount, libCount.soupCount);
      const libNames = libPicked.map(r => r.name);
      await recordFamilySeenNames(familyId, libNames);
      // 問卷「N人」→ 覆蓋卡片 servings（library 卡 DB 預設 4 人，要跟用戶答嘅人數）
      const people = extractPeopleCount(lastUserText);
      const applyServings = (arr: SuggestedRecipe[]) => people && people > 0
        ? arr.map(r => ({ ...r, servings: people }))
        : arr;
      // 2) 唔夠 → 按「缺失類別」逐類 AI 補缺
      if (libPicked.length < totalWanted) {
        const missing = totalWanted - libPicked.length;
        const haveTypes = new Set(libPicked.map(mealTypeOf));
        // 用戶唔要湯（soupCount=0）→ 唔補湯
        const neededTypes = ((["soup", "meat", "seafood", "vegetable", "other"] as DishType[]).filter(t => !haveTypes.has(t) && (libCount.soupCount > 0 || t !== "soup"))).slice(0, missing);
        const aiPicked = await generateMissingRecipes(neededTypes.length, false, [...mergedExclude, ...libNames], familyId, userId, neededTypes, avoidIngredients);
        if (aiPicked.length > 0) llmUsed = true;
        await recordFamilySeenNames(familyId, aiPicked.map(r => r.name));
        const all = applyServings([...libPicked, ...aiPicked].slice(0, totalWanted));
        console.log(`[AI Chef] library meal: ${libPicked.length} lib + ${aiPicked.length} ai`);
        return { content: aiReply(lang, "libPlusAi", { lib: libPicked.length, ai: aiPicked.length }), recipes: all, llmUsed };
      }
      const dishSetLabel = dishLabel(libCount.dishCount, libCount.soupCount, lang);
      console.log(`[AI Chef] library meal: ${libPicked.length} lib`);
      return { content: aiReply(lang, "libMealSet", { dish: dishSetLabel }), recipes: applyServings(libPicked), llmUsed };
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
              scenario: search.scenario,
              limit: 30,
            }, familyId),
            8000, "lib search"
          );
          searchRows = (res.recipes || []) as Record<string, unknown>[];
        } catch (e) {
          console.warn("[AI Chef] structured lib search failed:", e);
        }
      }
      picked = rowsToSuggested(applySearchFilters(searchRows, search), excludeSets, searchCount);
      if (search.rank === "shortestTime" && picked.length > 1) {
        picked = [...picked].sort((a, b) => (a.cookTime || 999) - (b.cookTime || 999));
      }
      if (picked.length > 0) {
        console.log(`[AI Chef] library structured: ${picked.length} recipes (${search.query || search.tags?.join("、") || "generic"})`);
        await recordFamilySeenNames(familyId, picked.map(r => r.name));
        const content = search.tags?.join("、") || search.query
          ? aiReply(lang, "libByTag", { q: (search.tags?.join("、") || search.query) ?? "" })
          : aiReply(lang, "libOne");
        return { content, recipes: picked, llmUsed };
      }
      // 結構化搜尋 0 結果 → 用「已過濾」嘅 generic 池補（確保時間/類別一致，唔會出 90 分鐘湯/甜品/飲品）
      const filteredRows = applySearchFilters(safeRows, search);
      picked = rowsToSuggested(filteredRows, excludeSets, searchCount);
      if (search.rank === "shortestTime" && picked.length > 1) {
        picked = [...picked].sort((a, b) => (a.cookTime || 999) - (b.cookTime || 999));
      }
      if (picked.length > 0) {
        console.log(`[AI Chef] library structured fallback: ${picked.length} recipes (${search.query || search.tags?.join("、") || "generic"})`);
        await recordFamilySeenNames(familyId, picked.map(r => r.name));
        return { content: aiReply(lang, "libOne"), recipes: picked, llmUsed };
      }
    } else if (swapQuery) {
      const swapSearch = await trySearch(swapQuery, 30);
      if (!swapSearch.ok) {
        console.log(`[AI Chef] lib_search_fail swap query="${swapQuery}" reason=${swapSearch.reason}`);
        return { content: searchFailureReply(lang), recipes: [], llmUsed: false, clarifyReason: "lib_search_fail" };
      }
      const singleRows = swapSearch.rows.filter((row) => !rowContainsAvoid(row, avoidIngredients));
      // 換卡：用「前端傳嚟嘅 exclude」做去重（現卡 + 已換過），而唔係加埋 7 日 seen——
      // 否則類別 pool 被 7 日去重過度收窄，第二次撳換就搜唔到 → 誤 fallback AI。
      const swapSets = mkExcludeSets(excludeNames, excludeNames);
      let picked = rowsToSuggested(singleRows, swapSets, 6);
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
        return { content: aiReply(lang, "libOneFrom"), recipes: picked.slice(0, 3), llmUsed };
      }
    } else {
      picked = rowsToSuggested(safeRows, excludeSets, 1);
      if (picked.length > 0) {
        console.log(`[AI Chef] library mode: ${picked.length} recipes`);
        await recordFamilySeenNames(familyId, [picked[0].name]);
        return { content: aiReply(lang, "libOneFrom"), recipes: picked, llmUsed };
      }
    }
    return { content: aiReply(lang, "libNone"), recipes: [], llmUsed, clarifyReason: "library_miss" };
  }

  // ══════════ chat 非圖片：先試食譜庫（library-first）══════════
  const extractedTerms = extractMealIngredients(lastUserText);
  const exactFoodTerm = extractedTerms.find((term) => roleForFoodTerm(term) !== "any" && findFoodTerm(term) === term);
  const keyword = exactFoodTerm ?? cleanFoodQuery(lastUserText);
  const isVague = !keyword; // 抽唔到關鍵字 = 模糊想食
  if (mode === "chat" && !forceNoCards && (requestedCount === null || requestedCount <= 1)) {
    // 打字「N分鐘」都尊重時間：由 raw text 抽 cookTimeMax（cleanFoodQuery 會剷走數字，所以要喺 raw 度抽）
    const chatTimeMatch = lastUserText.match(/(\d{1,3})\s*分鐘/);
    const chatCookTimeMax = chatTimeMatch ? parseInt(chatTimeMatch[1], 10) : undefined;
    // Kill-switch: OFF must preserve the legacy auto-LLM behavior.
    const singleCardLibrary = featureFlags.ai_chef_single_card_library === true;
    const anyLibraryMissOffer = featureFlags.ai_chef_any_library_miss_offer === true;
    const explicitRole = requestedCount === 1 && chefIntent.requested.roles.length === 1
      ? chefIntent.requested.roles[0]
      : undefined;
    const primarySearch = keyword ? await trySearch(keyword, 30, chatCookTimeMax) : await trySearch("", 1000, chatCookTimeMax);
    if (!primarySearch.ok) {
      console.log(`[AI Chef] lib_search_fail single query="${keyword || "(generic)"}" reason=${primarySearch.reason}`);
      return { content: searchFailureReply(lang), recipes: [], llmUsed: false, clarifyReason: "lib_search_fail" };
    }
    let rows = primarySearch.rows;
    if (keyword && rows.length === 0 && findFoodTerm(keyword) === keyword) {
      const fallbackQueries = fallbackQueriesForFoodTerm(keyword).filter((q) => q !== keyword);
      for (const fallbackQuery of fallbackQueries) {
        const fallbackSearch = await trySearch(fallbackQuery, 30, chatCookTimeMax);
        if (!fallbackSearch.ok) {
          console.log(`[AI Chef] lib_search_fail fallback="${fallbackQuery}" reason=${fallbackSearch.reason}`);
          return { content: searchFailureReply(lang), recipes: [], llmUsed: false, clarifyReason: "lib_search_fail" };
        }
        rows.push(...fallbackSearch.rows);
      }
    }
    const specificDish = !!keyword && foodItemType(keyword) === "dish" && findFoodTerm(keyword) === keyword;
    if (!genericMealRequest && specificDish && rows.length === 0) {
      console.log(`[AI Chef] library miss single item="${keyword}" -> clarify (no LLM)`);
      return {
        content: libraryMissReply(lang, keyword, rows.map((row) => String(row.name ?? "")).filter(Boolean).slice(0, 3)),
        recipes: [],
        llmUsed: false,
        missingRoles: chefIntent.requested.roles,
        clarifyReason: "library_miss",
      };
    }
    const safeRows = avoidIngredients.length > 0
      ? rows.filter((row) => !rowContainsAvoid(row, avoidIngredients))
      : rows;
    // For a specific protein, prefer its closest family label (牛扒 -> 牛排)
    // over a broader family result (牛柳), even if the DB row is newer.
    const preferredRow = findFoodTerm(keyword) === keyword
      ? fallbackQueriesForFoodTerm(keyword)
        .map((query) => safeRows.find((row) => String(row.name ?? "").includes(query)))
        .find(Boolean)
      : undefined;
    const picked = rowsToSuggested(preferredRow ? [preferredRow] : safeRows, excludeSets, 1);
    if (picked.length > 0) {
      const pickedIsReused = singleCardLibrary
        && operation === "append"
        && isRowExcluded(excludeSets, picked[0] as unknown as Record<string, unknown>);
      const wrongRole = singleCardLibrary
        && !!explicitRole
        && explicitRole !== "any"
        && !matchesLibraryRole(picked[0] as unknown as Record<string, unknown>, explicitRole);
      if (!wrongRole && !pickedIsReused) {
        console.log(`[AI Chef] library-first: ${picked.length} for "${keyword || "(generic)"}"`);
        await recordFamilySeenNames(familyId, picked.map(r => r.name));
        const missingIngredient = missingIngredients[0];
        return {
          content: missingIngredient
            ? ingredientMissReply(lang, missingIngredient.term, picked.map((recipe) => recipe.name))
            : keyword
              ? aiReply(lang, "libByKeyword", { kw: keyword })
              : aiReply(lang, "libOne"),
          recipes: picked,
          llmUsed,
        };
      }
      if (pickedIsReused) console.log(`[AI Chef] library-first keyword result is reused; append refuses it -> role fallback`);
      else console.log(`[AI Chef] library-first keyword result wrong role=${explicitRole} -> role fallback`);
    }

    if (singleCardLibrary && explicitRole && explicitRole !== "any") {
      // A specific food term (牛扒) must stay inside its family: 牛扒 -> 牛排/牛柳/牛.
      // Only use the generic role query when the user gave no specific food term.
      const specificFallbackQueries = findFoodTerm(keyword) === keyword ? fallbackQueriesForFoodTerm(keyword) : [];
      const genericRoleQuery = ROLE_LIBRARY_QUERY[explicitRole];
      const roleQueries = [...new Set(
        specificFallbackQueries.length > 0
          ? specificFallbackQueries
          : [genericRoleQuery].filter(Boolean) as string[],
      )];
      for (const roleQuery of roleQueries) {
        if (roleQuery === keyword) continue;
        const roleSearch = await trySearch(roleQuery, 100, chatCookTimeMax);
        if (!roleSearch.ok) {
          console.log(`[AI Chef] lib_search_fail role=${explicitRole} query="${roleQuery}" reason=${roleSearch.reason}`);
          return { content: searchFailureReply(lang), recipes: [], llmUsed: false, clarifyReason: "lib_search_fail" };
        }
        const rolePool = roleSearch.rows;
        const afterAvoid = avoidIngredients.length === 0
          ? rolePool
          : rolePool.filter((row) => !rowContainsAvoid(row, avoidIngredients));
        const afterExclude = afterAvoid.filter((row) => !isRowExcluded(excludeSets, row));
        console.log(`[AI Chef] library_role_pool=${rolePool.length} after_avoid=${afterAvoid.length} after_exclude=${afterExclude.length} role=${explicitRole} query="${roleQuery}"`);
        const roleCandidates = operation === "append" ? afterExclude : afterAvoid;
        const roleRows = roleCandidates.filter((row) => matchesLibraryRole(row, explicitRole));
        const rolePicked = rowsToSuggested(roleRows, excludeSets, 1);
        if (rolePicked.length > 0) {
          console.log(`[AI Chef] library role fallback: ${rolePicked.length} for role=${explicitRole} query="${roleQuery}"`);
          await recordFamilySeenNames(familyId, rolePicked.map(r => r.name));
          return {
            content: aiReply(lang, "libByKeyword", { kw: roleQuery }),
            recipes: rolePicked,
            llmUsed,
          };
        }
      }

      // Explicit role + no library match: do not silently call the LLM. The
      // router/UI can offer the paid AI action as an explicit next step.
      const reason = roleQueries.length === 0 ? "no_role_query" : "no_safe_role_row";
      console.log(`[AI Chef] library role miss: role=${explicitRole} query="${keyword || "(generic)"}" reason=${reason} -> offer AI`);
      return {
        content: aiReply(lang, "libNone"),
        recipes: [],
        llmUsed,
        missingRoles: chefIntent.requested.roles,
        clarifyReason: "library_miss",
      };
    }

    if (anyLibraryMissOffer && requestedCount === 1 && chefIntent.requested.roles.length === 1 && chefIntent.requested.roles[0] === "any") {
      console.log(`[AI Chef] any library miss: query="${keyword || "(generic)"}" -> offer AI`);
      return {
        content: aiReply(lang, "libNone"),
        recipes: [],
        llmUsed,
        missingRoles: chefIntent.requested.roles,
        clarifyReason: "library_miss",
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
  const mealIntent = parseMealIntent(llmMsgs);

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

  const useLightChatPrompt = forceNoCards && !wantCards;
  let systemPrompt = useLightChatPrompt
    ? buildLightChatPrompt(lang)
    : buildSystemPrompt(libSummary, soupIntent, lang);
  if (!useLightChatPrompt) {
    if (requestedCount && requestedCount > 1) {
      systemPrompt += `\n\n【本輪卡數】請提供 ${requestedCount} 個食譜，數量必須符合用戶要求。`;
    }
    if (popularHint) systemPrompt += `\n\n${popularHint}`;
    if (avoidIngredients.length > 0) {
      systemPrompt += `\n\n⛔ 安全限制：以下食材係用戶敏感/必須避免，任何食譜都完全唔可以包含（包括醬汁、裝飾、替代食材）：${avoidIngredients.join("、")}。輸出前請逐個檢查 ingredients。`;
    }
    if (isPlain) {
      systemPrompt += "\n\n（本輪為純對話/技巧查詢：請用正常文字親切回覆，不要輸出 JSON，也不要附食譜。）";
    } else if (mergedExclude.length > 0) {
      systemPrompt += `\n\n⚠️ 絕對唔可以推薦以下用戶最近睇過嘅菜式，諗一啲全新嘅：${mergedExclude.slice(0, 10).join("、")}`;
    }
  }
  // 單菜 AI 生成（非 3餸1湯）：明確只出 1 個，避免 LLM 浪費 tokens 喺多餘菜式（同時令生成更快）
  if (mode === "ai" && !soupIntent && !isPlain) {
    systemPrompt += "\n\n（本輪係單一食譜請求：recipes array 只需包含 1 個食譜，唔好出多個。）";
  }

  // Fix3: 將已睇過名單直接加入最後一條 user message，令 flash 直接睇到（比淨係 system prompt 更有效）
  const llmMsgsWithExclude = [...llmMsgs];
  if (!useLightChatPrompt && !isPlain && mergedExclude.length > 0) {
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

  // Light chat gets at most the latest 2–3 rounds; card/meal keeps full context.
  const llmMsgsForCall = useLightChatPrompt ? llmMsgs.slice(-6) : llmMsgsWithExclude;
  const msgs: Message[] = [
    { role: "system", content: systemPrompt },
    ...llmMsgsForCall,
  ];

  const enableSearch = false; // 一律唔行 tools loop / web search：單輪 LLM，快靚正（library-first 已做查庫）
  // JSON mode：想食譜（非純對話/非圖片）→ 強制 LLM 輸出 JSON，避免 flash 出純文字導致 0 卡
  let finalContent = AI_RECIPE_FALLBACK_CONTENT;
  let allMessages = msgs;
  let lastFinishReason = "";

  const callLLM = async (): Promise<boolean> => {
    llmUsed = true; // 有叫 LLM 就標記（即使 timeout 都計，因為有 call 過）
    try {
      const out = await withTimeout(
        runToolsLoop(msgs, familyId, userId, enableSearch, wantCards, wantCards ? {} : { maxTokens: LIGHT_CHAT_MAX_TOKENS, timeoutMs: 12000 }),
        mode === "ai" ? 35000 : wantCards ? AI_RECIPE_CHAT_TIMEOUT_MS : 15000,
        "ai chef chat",
      );
      finalContent = out.finalContent;
      allMessages = out.allMessages;
      lastFinishReason = out.finishReason;
      console.log(`[AI Chef] llm finish_reason=${lastFinishReason}`);
      return true;
    } catch (e) {
      console.warn("[AI Chef] chat timed out or failed:", e);
      return false;
    }
  };

  // 3餸1湯 AI 生成：並行 4 個獨立 call（1 湯 + 3 餸），每個 ~8-10s，總時間 ~10s
  let usedParallel = false;
  let parallelFromLibrary = false;
  let parallelContent = "";
  let parallelRecipes: SuggestedRecipe[] = [];
  // 由「最後一條用戶訊息」抽數量：一送一湯 -> {1,1}；兩個餸 -> {2,0}；唔要湯 -> {N,0}；冇寫 -> default {3,1}
  const mealCount = { dishCount: mealIntent.dishCount, soupCount: mealIntent.soupCount };
  const totalWanted = Math.max(requestedCount ?? mealCount.dishCount + mealCount.soupCount, 1);
  const dishSetLabel = dishLabel(mealCount.dishCount, mealCount.soupCount, lang);
  // 打字「N送M湯/兩個餸」（mode=chat + meal intent）：先搵食譜庫，庫唔夠先 AI 補缺
  // （同「食譜庫」button 一致；唔會淨係 AI 生成）
  if (mealIntent.isMeal && mode === "chat" && wantCards && db) {
    try {
      const libSearch = await trySearch("", 1000);
      if (!libSearch.ok) {
        console.log(`[AI Chef] lib_search_fail chat_meal reason=${libSearch.reason}`);
        return { content: searchFailureReply(lang), recipes: [], llmUsed: false, clarifyReason: "lib_search_fail" };
      }
      const libRows = libSearch.rows;
      const safeLibRows = avoidIngredients.length > 0
        ? libRows.filter((row) => !rowContainsAvoid(row, avoidIngredients))
        : libRows;
      const libMeal = pickSoupMeal(safeLibRows, excludeSets, mealCount.dishCount, mealCount.soupCount);
      if (libMeal.length > 0) {
        const libNames = libMeal.map(r => r.name);
        await recordFamilySeenNames(familyId, libNames);
        if (libMeal.length >= totalWanted) {
          usedParallel = true;
          parallelFromLibrary = true;
          parallelContent = aiReply(lang, "libMealSet", { dish: dishSetLabel });
          parallelRecipes = libMeal;
          console.log(`[AI Chef] chat meal library-first: ${libMeal.length} lib (${dishSetLabel})`);
        } else {
          // 庫唔夠 → AI 補缺（缺失類別），補到 totalWanted；用戶唔要湯就唔補湯
          const haveTypes = new Set(libMeal.map(mealTypeOf));
          const neededTypes = (["soup", "meat", "seafood", "vegetable", "other"] as DishType[]).filter(t => !haveTypes.has(t) && (mealCount.soupCount > 0 || t !== "soup"));
          const aiPicked = neededTypes.length > 0
            ? await generateMissingRecipes(totalWanted - libMeal.length, false, [...mergedExclude, ...libNames], familyId, userId, neededTypes.slice(0, totalWanted - libMeal.length), avoidIngredients)
            : [];
          if (aiPicked.length > 0) llmUsed = true;
          await recordFamilySeenNames(familyId, aiPicked.map(r => r.name));
          const all = [...libMeal, ...aiPicked].slice(0, totalWanted);
          usedParallel = true;
          parallelFromLibrary = true;
          parallelContent = aiReply(lang, "libPlusAi", { lib: libMeal.length, ai: aiPicked.length });
          parallelRecipes = all;
          console.log(`[AI Chef] chat meal library-first: ${libMeal.length} lib + ${aiPicked.length} ai (${dishSetLabel})`);
        }
      }
    } catch (e) {
      console.warn("[AI Chef] chat meal library-first failed:", e);
    }
  }
  if (mode === "ai" && wantCards && (AI_CHEF_MULTI_ROLE ? chefIntent.requested.total > 1 : soupIntent)) {
    // AI-first meal: generate one card per requested role, validate each role,
    // then use A (library soup) only as a last-resort fallback for a missing soup.
    const roles = chefIntent.requested.total > 0
      ? chefIntent.requested.roles
      : (["meat", "seafood", "vegetable", "soup"] as RequestedRole[]);
    const requested = { total: Math.max(requestedCount ?? roles.length, 1), roles };
    const generateAI = async (role: RequestedRole, count: number, used: string[]): Promise<RecipeCandidate<SuggestedRecipe>[]> => {
      const expected = role === "any" ? "other" : dishTypeForRole(role);
      const label = role === "any" ? "家常菜" : (MEAL_TYPE_LABEL[expected]?.label ?? "家常菜");
      llmUsed = true; // this path is explicitly AI-first
      const recipe = await generateOneType(label, expected, [...mergedExclude, ...used], avoidIngredients);
      if (!recipe) return [];
      return [{ recipe, role, source: "ai" as const }];
    };
    const validateAI = (recipe: SuggestedRecipe, role: RequestedRole): boolean => {
      const name = String(recipe?.name ?? "").trim();
      if (!name || name === "未命名食譜" || name.length < 2) return false;
      if (!Array.isArray(recipe.ingredients) || recipe.ingredients.filter((i) => String(i?.name ?? "").trim()).length < 2) return false;
      const minSteps = (role === "soup" || role === "dessert") ? 4 : 5;
      if (!Array.isArray(recipe.steps) || recipe.steps.filter((x) => String(x ?? "").trim()).length < minSteps) return false;
      const type = classifyDishType({ name: recipe.name, tags: recipe.tags, dishType: recipe.dishType, soupType: recipe.soupType } as unknown as Record<string, unknown>);
      if (role === "soup") return type === "soup" || isSoupRecipe(recipe);
      if (role === "dessert") return type === "dessert";
      if (role === "any") return type !== "soup" && type !== "dessert" && type !== "drink";
      if (role === "meat") return type === "meat" || type === "other";
      if (role === "seafood") return type === "seafood" || type === "other";
      if (role === "vegetable") return type === "vegetable";
      if (role === "noodle") return type === "carb" || /麵|面|拉麵|拉面|烏冬|乌冬|米線|米线|意粉|noodle|ramen|udon|soba|pasta/i.test(name);
      return true;
    };
    const assembled = await assembleRecipeSet<SuggestedRecipe>(requested, {
      pickLibrary: async () => [],
      generate: generateAI,
      validate: validateAI,
      nameOf: (recipe) => recipe.name,
      maxRounds: 2,
    });
    let cards = assembled.cards;
    let missing = assembled.missingRoles;
    const roleSoupCount = requested.roles.filter((r) => r === "soup").length;
    const roleDishLabel = dishLabel(Math.max(0, requested.total - roleSoupCount), roleSoupCount, lang);

    // A: last-resort library fill for missing roles (soup is the common case,
    // but a failed vegetable/seafood slot should not silently turn 4 into 3).
    for (const role of [...missing]) {
      if (cards.length >= requested.total) break;
      const query = role === "soup" ? "湯" : role === "vegetable" ? "蔬菜" : role === "meat" ? "肉" : role === "seafood" ? "海鮮" : role === "noodle" ? "麵" : role === "dessert" ? "甜品" : "";
      try {
        const rows = rowsOrEmpty(await trySearch(query, 80), `ai_meal:${role}`);
        const safeRows = avoidIngredients.length > 0
          ? rows.filter((row) => !rowContainsAvoid(row, avoidIngredients))
          : rows;
        const expectedType = role === "any" ? "other" : dishTypeForRole(role);
        const roleRows = safeRows.filter((row) => {
          const type = classifyDishType(row);
          const nm = String(row?.name ?? "");
          if (role === "any") return type !== "soup" && type !== "dessert" && type !== "drink";
          if (role === "soup") return type === "soup" || isSoupRecipe({ name: nm, tags: Array.isArray(row?.tags) ? row.tags.map(String) : [], source: "official" } as SuggestedRecipe);
          if (role === "noodle") return type === "carb" || dishFamily(nm) === "noodle";
          return type === expectedType || (role !== "vegetable" && type === "other");
        });
        const pick = rowsToSuggested(roleRows, excludeSets, 1).filter((recipe) => !cards.some((c) => normalizeName(c.name) === normalizeName(recipe.name)));
        if (pick.length > 0) {
          cards = [...cards, ...pick];
          missing = missing.filter((r) => r !== role);
          console.log(`[AI Chef] AI meal library fallback role=${role}: ${pick[0].name}`);
        }
      } catch (e) {
        console.warn(`[AI Chef] AI meal library fallback role=${role} failed:`, e);
      }
    }

    usedParallel = true;
    parallelFromLibrary = true; // cards are already role-assembled; skip pickDiverseMeal
    parallelRecipes = cards;
    if (cards.length > 0 && missing.length === 0) {
      parallelContent = cards.some((r) => r.source === "official" || r.source === "custom")
        ? aiReply(lang, "libPlusAi", { lib: cards.filter((r) => r.source === "official" || r.source === "custom").length, ai: cards.filter((r) => r.source === "ai").length })
        : aiReply(lang, "madeTonight", { dish: roleDishLabel });
    } else if (cards.length > 0) {
      parallelContent = aiReply(lang, "partialSet", { served: cards.length, total: requested.total });
    } else {
      parallelContent = aiReply(lang, "cantRecommend");
    }
    resultMissingRoles = missing;
    console.log(`[AI Chef] AI role assembler: requested=${requested.total} served=${cards.length} missing=${missing.join(",") || "none"} lib=${cards.filter((r) => r.source === "official" || r.source === "custom").length} ai=${cards.filter((r) => r.source === "ai").length}`);
  } else {
    if (!(await callLLM())) {
          return { content: aiReply(lang, "cantRecommend"), recipes: [], llmUsed };
    }
  }

  // Parse LLM response to extract content and recipes
  let parsed = parseRecipeWithFallback(finalContent, lang);
  let content = parsed.content;
  let recipes = parsed.recipes;

  // 並行 3餸1湯：直接採用並行結果（唔再經 parse，避免 SuggestedRecipe 唔合 schema 導致 0 卡再 retry）
  let recoveredFromRetry = false;
  if (usedParallel) {
    content = parallelContent;
    recipes = parallelRecipes;
  } else {
    const retryReason = getRecipeRetryReason({
      content: finalContent,
      finishReason: lastFinishReason,
      recipes,
      wantCards,
    });
    if (retryReason) {
      console.warn(`[AI Chef] retry reason=${retryReason} finish_reason=${lastFinishReason || "unknown"}`);
      llmUsed = true; // retry is a real LLM call
      try {
        const recovered = await retryRecipeOutputOnce(
          { content: finalContent, finishReason: lastFinishReason, recipes, wantCards, lang },
          () => retryLLMJson(msgs, familyId, userId, retryReason),
        );
        if (recovered.retrySucceeded) {
          content = recovered.content;
          recipes = recovered.recipes;
          recoveredFromRetry = true;
          console.log(`[AI Chef] Retry succeeded: ${recipes.length} recipes`);
        } else {
          console.warn("[AI Chef] Retry returned 0 recipes");
        }
      } catch (e) {
        console.warn("[AI Chef] Retry failed:", e);
      }
    }
  }

  // 純對話（greeting/technique）-> 一定唔可以有卡；除非 retry 成功證實係
  // 可解析嘅食譜輸出（避免靜默丟卡）。
  if (forceNoCards && !recoveredFromRetry) {
    recipes = [];
  } else {
    // 撳 AI（mode="ai"/chat）→ 真正 AI 生成嘅先標 source="ai"；食譜庫卡（official/custom）保留原 source，
    // 唔會因為行咗 meal library-first 就被誤標做 AI（badge 應顯示「食譜庫」）
    for (const r of recipes) {
      if (r.source === "official" || r.source === "custom") continue;
      r.source = "ai";
      delete r.officialId;
      delete r.customId;
    }
    // 3餸1湯 AI：由並行候選池揀「每類型各一」（跳過 hard mergedExclude filter，改由「新鮮優先」處理，
    // 保證唔會成個類型被刪走；缺類型由下面 meal backfill 針對缺失類別補返）。
    // 食譜庫 library-first 已係完整 N餸M湯，唔再揀（避免 truncate 成 1 湯 3 餸）。
    if (soupIntent && usedParallel && !parallelFromLibrary) {
      recipes = pickDiverseMeal(recipes, mergedExclude);
      console.log(`[AI Chef] Parallel candidates picked diverse: ${recipes.length}`);
    } else if (!usedParallel && mergedExclude.length > 0 && recipes.length > 0) {
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
    // 單菜 AI 生成（非 3餸1湯、非 meal 要求）：強制 1 卡（LLM 有時會出 2-3 個，前端「AI 生成」期望 1 個）
    // 注意：mealIntent.isMeal（例如「只要兩個餸」「2個送」）要尊重數量，唔可以 truncate 成 1 卡
    if (!soupIntent && mode === "ai" && !mealIntent.isMeal && recipes.length > 1) {
      recipes = recipes.slice(0, 1);
      console.log(`[AI Chef] Single AI forced to 1 card`);
    }

    // 3餸1湯：hard filter 之後少過 target 卡 → AI 補返（補嗰啲都避開已睇過；按「缺失類別」逐類補，保證結構）
    // 速度優先：只補一輪（最多 1 次 LLM），補唔夠就靠下面食譜庫 pool 兜底（快，唔等 LLM）
    if (soupIntent && !usedParallel && recipes.length > 0 && recipes.length < totalWanted) {
      if (recipes.length < totalWanted) {
        const haveTypes = new Set(recipes.map(mealTypeOf));
        const neededTypes = (["soup", "meat", "seafood", "vegetable", "other"] as DishType[]).filter(t => !haveTypes.has(t) && (mealCount.soupCount > 0 || t !== "soup"));
        if (neededTypes.length > 0) {
          const aiPicked = await generateMissingRecipes(
            totalWanted - recipes.length,
            false,
            [...mergedExclude, ...recipes.map(r => r.name)],
            familyId,
            userId,
            neededTypes.slice(0, totalWanted - recipes.length),
            avoidIngredients
          );
          if (aiPicked.length > 0) {
            llmUsed = true;
            // 只補「缺嘅類別」（唔會重複類別）
            const haveNow = new Set(recipes.map(mealTypeOf));
            const fresh = aiPicked.filter(r => !haveNow.has(mealTypeOf(r)));
            recipes = [...recipes, ...fresh].slice(0, totalWanted);
            console.log(`[AI Chef] Meal flow topped up: +${fresh.length} (total ${recipes.length})`);
          }
        }
      }
    }

    // AI 生成必須全部係 AI 卡：唔會用食譜庫 pool 填缺。AI 補缺（上面 1 輪）唔夠就回傳 <4 全 AI 卡。
    // 具體指定菜式（例如番茄炒蛋）就唔好 random 呃人，出文字算
    const wantsFallbackCards = db && recipes.length === 0 && (mode === "ai" || isVague);
    if (wantsFallbackCards) {
      // 明確撳「AI 生成」（mode=ai，非模糊）：先叫 AI 重新諗一個全新菜（避免「AI 生成」跌去食譜庫）
      if (mode === "ai" && !isVague) {
        const freshAi = await generateMissingRecipes(1, false, mergedExclude, familyId, userId, undefined, avoidIngredients);
        if (freshAi.length > 0) {
          llmUsed = true;
          freshAi.forEach(r => { if (!r.source || r.source === "ai") r.source = "ai"; });
          recipes = freshAi;
          content = aiReply(lang, "madeNew");
          console.log(`[AI Chef] AI fresh retry: ${freshAi[0].name}`);
        }
      }
      if (recipes.length === 0) {
        // 純 AI 生成（mode="ai"）：即使 AI 失敗都唔會用食譜庫卡頂替 —— 一定全部係 AI。
        // 只係「模糊對話想睇卡」（isVague）先容許食譜庫兜底。
        if (mode === "ai" && !isVague) {
        return { content: aiReply(lang, "cantRecommend"), recipes: [], llmUsed };
        }
        const fbSearch = await trySearch(isVague ? "" : keyword || "", 30);
        if (!fbSearch.ok) {
          console.log(`[AI Chef] lib_search_fail final_fallback reason=${fbSearch.reason}`);
          return { content: searchFailureReply(lang), recipes: [], llmUsed: false, clarifyReason: "lib_search_fail" };
        }
        let fb = rowsToSuggested(fbSearch.rows, excludeSets, 1);
        if (fb.length === 0 && keyword) {
          const genSearch = await trySearch("", 1000);
          if (!genSearch.ok) {
            console.log(`[AI Chef] lib_search_fail generic_fallback reason=${genSearch.reason}`);
            return { content: searchFailureReply(lang), recipes: [], llmUsed: false, clarifyReason: "lib_search_fail" };
          }
          fb = rowsToSuggested(genSearch.rows, excludeSets, 1);
        }
        if (fb.length > 0) {
          recipes = fb;
          content = aiReply(lang, "libOne");
        }
      }
    }
  }

  if (!forceNoCards) {
    recipes = recipes.filter((recipe) => {
      const isLibraryRecipe = Boolean(recipe.officialId || recipe.customId || recipe.source === "official" || recipe.source === "custom");
      const hasName = Boolean(recipe.name && recipe.name !== "未命名食譜" && recipe.name.trim().length >= 2);
      const hasIngredients = Array.isArray(recipe.ingredients) && recipe.ingredients.length >= 2;
      const minSteps = isLibraryRecipe ? 1 : (isDessertRecipe(recipe) || isSoupRecipe(recipe)) ? 4 : 5;
      const hasSteps = Array.isArray(recipe.steps) && recipe.steps.length >= minSteps;
      return hasName && hasIngredients && hasSteps;
    });
  }

  if (!forceNoCards && recipes.length === 0) {
    content = aiReply(lang, "cantRecommend");
  } else if (!forceNoCards && (mealIntent.isMeal || requestedCount !== null) && recipes.length < totalWanted) {
    content = lang.startsWith("en")
      ? `I found ${recipes.length} recipe(s), but could not complete the requested ${totalWanted}.`
      : `我只搵到 ${recipes.length} 道食譜，未能完成你要求嘅 ${totalWanted} 道。`;
  }

  if (recipes.length > 0) {
    console.log(`[AI Chef] Returning ${recipes.length} recipes`);
    // Fix2: 記低今次出咗嘅卡，之後自動排除（唔靠前端 state）
    await recordFamilySeenNames(familyId, recipes.map(r => r.name));
  }

  return { content, recipes, llmUsed, missingRoles: resultMissingRoles ?? undefined };
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
  const parsed = (() => {
    try {
      return aiEditOutputSchema.parse(rawParsed);
    } catch {
      throw new TRPCError({ code: "BAD_REQUEST", message: "LLM 回覆格式異常，請再試。" });
    }
  })();
  
  // Apply differential check — 只作警示，唔會靜默改寫 AI 輸出（WYSIWYG：用戶睇 preview 自己決定）
  const validation = validateEditDifferential(input.recipe, parsed);
  if (!validation.safe) {
    console.warn("[AI Edit] ⚠️ Over-edit detected (warning only, no auto-fix)", {
      issues: validation.issues,
      originalRecipe: input.recipe.name,
      editPrompt: input.editPrompt
    });
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

/** C6：由線索生成 1 個食譜（AI 創作）。回傳 null 表示失敗。 */
async function generateFromHintLLM(hint: string): Promise<SuggestedRecipe | null> {
  try {
    const prompt = `請根據以下線索生成 1 個家常菜食譜（AI 創作，用繁體中文）：${hint}
烹飪邏輯（務必合理）：嫩肉（牛／豬／雞）唔好長時間煮；炒／快煮類肉類最後落；海鮮唔好過熟；蔬菜保持爽脆；醬汁要配主材料；唔好亂組合。
包含：名稱、描述、煮食時間（分鐘）、難度、份量、食材清單（名稱、數量、單位）、步驟（5-6 步）。
每個食譜同每個 ingredient 請同時提供 nameEn/nameFil/nameId；steps 係中文步驟，同時提供 stepsEn/stepsFil/stepsId（每一步對應）；description 同時提供 descriptionEn/descriptionFil/descriptionId。
回傳 JSON：{"recipes":[{"name":"...","nameEn":"...","nameFil":"...","nameId":"...","cookTime":30,"servings":4,"difficulty":"簡單","description":"...","descriptionEn":"...","descriptionFil":"...","descriptionId":"...","ingredients":[{"name":"...","nameEn":"...","nameFil":"...","nameId":"...","quantity":"...","unit":"..."}],"steps":["..."],"stepsEn":["..."],"stepsFil":["..."],"stepsId":["..."]}]}`;
    const resp = await invokeLLM({
      messages: [{ role: "user", content: prompt }],
      maxTokens: 3000,
      temperature: 0.7,
      timeoutMs: AI_RECIPE_LLM_TIMEOUT_MS,
      maxRetries: 1,
      enableSearch: false,
      responseFormat: { type: "json_object" },
    });
    const raw = resp.choices?.[0]?.message?.content || "";
    const parsed = parseRecipeWithFallback(raw);
    if (parsed.recipes.length > 0) return parsed.recipes[0];
    const extracted = extractJSON<Record<string, unknown>>(raw);
    if (extracted && (extracted as any).name) {
      const single = manuallyConvertRecipes([extracted], undefined);
      if (single.length > 0) return single[0];
    }
    return null;
  } catch (e) {
    console.warn("[generateFromHint] failed:", (e as Error)?.message);
    return null;
  }
}

/** AI 補齊：只根據現有材料補缺失做法（唔准加新材料）。 */
async function fillStepsLLM(input: { name: string; description?: string; ingredients: { name: string; quantity?: string; unit?: string }[]; steps: string[] }): Promise<SuggestedRecipe | null> {
  try {
    const ingText = input.ingredients.map((i) => `${i.name}${i.quantity ? " " + i.quantity : ""}${i.unit ? " " + i.unit : ""}`).join("、");
    const prompt = `以下食譜缺少部分做法（例如某個醬汁／配菜嘅做法）。請**只根據現有材料**補齊完整、合理嘅做法，**唔准加入新材料**，亦唔准改動材料清單。
菜名：${input.name}
簡介：${input.description ?? ""}
現有材料：${ingText}
現有步驟：${JSON.stringify(input.steps)}
用繁體中文寫步驟（4-8 步，清晰可煮）；同時提供 stepsEn/stepsFil/stepsId（每一步對應，份量/時間一致）。
回傳 JSON：{"recipes":[{"name":"${input.name}","steps":["..."],"stepsEn":["..."],"stepsFil":["..."],"stepsId":["..."]}]}`;
    const resp = await invokeLLM({
      messages: [{ role: "user", content: prompt }],
      maxTokens: 3500,
      temperature: 0.5,
      timeoutMs: AI_RECIPE_LLM_TIMEOUT_MS,
      maxRetries: 1,
      responseFormat: { type: "json_object" },
    });
    const raw = resp.choices?.[0]?.message?.content || "";
    // 直接解析（唔靠 parseRecipeWithFallback：佢要求完整 recipe 欄位，會丟 steps-only 回應）
    let o: any = extractJSON<Record<string, unknown>>(raw);
    if (!o) { try { o = JSON.parse(repairJSON(raw)); } catch { o = null; } }
    const r: any = o?.recipes?.[0] ?? o;
    const mapSteps = (a: any) => (Array.isArray(a) ? a.map((s: any) => String(s)).filter(Boolean) : undefined);
    const steps = Array.isArray(r?.steps) ? r.steps.map((s: any) => String(s)).filter(Boolean)
      : (Array.isArray(r?.instructions) ? r.instructions.map((s: any) => String(s)).filter(Boolean) : []);
    if (steps.length === 0) return null;
    // 保留原名稱＋原材料；只用 AI 嘅步驟
    return {
      name: input.name,
      description: input.description ?? "",
      cookTime: Number(r?.cookTime ?? 30),
      servings: Number(r?.servings ?? 2),
      difficulty: String(r?.difficulty ?? "中等"),
      ingredients: input.ingredients.map((i) => ({ name: i.name, quantity: i.quantity ?? "", unit: i.unit ?? "" })),
      steps,
      stepsEn: mapSteps(r?.stepsEn),
      stepsFil: mapSteps(r?.stepsFil),
      stepsId: mapSteps(r?.stepsId),
      tags: Array.isArray(r?.tags) ? r.tags.map((x: any) => String(x)) : [],
    } as SuggestedRecipe;
  } catch (e) {
    console.warn("[fillSteps] failed:", (e as Error)?.message);
    return null;
  }
}

/** C6：由食物相生成 1 個相似食譜（AI 創作，vision）。回傳 null 表示失敗。 */
async function generateFromImageLLM(imageUrls: string[]): Promise<SuggestedRecipe | null> {
  try {
    const prompt = `睇以下食物相，**生成一個相似嘅家常菜食譜（AI 創作）**。分析相中菜式（食材、醬汁、煮法），產生一個合理、可煮嘅食譜。
烹飪邏輯（務必合理）：嫩肉（牛／豬／雞）唔好長時間煮；炒／快煮類肉類最後落；海鮮唔好過熟；蔬菜保持爽脆；醬汁要配主材料；唔好亂組合。
用繁體中文。包含：名稱、描述、煮食時間（分鐘）、難度、份量、食材清單（名稱、數量、單位）、步驟（4-6 步）。
每個食譜同每個 ingredient 請同時提供 nameEn/nameFil/nameId；steps 係中文步驟，同時提供 stepsEn/stepsFil/stepsId（每一步對應）；description 同時提供 descriptionEn/descriptionFil/descriptionId。
回傳 JSON：{"recipes":[{"name":"...","nameEn":"...","nameFil":"...","nameId":"...","cookTime":30,"servings":2,"difficulty":"簡單","description":"...","descriptionEn":"...","descriptionFil":"...","descriptionId":"...","ingredients":[{"name":"...","nameEn":"...","nameFil":"...","nameId":"...","quantity":"...","unit":"..."}],"steps":["..."],"stepsEn":["..."],"stepsFil":["..."],"stepsId":["..."]}]}`;
    const content = [
      ...imageUrls.map((u) => ({ type: "image_url" as const, image_url: { url: u, detail: "high" as const } })),
      { type: "text" as const, text: prompt },
    ];
    const resp = await invokeLLM({
      messages: [{ role: "user", content: content as any }],
      maxTokens: 3000,
      temperature: 0.6,
      timeoutMs: AI_RECIPE_LLM_TIMEOUT_MS,
      maxRetries: 1,
      responseFormat: { type: "json_object" },
    });
    const raw = resp.choices?.[0]?.message?.content || "";
    const parsed = parseRecipeWithFallback(raw);
    if (parsed.recipes.length > 0) return parsed.recipes[0];
    const extracted = extractJSON<Record<string, unknown>>(raw);
    if (extracted && (extracted as any).name) {
      const single = manuallyConvertRecipes([extracted], undefined);
      if (single.length > 0) return single[0];
    }
    return null;
  } catch (e) {
    console.warn("[generateFromImage] failed:", (e as Error)?.message);
    return null;
  }
}

export const aiRecipeRouter = router({
  // C6：由線索（菜名／caption）AI 生成 1 個食譜（明確 AI 創作，唔冒充原帖）
  generateFromHint: protectedProcedure
    .input(z.object({ hint: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "請先加入家庭廚房" });
      const familyId = ctx.activeFamilyId;
      const userId = String(ctx.user.id);
      const ent = await getFamilyEntitlements(familyId, userId);
      if (!ent) throw new TRPCError({ code: "NOT_FOUND", message: "找不到家庭廚房" });
      if (ent.readOnly) throw new TRPCError({ code: "FORBIDDEN", message: "你目前只可檢視此廚房。" });
      startLlmMeter({ familyId, userId, route: "ai_hint", requestId: randomUUID() });

      try {
        const recipe = await runWithUsage(
          {
            familyId,
            userId,
            kind: "ai_generate",
            limits: ent.limits,
            idempotencyKey: `ai_hint:${familyId}:${userId}:${randomUUID()}`,
            cost: { credits: 2 },
          },
          async () => {
            const generated = await generateFromHintLLM(input.hint);
            if (!generated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 生成失敗，請再試。" });
            return generated;
          }
        );
        try { await incrementAiChatUsage(familyId, userId, 2); } catch { /* history */ }
        const localized = await localizeSuggestedRecipe(recipe);
        return { recipe: localized };
      } catch (error) {
        usageLimitToTRPC(error);
      }
    }),

  // C6：由食物相（vision）AI 生成 1 個相似食譜（明確 AI 創作，Pro）
  generateFromImage: protectedProcedure
    .input(z.object({ storageKeys: z.array(z.string()).min(1).max(5) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "請先加入家庭廚房" });
      const familyId = ctx.activeFamilyId;
      const userId = String(ctx.user.id);
      const ent = await getFamilyEntitlements(familyId, userId);
      if (!ent) throw new TRPCError({ code: "NOT_FOUND", message: "找不到家庭廚房" });
      if (!ent.isPaid) throw new TRPCError({ code: "FORBIDDEN", message: "AI 生成相片食譜係 Pro 功能。" });
      if (ent.readOnly) throw new TRPCError({ code: "FORBIDDEN", message: "你目前只可檢視此廚房。" });
      startLlmMeter({ familyId, userId, route: "ai_image", requestId: randomUUID() });
      // 安全：只可讀自己家庭嘅截圖（防 IDOR）
      for (const k of input.storageKeys) {
        if (!k.startsWith(`recipe-screenshots/f${familyId}/`)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "無權存取此檔案" });
        }
      }
      try {
        const recipe = await runWithUsage(
          {
            familyId,
            userId,
            kind: "ai_image",
            limits: ent.limits,
            idempotencyKey: `ai_image:${familyId}:${userId}:${randomUUID()}`,
            cost: { credits: 2 },
          },
          async () => {
            const urls = await Promise.all(input.storageKeys.map((k) => storageGetSignedUrl(k)));
            const generated = await generateFromImageLLM(urls);
            if (!generated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 生成失敗，請再試。" });
            return generated;
          }
        );
        try { await incrementAiChatUsage(familyId, userId, 2); } catch { /* history */ }
        const localized = await localizeSuggestedRecipe(recipe);
        return { recipe: localized };
      } catch (error) {
        usageLimitToTRPC(error);
      }
    }),

  // AI 補齊：保留原材料，只補缺失做法（有據、標示 AI）
  fillSteps: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(128),
      description: z.string().optional(),
      ingredients: z.array(z.object({ name: z.string(), quantity: z.string().optional(), unit: z.string().optional() })).min(1),
      steps: z.array(z.string()).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "請先加入家庭廚房" });
      const familyId = ctx.activeFamilyId;
      const userId = String(ctx.user.id);
      const ent = await getFamilyEntitlements(familyId, userId);
      if (!ent) throw new TRPCError({ code: "NOT_FOUND", message: "找不到家庭廚房" });
      if (ent.readOnly) throw new TRPCError({ code: "FORBIDDEN", message: "你目前只可檢視此廚房。" });
      startLlmMeter({ familyId, userId, route: "ai_fill", requestId: randomUUID() });
      try {
        const recipe = await runWithUsage(
          {
            familyId,
            userId,
            kind: "ai_edit",
            limits: ent.limits,
            idempotencyKey: `ai_fill:${familyId}:${userId}:${randomUUID()}`,
            cost: { credits: 1 },
          },
          async () => {
            const generated = await fillStepsLLM(input);
            if (!generated || !Array.isArray(generated.steps) || generated.steps.length === 0) {
              throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 補齊失敗，請再試。" });
            }
            return generated;
          }
        );
        try { await incrementAiChatUsage(familyId, userId, 1); } catch { /* history */ }
        const localized = await localizeSuggestedRecipe(recipe);
        return { recipe: localized };
      } catch (error) {
        usageLimitToTRPC(error);
      }
    }),

  previewEdit: familyWriteProcedure
    .input(aiEditSaveInputSchema)
    .mutation(async ({ input, ctx }) => {
      if (!ctx.activeFamilyId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No family found" });
      }

      const familyId = ctx.activeFamilyId;
      const userId = String(ctx.user.id);
      const ent = await getFamilyEntitlements(familyId, userId);
      if (!ent) throw new TRPCError({ code: "NOT_FOUND", message: "找不到家庭廚房" });
      if (ent.readOnly) throw new TRPCError({ code: "FORBIDDEN", message: "你目前只可檢視此廚房。" });

      assertSupportedEditLanguage(input.editPrompt);
      startLlmMeter({ familyId, userId, route: "ai_edit", requestId: randomUUID() });
      let parsed: Awaited<ReturnType<typeof runAiEdit>>;
      try {
        parsed = await runWithUsage(
          {
            familyId,
            userId,
            kind: "ai_edit",
            limits: ent.limits,
            idempotencyKey: `ai_edit:${familyId}:${userId}:${randomUUID()}`,
            cost: { credits: 1 },
          },
          () => runAiEdit(input, familyId, userId)
        );
        try { await incrementAiChatUsage(familyId, userId, 1); } catch { /* history */ }
      } catch (error) {
        usageLimitToTRPC(error);
      }

      // 補齊食材翻譯（schema 放寬後模型可能省略 nameEn/Fil/Id）→ 菲/印用戶唔會見到中文
      let ingredients = parsed.ingredients.length > 0 ? parsed.ingredients : input.recipe.ingredients;
      if (ingredients.length > 0) {
        try {
          const enriched = JSON.parse(await withIngredientTranslations(ingredients));
          if (Array.isArray(enriched) && enriched.length === ingredients.length) ingredients = enriched;
        } catch { /* 翻譯失敗 → 用原文 */ }
      }

      // 是否實質無改（容忍比對）→ 前端可提示「AI 改唔到」而唔當成功
      const _n = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, "");
      const _origIng = (input.recipe.ingredients ?? []).map((i: any) => _n(i?.name)).filter(Boolean).sort().join("|");
      const _editIng = (ingredients ?? []).map((i: any) => _n(i?.name)).filter(Boolean).sort().join("|");
      const _origSteps = (input.recipe.steps ?? []).map((s: any) => _n(typeof s === "string" ? s : s?.instruction)).filter(Boolean).join("|");
      const _editSteps = (parsed.steps ?? []).map((s: any) => _n(s?.instruction)).filter(Boolean).join("|");
      const unchanged =
        _n(input.recipe.name) === _n(parsed.name) && _origIng === _editIng && _origSteps === _editSteps;

      return {
        unchanged,
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
        difficulty: normalizeDifficulty(parsed.difficulty || input.recipe.difficulty),
        recipeCategory: parsed.recipeCategory || input.recipe.recipeCategory,
        dishType: parsed.dishType || (input.recipe as any).dishType,
        ingredients,
        steps: parsed.steps.length > 0 ? parsed.steps : input.recipe.steps,
        stepsEn: parsed.stepsEn,
        stepsFil: parsed.stepsFil,
        stepsId: parsed.stepsId,
        tags: Array.from(new Set([...(input.recipe.tags ?? []), ...(parsed.tags ?? []), "AI 生成"])),
      };
    }),

  saveEditedRecipe: familyWriteProcedure
    .input(aiEditPersistInputSchema)
    .mutation(async ({ input, ctx }) => {
      if (!ctx.activeFamilyId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No family found" });
      }

      const familyId = ctx.activeFamilyId;
      const userId = String(ctx.user.id);
      const ent = await getFamilyEntitlements(familyId, userId);
      if (!ent) throw new TRPCError({ code: "NOT_FOUND", message: "找不到家庭廚房" });
      if (ent.readOnly) throw new TRPCError({ code: "FORBIDDEN", message: "你目前只可檢視此廚房。" });

      assertSupportedEditLanguage(input.editPrompt);

      const parsed = input.recipe;
      const mergedTags = Array.from(new Set([
        ...(parsed.tags ?? []),
        "AI 生成",
      ]));

      let saved: Awaited<ReturnType<typeof insertCustomRecipe>>;
      try {
        saved = await runWithUsage(
          {
            familyId,
            userId,
            kind: "custom_recipe",
            limits: ent.limits,
            idempotencyKey: `ai_save:${familyId}:${userId}:${randomUUID()}`,
            cost: { customRecipes: 1 },
          },
          () => insertCustomRecipe({
        familyId,
        createdByUserId: userId,
        name: parsed.name,
        nameEn: parsed.nameEn,
        nameFil: parsed.nameFil,
        nameId: parsed.nameId,
        description: parsed.description,
        descriptionEn: parsed.descriptionEn,
        descriptionFil: parsed.descriptionFil,
        descriptionId: parsed.descriptionId,
        image: parsed.image ?? "",
        thumbnailUrl: parsed.thumbnailUrl ?? parsed.image ?? "",
        cookTime: parsed.cookTime,
        servings: parsed.servings,
        difficulty: normalizeDifficulty(parsed.difficulty),
        recipeCategory: parsed.recipeCategory,
        dishType: parsed.dishType,
        ingredients: JSON.stringify(parsed.ingredients),
        steps: JSON.stringify(parsed.steps),
        stepsEn: parsed.stepsEn ? JSON.stringify(parsed.stepsEn) : undefined,
        stepsFil: parsed.stepsFil ? JSON.stringify(parsed.stepsFil) : undefined,
        stepsId: parsed.stepsId ? JSON.stringify(parsed.stepsId) : undefined,
        tags: JSON.stringify(mergedTags),
        sourceType: "manual",
        sourceAuthor: undefined,
        isAiGenerated: true,
          })
        );
      } catch (error) {
        usageLimitToTRPC(error);
      }

      return { success: true, id: saved.id, name: saved.name };
    }),

  status: protectedProcedure.query(async ({ ctx }) => {
    const familyId = ctx.activeFamilyId ?? undefined;
    const userIdStr = ctx.user?.id ? String(ctx.user.id) : undefined;
    if (!familyId || !userIdStr) {
      return {
        credits: { used: 0, limit: 0, resetAt: getNextResetAt() },
        canGenerate: false,
        reason: "unauthenticated" as const,
        mode: "normal" as const,
      };
    }
    const userId = userIdStr;
    const ent = await getFamilyEntitlements(familyId, userId);
    const summary = await getUsageSummary(familyId);
    const flagState = await getAiChefMode(familyId);
    const cap = await getAiChefCapMicros(familyId, userId);
    const budget = await getLlmBudgetState(familyId, userId);
    const creditsFull = summary.aiCredits >= (ent?.limits.aiCredits ?? 0);
    const capHit = flagState.flags.ai_chef_hard_cap !== false && (
      budget.familyActual + budget.familyReserved >= cap.family ||
      budget.memberActual + budget.memberReserved >= cap.member
    );
    const blockedBySafeMode = flagState.mode !== "normal";
    const blockedByFreeFlag = flagState.flags.ai_chef_free_no_ai === true && ent?.status === "free";
    const canGenerate = !creditsFull && !capHit && !blockedBySafeMode && !blockedByFreeFlag && !ent?.readOnly;
    const reason = blockedBySafeMode ? "safe_mode"
      : capHit ? "internal_cap"
        : creditsFull ? "credits"
          : blockedByFreeFlag ? "free_ai_off"
            : "ok";
    return {
      credits: {
        used: summary.aiCredits,
        limit: ent?.limits.aiCredits ?? 0,
        resetAt: getNextResetAt(),
      },
      canGenerate,
      reason,
      mode: flagState.mode,
    };
  }),

  chat: protectedProcedure
    .input(z.object({
      messages: z.array(messageSchema).min(1),
      mode: z.enum(["chat", "ai", "library"]).optional(),
      excludeNames: z.array(z.string()).optional(),
      avoidIngredients: z.array(z.string().max(40)).max(20).optional(),
      forceText: z.boolean().optional(),
      lang: z.string().optional(),
      clientMessageId: z.string().min(1).max(128).optional(),
      chatId: z.string().max(64).optional(),
      operation: z.enum(["replace", "append"]).optional(),
      search: z.object({
        query: z.string().optional(),
        tags: z.array(z.string()).optional(),
        cookTimeMax: z.number().optional(),
        category: z.string().optional(),
        count: z.number().int().min(1).max(10).optional(),
        rank: z.enum(["shortestTime", "default"]).optional(),
        excludeCategories: z.array(z.string()).optional(),
        scenario: z.enum(["quick", "healthy", "ricecooker", "kids", "guest"]).optional(),
      }).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const familyId = ctx.activeFamilyId ?? undefined;
      const userId = ctx.user?.id ? Number(ctx.user.id) : undefined;
      const userIdStr = ctx.user?.id ? String(ctx.user.id) : undefined;
      const requestId = randomUUID();
      const meter = startLlmMeter({
        familyId,
        userId: userIdStr,
        route: "ai_recipe_chat",
        requestId,
      });
      const mode = input.mode ?? "chat";
      const excludeNames = input.excludeNames ?? [];
      const avoidIngredients = input.avoidIngredients ?? [];
      const hasMedia = input.messages.some((m) => {
        if (typeof m.content === "string") return /(https?:\/\/|data:image)/i.test(m.content);
        return m.content.some((c) => c.type === "image_url");
      });
      const intent = resolveChefIntent(lastUserText(input.messages), {
        hasImage: hasMedia,
        mode,
        forceText: input.forceText,
        noodleRole: AI_CHEF_NOODLE_ROLE,
        previousUserText: previousUserText(input.messages),
      });
      const requestedCredits = hasMedia ? 2 : 1;
      let quota: { limit: number; used: number; nearLimit: boolean } | undefined;
      let reservationId: number | undefined;
      let budgetReservationId: number | undefined;
      let effectiveMode: "chat" | "ai" | "library" = mode;
      let allowAiFallback = true;
      let allowChatLlm = true;

      const flagState = familyId
        ? await getAiChefMode(familyId)
        : { mode: "normal" as const, flags: getFeatureFlags() };
      const truthfulContract = flagState.flags.ai_chef_truthful_contract === true;
      const clientMessageIdEnabled = flagState.flags.ai_chef_client_message_id === true;
      const idempotencyKey = familyId && clientMessageIdEnabled && input.clientMessageId
        ? { familyId, chatId: input.chatId, clientMessageId: input.clientMessageId }
        : undefined;
      const idempotencyStore = idempotencyKey
        ? createAiChefRequestStore(String(ctx.user.id))
        : undefined;
      const payloadHash = idempotencyKey
        ? hashChefPayload({
            messages: input.messages,
            mode: input.mode,
            excludeNames: input.excludeNames,
            avoidIngredients: input.avoidIngredients,
            forceText: input.forceText,
            lang: input.lang,
            operation: input.operation,
            search: input.search,
          })
        : "";

      if (idempotencyStore && idempotencyKey) {
        const cached = await idempotencyStore.find(idempotencyKey);
        if (cached) {
          if (cached.payloadHash !== payloadHash) {
            throw new TRPCError({ code: "CONFLICT", message: "呢個訊息已經用過，內容唔一致，請重新發送。" });
          }
          return {
            ...(cached.response as Record<string, unknown>),
            idempotency: { decision: "reuse", creditsCharged: 0, llmCalls: 0 },
          };
        }
      }

      if (familyId) {
        const userIdStr = String(ctx.user.id);
        const ent = await getFamilyEntitlements(familyId, userIdStr);
        if (!ent) throw new TRPCError({ code: "NOT_FOUND", message: "找不到家庭廚房" });
        const summary = await getUsageSummary(familyId);
        quota = {
          limit: ent.limits.aiCredits,
          used: summary.aiCredits,
          nearLimit: summary.aiCredits >= ent.limits.aiCredits,
        };

        if (!intent.wantsCards) {
          const chatQuota = await getChatQuotaState(
            familyId,
            userIdStr,
            ent.plan === "free" ? "free" : "pro",
          );
          allowChatLlm = chatQuota.allowed;
          console.log(`[AI Chef] chat_quota_used=${chatQuota.dailyUsed}/${chatQuota.dailyLimit} monthly=${chatQuota.monthlyUsed}/${chatQuota.monthlyLimit} chat_budget=${chatQuota.monthlyCostMicros}/${chatQuota.costCapMicros} bucket=chat allowed=${chatQuota.allowed} reason=${chatQuota.reason}`);
        }

        const userLibraryMode = mode === "library";
        if (flagState.mode !== "normal" || (flagState.flags.ai_chef_free_no_ai === true && ent.status === "free")) {
          effectiveMode = "library";
          allowAiFallback = false;
        } else if (!ent.readOnly && (effectiveMode !== "library" || userLibraryMode) && flagState.flags.ai_chef_hard_cap !== false) {
          const cap = await getAiChefCapMicros(familyId, userIdStr);
          const estimateMicros = intent.requested.total > 1 ? 25_000 : 6_000;
          try {
            budgetReservationId = await reserveLlmBudget({
              familyId,
              userId: userIdStr,
              estimateMicros,
              familyCapMicros: cap.family,
              memberCapMicros: cap.member,
            });
          } catch (error) {
            if (error instanceof LlmBudgetError) {
              effectiveMode = "library";
              allowAiFallback = false;
              console.warn(`[AI Chef] budget layer1 ${error.reason} family=${familyId}`);
            } else {
              throw error;
            }
          }
        }

        if (ent.readOnly && effectiveMode !== "library") {
          throw new TRPCError({ code: "FORBIDDEN", message: "你目前只可檢視此廚房。" });
        }
        if (ent.readOnly) allowAiFallback = false;

        // Library mode can still use AI as a last resort for missing roles. Reserve
        // exactly like chat so an AI-produced card cannot be free; pure-library
        // responses release this reservation in finalizeChefRequest.
        if (effectiveMode !== "library" || (userLibraryMode && allowAiFallback)) {
          try {
            const reservation = await reserveUsage({
              familyId,
              userId: userIdStr,
              kind: hasMedia ? "ai_image" : "ai_chat",
              limits: ent.limits,
              idempotencyKey: `ai_chat:${familyId}:${userIdStr}:${randomUUID()}`,
              cost: { credits: requestedCredits },
            });
            reservationId = reservation.eventId;
            quota.used += requestedCredits;
            quota.nearLimit = quota.used >= quota.limit;
          } catch (error) {
            if (budgetReservationId) await releaseLlmBudget(budgetReservationId).catch(() => {});
            if (userLibraryMode) {
              allowAiFallback = false;
              console.warn("[AI Chef] library mode credit reservation unavailable -> pure library only");
            } else {
              usageLimitToTRPC(error);
            }
          }
        }
      }

      let idempotencyClaimed = false;
      if (idempotencyStore && idempotencyKey) {
        try {
          const claim = await idempotencyStore.claim!(idempotencyKey, payloadHash);
          if (claim.decision === "reuse") {
            if (budgetReservationId) await releaseLlmBudget(budgetReservationId).catch(() => {});
            if (reservationId) await refundUsage(reservationId).catch(() => {});
            return {
              ...(claim.cached.response as Record<string, unknown>),
              idempotency: { decision: "reuse", creditsCharged: 0, llmCalls: 0 },
            };
          }
          if (claim.decision === "conflict") {
            if (budgetReservationId) await releaseLlmBudget(budgetReservationId).catch(() => {});
            if (reservationId) await refundUsage(reservationId).catch(() => {});
            throw new TRPCError({ code: "CONFLICT", message: "呢個訊息已經處理中，請勿重複送出。" });
          }
          idempotencyClaimed = true;
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          if (budgetReservationId) await releaseLlmBudget(budgetReservationId).catch(() => {});
          if (reservationId) await refundUsage(reservationId).catch(() => {});
          throw error;
        }
      }

      const reqStartedAt = Date.now();
      let result: Awaited<ReturnType<typeof processAIChefChat>>;
      try {
        result = await processAIChefChat(
          input.messages.map(m => ({ role: m.role, content: m.content })),
          familyId,
          userId,
          effectiveMode,
          excludeNames,
          input.search,
          input.lang,
          avoidIngredients,
          input.forceText === true,
          flagState.flags,
          input.operation ?? "replace",
          allowAiFallback,
          allowChatLlm,
        );
      } catch (error) {
        if (idempotencyClaimed && idempotencyStore && idempotencyKey) {
          await idempotencyStore.release?.(idempotencyKey).catch(() => {});
        }
        if (budgetReservationId) await releaseLlmBudget(budgetReservationId).catch(() => {});
        if (reservationId) await refundUsage(reservationId).catch(() => {});
        throw error;
      }
      const generateMs = Date.now() - reqStartedAt;
      if (avoidIngredients.length > 0) {
        const safeRecipes = result.recipes.filter((recipe) => !recipeContainsAvoid(recipe, avoidIngredients));
        if (safeRecipes.length !== result.recipes.length) {
          console.warn(`[AI Chef] removed ${result.recipes.length - safeRecipes.length} recipe(s) containing avoid ingredients`);
          result.recipes = safeRecipes;
        }
      }

      const effectiveIntent = result.intentOverride ?? intent;
      const served = result.recipes?.length ?? 0;
      const requested = effectiveIntent.requested.total;
      const incompleteSet = requested > 0 && served < requested;
      // Any food/card request that served zero cards is a failed request, not a
      // normal text answer. Do not charge it, and never claim cards were prepared.
      const zeroCardFood = served === 0 && effectiveIntent.wantsCards === true && !result.clarifyReason;
      // Also catch a prose answer that explicitly promises cards even if intent
      // was misclassified (the existing narrow guard).
      const cardClaim = served === 0 && claimsRecipeCards(String(result.content ?? ""));
      if (zeroCardFood || cardClaim) {
        console.warn(`[AI Chef] zero-card refund reason=${zeroCardFood ? "wants_cards" : "card_claim"}`);
      }
      const aiCards = result.recipes.filter((recipe) => (recipe.source ?? "ai") === "ai").length;
      const shouldCharge = shouldChargeChefRequest({ served, aiCards });

      const responseLang = input.lang ?? "zh-TW";
      if (zeroCardFood || cardClaim) {
        result.content = zeroCardFoodReply(responseLang);
      }
      let localizeMs = 0;
      if (!responseLang.startsWith("zh")) {
        const localizeStartedAt = Date.now();
        try {
          result.recipes = await localizeSuggestedRecipes(result.recipes ?? [], responseLang);
        } catch (error) {
          if (budgetReservationId) await releaseLlmBudget(budgetReservationId).catch(() => {});
          if (reservationId) await refundUsage(reservationId).catch(() => {});
          if (idempotencyClaimed && idempotencyStore && idempotencyKey) {
            await idempotencyStore.release?.(idempotencyKey).catch(() => {});
          }
          throw error;
        }
        localizeMs = Date.now() - localizeStartedAt;
      }
      if (budgetReservationId) {
        if (result.llmUsed) {
          await finalizeLlmBudget(budgetReservationId).catch(async (e) => {
            console.warn("[AI Chef] finalize budget failed:", (e as Error)?.message || e);
            await releaseLlmBudget(budgetReservationId).catch(() => {});
          });
        } else {
          await releaseLlmBudget(budgetReservationId).catch(() => {});
        }
      }

      const missingRoles = (result.missingRoles && result.missingRoles.length > 0)
        ? result.missingRoles
        : requested > served
          ? effectiveIntent.requested.roles.slice(served)
          : [];
      const sources = (result.recipes ?? []).reduce(
        (acc, recipe) => {
          if (recipe.source === "official" || recipe.source === "custom") acc.library += 1;
          else acc.ai += 1;
          return acc;
        },
        { library: 0, ai: 0 },
      );
      const resolved = requested === 0 || served >= requested;

      // Build and validate the contract BEFORE mutating credit. A malformed
      // truthful response must not charge the user and then return 500.
      let contract: ReturnType<typeof buildChefReply> | null = null;
      if (truthfulContract) {
        contract = buildChefReply({
          requestId,
          chatId: input.chatId,
          clientMessageId: input.clientMessageId,
          intent: effectiveIntent,
          lang: responseLang,
          templateText: true,
          operation: input.operation,
          result: {
            content: result.content,
            recipes: result.recipes,
            llmUsed: result.llmUsed,
            missingRoles,
            llmCalls: meter.calls,
          },
        });
        const contractErrors = validateChefReply(contract);
        if (contractErrors.length > 0) {
          console.error(`[AI Chef] contract validation failed: ${contractErrors.join("; ")}`);
          if (idempotencyClaimed && idempotencyStore && idempotencyKey) {
            await idempotencyStore.release?.(idempotencyKey).catch(() => {});
          }
          if (reservationId) await refundUsage(reservationId).catch(() => {});
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 回覆格式異常，請再試。" });
        }
      }

      const finalized = await finalizeChefRequest({
        truthful: truthfulContract,
        shouldCharge,
        requestedCredits,
        reservationId,
        buildContract: truthfulContract ? () => buildChefReply({
          requestId,
          chatId: input.chatId,
          clientMessageId: input.clientMessageId,
          intent: effectiveIntent,
          lang: responseLang,
          templateText: true,
          operation: input.operation,
          result: {
            content: result.content,
            recipes: result.recipes,
            llmUsed: result.llmUsed,
            missingRoles,
            llmCalls: meter.calls,
          },
        }) : undefined,
        validate: (contract) => {
          const errors = validateChefReply(contract);
          if (errors.length > 0) console.error(`[AI Chef] contract validation failed: ${errors.join("; ")}`);
          return errors;
        },
        buildLegacy: async (contract) => {
          if (familyId) {
            const summary = await getUsageSummary(familyId);
            const limit = quota?.limit ?? 0;
            quota = { limit, used: summary.aiCredits, nearLimit: summary.aiCredits >= limit };
          }
          const legacy: Record<string, unknown> = {
            ...result,
            quota,
            requestId,
            intent: effectiveIntent,
            requested: effectiveIntent.requested,
            served,
            missingRoles,
            sources,
            warnings: missingRoles.length > 0 ? ["incomplete_set", "credits_refunded"] : [],
          };
          if (contract) {
            const contractCards = contract.recipes;
            const legacyCards = Array.isArray(legacy.recipes) ? legacy.recipes as any[] : [];
            legacy.recipes = legacyCards.map((card, i) => ({
              ...card,
              ...(contractCards[i]?.cardId ? { cardId: contractCards[i].cardId } : {}),
            }));
          }
          return legacy;
        },
        applyContract: (legacy, contract) => {
          const applied = applyTruthfulContract(legacy, contract, true);
          applied.chatId = input.chatId;
          applied.clientMessageId = input.clientMessageId;
          return applied;
        },
        commitUsage: async (id) => commitUsage(id),
        refundUsage: async (id) => refundUsage(id),
        saveIdempotency: idempotencyStore && idempotencyKey
          ? async (response) => idempotencyStore.save(idempotencyKey, { payloadHash, response })
          : undefined,
        releaseIdempotency: idempotencyClaimed && idempotencyStore && idempotencyKey
          ? async () => idempotencyStore.release?.(idempotencyKey)
          : undefined,
      });
      const finalResponse = finalized.response;
      const creditsCharged = finalized.creditsCharged;
      if (creditsCharged > 0 && familyId) {
        try { await incrementAiChatUsage(familyId, String(ctx.user.id), requestedCredits); } catch { /* history */ }
      }
      if (!shouldCharge && incompleteSet) {
        console.log(`[AI Chef] refund partial set requested=${requested} served=${served} credits=${requestedCredits}`);
      }
      const metricPath = isCannedMealPrompt(lastUserText(input.messages))
        || (isMealFollowUp(lastUserText(input.messages)) && isCannedMealPrompt(previousUserText(input.messages)))
        ? "canned"
        : "user";
      console.log(`[AI Chef] perf lang=${responseLang} recipes=${result.recipes?.length ?? 0} generateMs=${generateMs} localizeMs=${localizeMs} totalMs=${Date.now() - reqStartedAt}`);
      console.log(`[AI Chef] meter calls=${meter.calls} in=${meter.inputTokens} out=${meter.outputTokens} estCostUSD=${meter.costUsd.toFixed(4)} creditsCharged=${creditsCharged}`);
      console.log(`[AI Chef][metric] request=${requestId} path=${metricPath} kind=${effectiveIntent.kind} roles=${effectiveIntent.requested.roles.join("|") || "none"} requested=${requested} served=${served} resolved=${resolved} partial=${!resolved} missing=${missingRoles.join(",") || "none"} lib=${sources.library} ai=${sources.ai} latencyMs=${Date.now() - reqStartedAt} costUsd=${meter.costUsd.toFixed(4)} credits=${creditsCharged}`);
      if (clientMessageIdEnabled) {
        finalResponse.idempotency = { decision: "miss", creditsCharged, llmCalls: meter.calls };
      }
      return finalResponse;
    }),
});
