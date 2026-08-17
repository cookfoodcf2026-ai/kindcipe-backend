import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, or, ilike, desc, lte } from "drizzle-orm";
import { protectedProcedure, familyWriteProcedure, router } from "../_core/trpc";
import { invokeLLM, extractJSON, Message, MessageContent, TextContent, ImageContent } from "../_core/llm";
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

export type SuggestedRecipe = {
  name: string;
  cookTime: number;
  servings: number;
  difficulty: string;
  description: string;
  ingredients: { name: string; quantity: string; unit: string }[];
  steps: string[];
  tags: string[];
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
      maxTokens: 4096, temperature: 0.3,
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
    const res = await execSearchRecipes(db, { query: name, limit: 8 }, familyId);
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
function buildSystemPrompt(mode: "library" | "ai" | undefined, libSummary: string): string {
  let modeSection = "";
  if (mode === "library") {
    modeSection = `\n\n📚 【只限食譜庫模式】你現在只能從以下食譜庫清單中推薦，**禁止生成任何新食譜**。推薦時必須原裝保留食譜名，唔好加 emoji / 改字 / 加前後綴。如果清單中沒有合適的，請明確告訴用戶「食譜庫暫時未有相關食譜，你可以按下面嘅 ✨ AI 生成 掣，我會幫你原創一組」。\n\n${libSummary}`;
  } else if (mode === "ai") {
    modeSection = `\n\n✨ 【AI 生成模式】以下係食譜庫已有嘅食譜清單。你生成嘅食譜**嚴禁**與清單中任何食譜名稱或菜式相同／近似。如果庫內已經有啱用嘅食譜，請直接推薦庫內嗰個並話用戶知，唔好另作近似原創。\n\n${libSummary}`;
  } else {
    modeSection = `\n\n📖 【食譜庫現有食譜】以下係用戶食譜庫入面嘅食譜。請**優先**從以上清單推薦；清單無合適先 AI 生成新食譜。\n\n${libSummary}`;
  }

  return SYSTEM_PROMPT + modeSection;
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
5. 當用戶要求「加入排餐」時，請以食譜格式輸出完整食譜，用戶可以喺前端選擇日期同餐次再加入排餐
6. ⚠️ 你**冇任何**「加入排餐／加入購物清單／收藏食譜／寫入庫」嘅工具。當用戶要求「加入排餐」「加入購物清單」「收藏」，你**唔可以**話「已幫你加入」「搞掂」「完成」。正確做法：如果上面已經推薦咗食譜，話「你㩒卡片上嘅『加排餐』／『加入購物清單』／『收藏』掣就可以」；如果未推薦任何食譜，請先按格式推薦完整食譜，再提示用戶用卡片上嘅掣操作。若同時唔想加入，可用對話式回覆引導

每次回覆煮食建議時，必須嚴格按照以下格式回覆。每個食譜必須包含完整食材同烹飪步驟，缺一不可。請勿使用對話式文字代替結構化格式。

請每次都提供不同的食譜建議，考慮不同菜系（中菜、西餐、日式、韓式、東南亞等）、不同蛋白質（雞、豬、牛、魚、蝦、豆腐等）、不同季節食材，確保每次推薦都有新鮮感。

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

function parseRecipesFromText(text: string): SuggestedRecipe[] {
  const recipes: SuggestedRecipe[] = [];
  
  // Match recipe headers: 食譜一：類別 —— 名稱（約XX分鐘）
  // Also supports: 食譜1、食譜 1、1. 名稱（約XX分鐘）
  const recipeBlocks = text.split(/(?=食譜[一二三四五六七八九十\d]+[：:])/);
  
  for (const block of recipeBlocks) {
    // Try to parse header
    const headerMatch = block.match(
      /食譜[一二三四五六七八九十\d]+[：:]\s*(.+?)\s*(?:——|—|--|-)\s*(.+?)(?:[（(]約?\s*(\d+)\s*分鐘[）)])?(?:\n|$)/
    );
    if (!headerMatch) continue;
    
    const category = headerMatch[1].trim();
    const name = headerMatch[2].replace(/^[—\-]+\s*/, "").trim();
    const cookTime = headerMatch[3] ? parseInt(headerMatch[3], 10) : 30;
    
    if (!name || name.length < 2) continue;
    
    // Parse ingredients section
    const ingredients: SuggestedRecipe["ingredients"] = [];
    const ingSection = block.match(/🛒\s*食材[：:]([\s\S]*?)(?=🍳|---|$)/);
    if (ingSection) {
      const ingLines = ingSection[1].split("\n").filter(l => l.trim());
      for (const line of ingLines) {
        // Match: - 食材名：數量 單位 or - 食材名 數量 單位
        const ingMatch = line.match(/[-•]\s*(.+?)[：:]\s*(\d+\.?\d*)\s*(.+)/);
        if (ingMatch) {
          ingredients.push({
            name: ingMatch[1].trim(),
            quantity: ingMatch[2].trim(),
            unit: ingMatch[3].trim(),
          });
        } else {
          // Try simpler: - 食材名 數量單位
          const simpleMatch = line.match(/[-•]\s*(.+?)\s+(\d+\.?\d*)\s*(.+)/);
          if (simpleMatch) {
            ingredients.push({
              name: simpleMatch[1].trim(),
              quantity: simpleMatch[2].trim(),
              unit: simpleMatch[3].trim(),
            });
          }
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
    
    // Only add if we have ingredients and steps
    if (ingredients.length > 0 && steps.length > 0) {
      recipes.push({
        name,
        cookTime,
        servings: 4, // Default
        difficulty: "中等", // Default
        description,
        ingredients,
        steps,
        tags: [category],
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
    const llmResp = await invokeLLM({
      messages,
      maxTokens: 4096, temperature: 0.9,
      enableSearch: enableSearch ?? true,
      tools: i === 0 ? TOOLS as any : undefined,
    });

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

  return { finalContent: "", allMessages: messages };
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
  const resolvedMsgs = await resolveImageUrls(inputMessages);

  // Auto-search: always run searchRecipes first to get library context
  const searchQuery = extractSearchQuery(toLLMMessages(resolvedMsgs));
  let libSummary = "";
  let libResults: Record<string, unknown>[] = [];
  if (db) {
    try {
      const searchResult = await execSearchRecipes(db, { query: searchQuery, limit: 15 }, familyId);
      libResults = (searchResult.recipes || []) as Record<string, unknown>[];
      libSummary = formatLibraryContext(libResults);
    } catch (e) {
      console.warn("[AI Chef] Auto-search failed:", e);
      libSummary = "（食譜庫搜尋失敗）";
    }
  }

  const systemPrompt = buildSystemPrompt(mode, libSummary);
  const msgs: Message[] = [
    { role: "system", content: systemPrompt },
    ...toLLMMessages(resolvedMsgs),
  ];

  const enableSearch = mode !== "library";
  const { finalContent, allMessages } = await runToolsLoop(msgs, familyId, userId, enableSearch);

  // Direct parse from assistant response (no extra LLM call)
  const recipes = parseRecipesFromText(finalContent);

  // Match each parsed recipe against library results to determine source
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

  // #8: 首輪未認到庫嘅，按名再搜一次
  for (const r of recipes) {
    if (r.source === "ai") {
      await applyLibraryMatch(db, r, familyId);
    }
  }

  // Log for debugging
  if (recipes.length === 0 && finalContent.includes("食譜")) {
    console.warn("[AI Chef] Failed to parse recipes from response:", finalContent.slice(0, 500));
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
  const resolvedMsgs = await resolveImageUrls(inputMessages);

  // Auto-search
  const searchQuery = extractSearchQuery(toLLMMessages(resolvedMsgs));
  let libSummary = "";
  let libResults: Record<string, unknown>[] = [];
  if (db) {
    try {
      const searchResult = await execSearchRecipes(db, { query: searchQuery, limit: 15 }, familyId);
      libResults = (searchResult.recipes || []) as Record<string, unknown>[];
      libSummary = formatLibraryContext(libResults);
    } catch (e) {
      console.warn("[AI Chef] Auto-search failed:", e);
      libSummary = "（食譜庫搜尋失敗）";
    }
  }

  const systemPrompt = buildSystemPrompt(mode, libSummary);
  const sysMsg: Message = { role: "system", content: systemPrompt };
  const msgs: Message[] = [sysMsg, ...toLLMMessages(resolvedMsgs)];

  const enableSearch = mode !== "library";
  const { allMessages } = await runToolsLoop(msgs, familyId, userId, enableSearch);

  // Stream the text response directly (no re-generation)
  const lastAssistantMsg = allMessages.filter(m => m.role === "assistant").pop();
  const lastAssistantContent = typeof lastAssistantMsg?.content === "string" ? lastAssistantMsg.content : "";

  if (lastAssistantContent) {
    // Stream character by character for smooth UX
    for (let i = 0; i < lastAssistantContent.length; i += 50) {
      yield { type: "text", value: lastAssistantContent.slice(i, i + 50) };
    }
  }

  // Parse and tag sources for streaming path too
  const streamRecipes = parseRecipesFromText(lastAssistantContent);
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

  // #8: 首輪未認到庫嘅，按名再搜一次
  for (const r of streamRecipes) {
    if (r.source === "ai") {
      await applyLibraryMatch(db, r, familyId);
    }
  }

  yield { type: "recipes", value: streamRecipes };
  yield { type: "done" };
}

// ─── Router ──────────────────────────────────────────────

export const aiRecipeRouter = router({
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

      const systemPrompt = `你是一個專業食譜編輯助手。請根據原始食譜和修改要求，產生一個完整可儲存的新食譜。\n\n要求：\n1. 必須保留原食譜的核心風格，但要按修改要求調整\n2. 所有文字使用繁體中文\n3. 步驟要清晰、可操作\n4. 食材、份量、做法要合理一致\n5. 只回傳 JSON，不要加任何解釋文字`;

      const response = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `原始食譜：${JSON.stringify(input.recipe)}\n\n修改要求：${input.editPrompt}`,
          },
        ],
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

      const parsed = aiEditOutputSchema.parse(extractJSON(parsedContent));
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
        await incrementAiChatUsage(familyId, hasMedia ? 2 : 1);
      }

      return processAIChefChat(
        input.messages.map(m => ({ role: m.role, content: m.content })),
        familyId,
        userId,
        input.mode,
      );
    }),
});
