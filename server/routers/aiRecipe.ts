import { z } from "zod";
import { eq, and, or, like, desc } from "drizzle-orm";
import { publicProcedure, router } from "../_core/trpc";
import { invokeLLM, extractJSON, Message, MessageContent, TextContent, ImageContent } from "../_core/llm";
import { getDb } from "../db";
import { officialRecipes, customRecipes, pantryItems } from "../../drizzle/schema";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

const contentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("image_url"), image_url: z.object({ url: z.string() }) }),
]);

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.union([z.string(), z.array(contentBlockSchema)]),
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
  const limit = args.limit ?? 5;
  const results: Record<string, unknown>[] = [];

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
      or(like(officialRecipes.name, `%${args.query}%`), like(officialRecipes.description ?? "", `%${args.query}%`), like(officialRecipes.tags ?? "", `%${args.query}%`)),
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
        or(like(customRecipes.name, `%${args.query}%`), like(customRecipes.description ?? "", `%${args.query}%`), like(customRecipes.tags ?? "", `%${args.query}%`)),
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
3. 加入排餐
4. 換一批建議`;

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
  userId?: number
): Promise<{ finalContent: string; allMessages: Message[] }> {
  const db = await getDb();
  const MAX_ITER = 3;

  for (let i = 0; i < MAX_ITER; i++) {
    const llmResp = await invokeLLM({
      messages,
      maxTokens: 4096, temperature: 0.9,
      enableSearch: true,
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

// ─── Exported: non-streamed chat ─────────────────────────

export async function processAIChefChat(
  inputMessages: Array<{ role: string; content: string | Array<TextContent | ImageContent> }>,
  familyId?: number,
  userId?: number
): Promise<{ content: string; recipes: SuggestedRecipe[] }> {
  const msgs: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...toLLMMessages(inputMessages),
  ];

  const { finalContent, allMessages } = await runToolsLoop(msgs, familyId, userId);

  // Direct parse from assistant response (no extra LLM call)
  const recipes = parseRecipesFromText(finalContent);
  
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
  userId?: number
): AsyncGenerator<
  { type: "text"; value: string } | { type: "recipes"; value: SuggestedRecipe[] } | { type: "done" }
> {
  const sysMsg: Message = { role: "system", content: SYSTEM_PROMPT };
  const msgs: Message[] = [sysMsg, ...toLLMMessages(inputMessages)];

  const { allMessages } = await runToolsLoop(msgs, familyId, userId);

  // Stream the text response directly (no re-generation)
  const lastAssistantMsg = allMessages.filter(m => m.role === "assistant").pop();
  const lastAssistantContent = typeof lastAssistantMsg?.content === "string" ? lastAssistantMsg.content : "";

  if (lastAssistantContent) {
    // Stream character by character for smooth UX
    for (let i = 0; i < lastAssistantContent.length; i += 50) {
      yield { type: "text", value: lastAssistantContent.slice(i, i + 50) };
    }
  }

  // Return empty recipes - frontend will parse from content
  yield { type: "recipes", value: [] };
  yield { type: "done" };
}

// ─── Router ──────────────────────────────────────────────

export const aiRecipeRouter = router({
  chat: publicProcedure
    .input(z.object({
      messages: z.array(messageSchema).min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      // Use context for family/user identity (frontend doesn't pass these)
      const familyId = ctx.activeFamilyId ?? undefined;
      const userId = ctx.user?.id ? Number(ctx.user.id) : undefined;

      return processAIChefChat(
        input.messages.map(m => ({ role: m.role, content: m.content })),
        familyId,
        userId
      );
    }),
});
