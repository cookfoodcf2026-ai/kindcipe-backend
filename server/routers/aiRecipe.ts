import { z } from "zod";
import { eq, and, or, like, desc } from "drizzle-orm";
import { publicProcedure, router } from "../_core/trpc";
import { invokeLLM, invokeLLMStream, Message, MessageContent, TextContent, ImageContent } from "../_core/llm";
import { getDb } from "../db";
import { officialRecipes, customRecipes, pantryItems, mealPlans, shoppingItems } from "../../drizzle/schema";

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
      name: "addMealPlanRecipe",
      description: "直接將食譜加入用戶嘅排餐計劃，並自動將食材加入購物清單。用戶明確要求加排餐時先好用呢個工具。",
      parameters: {
        type: "object",
        properties: {
          recipeName: { type: "string", description: "食譜名稱" },
          description: { type: "string", description: "簡短描述" },
          cookTime: { type: "number", description: "烹飪時間（分鐘）" },
          servings: { type: "number", description: "幾人份" },
          difficulty: { type: "string", description: "難度：簡單/中等/困難" },
          ingredients: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                quantity: { type: "string" },
                unit: { type: "string" },
              },
              required: ["name", "quantity", "unit"],
              additionalProperties: false,
            },
          },
          steps: {
            type: "array",
            items: { type: "string" },
            description: "烹飪步驟",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "標籤，例如「中式」「快煮」",
          },
          date: { type: "string", description: "日期 YYYY-MM-DD，預設今日" },
          mealType: { type: "string", description: "餐次：breakfast/lunch/dinner/snack，預設dinner" },
        },
        required: ["recipeName", "cookTime", "servings", "difficulty", "ingredients"],
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

async function execAddMealPlanRecipe(
  db: Db, args: {
    recipeName: string; description?: string; cookTime: number; servings: number;
    difficulty: string; ingredients: { name: string; quantity: string; unit: string }[];
    steps?: string[]; tags?: string[]; date?: string; mealType?: string;
  }, familyId: number, userId: number
) {
  const date = args.date ?? new Date().toISOString().split("T")[0];
  const mealType = args.mealType ?? "dinner";
  const recipeName = args.recipeName;

  // Step 1: Create custom recipe
  const [recipe] = await db.insert(customRecipes).values({
    familyId,
    createdByUserId: String(userId),
    name: recipeName,
    description: args.description ?? "",
    cookTime: args.cookTime,
    servings: args.servings,
    difficulty: args.difficulty,
    recipeCategory: "家常",
    ingredients: JSON.stringify(args.ingredients.map(ing => ({ ...ing, category: "食材" }))),
    steps: JSON.stringify(args.steps ?? []),
    tags: JSON.stringify(args.tags ?? []),
    sourceType: "manual",
    visibility: "private",
  }).returning({ id: customRecipes.id });
  if (!recipe) return { success: false, error: "建立食譜失敗" };

  // Step 2: Add to meal plan
  await db.insert(mealPlans).values({
    familyId, date, mealType: mealType as any,
    recipeId: `user_${recipe.id}`,
    recipeName,
    proposedByUserId: userId,
    status: "confirmed",
  });

  // Step 3: Add ingredients to shopping list
  if (args.ingredients.length > 0) {
    await db.insert(shoppingItems).values(
      args.ingredients.map(ing => ({
        familyId, name: ing.name, quantity: ing.quantity, unit: ing.unit,
        category: "食材", fromRecipeName: recipeName, plannedDate: date,
        proposedByUserId: userId,
      }))
    );
  }

  return { success: true, recipeId: recipe.id, recipeName, date, mealType };
}

async function executeToolCall(
  db: Db, name: string, args: Record<string, unknown>,
  familyId?: number, userId?: number
): Promise<unknown> {
  switch (name) {
    case "searchRecipes": return execSearchRecipes(db, args as any, familyId);
    case "getPantryItems": return execGetPantryItems(db, familyId);
    case "getWeather": return execGetWeather();
    case "addMealPlanRecipe":
      if (!familyId || !userId) return { error: "需要登入先可以加排餐" };
      return execAddMealPlanRecipe(db, args as any, familyId, userId);
    default: return { error: `Unknown tool: ${name}` };
  }
}

// ─── Prompts ─────────────────────────────────────────────

const SYSTEM_PROMPT = `你是「Kindcipe」的 AI 食譜助手，幫香港家庭決定今晚煮什麼。

職責：根據用戶需求推薦 1-3 道菜（主菜+蔬菜+湯），說明推薦原因。如果用戶要求，幫佢直接加入排餐。

你可以用以下工具：
- searchRecipes: 搜尋已有的食譜
- getPantryItems: 查看用戶雪櫃有咩食材
- getWeather: 查看香港天氣
- addMealPlanRecipe: 直接將食譜加入排餐計劃（用戶明確要求加入排餐時先用）

規則：
- 繁體中文，親切語氣，800字內
- 每個食譜必須包含完整食材清單同詳細烹飪步驟，缺一不可
- 每次推薦不同菜系（中菜、西餐、日式、韓式、東南亞等）、不同蛋白質（雞、豬、牛、魚、蝦、豆腐等）、不同季節食材，確保每次推薦都有新鮮感
- cookTime 為整數分鐘，difficulty 只能是「簡單」「中等」「困難」三選一
- recipeCategory 必須是「中菜」「西餐」「日式」「韓式」「東南亞」「甜品」「飲品」「其他」之一
- quantity 和 unit 要具體（例如 "500" "克"）
- 用戶發送圖片時，幫佢睇圖入面有咩食材或菜式`;

const EXTRACTION_PROMPT = `你係「Kindcipe」的 AI 食譜助手。根據對話歷史，以指定 JSON 格式整理出你的最終回覆和推薦食譜。每個食譜的 steps 陣列必須包含至少 3 步詳細烹飪步驟（具體說明煮法、時間、火候），嚴禁返回空 steps。如果對話中真係完全冇提到煮法，先可以留空 steps。如果冇推薦食譜，recipes 可以是空陣列。`;

const responseSchema: Record<string, unknown> = {
  type: "object", properties: {
    response: {
      type: "object", properties: {
        message: { type: "string" },
        recipes: {
          type: "array", items: {
            type: "object", properties: {
              name: { type: "string" }, cookTime: { type: "number" }, servings: { type: "number" },
              difficulty: { type: "string" }, description: { type: "string" },
              recipeCategory: { type: "string" },
              ingredients: { type: "array", items: {
                type: "object", properties: { name: { type: "string" }, quantity: { type: "string" }, unit: { type: "string" } },
                required: ["name", "quantity", "unit"], additionalProperties: false,
              }},
              steps: { type: "array", items: { type: "string" } },
              tags: { type: "array", items: { type: "string" } },
            },
            required: ["name", "cookTime", "servings", "difficulty", "description", "recipeCategory", "ingredients", "steps", "tags"],
            additionalProperties: false,
          },
        },
      },
      required: ["message", "recipes"], additionalProperties: false,
    },
  },
  required: ["response"], additionalProperties: false,
};

// ─── Fire-and-forget tools loop (returns final assistant content + all messages) ──

async function runToolsLoop(
  messages: Message[],
  familyId?: number,
  userId?: number
): Promise<{ finalContent: string; allMessages: Message[] }> {
  const db = await getDb();
  const MAX_ITER = 4;

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

// ─── Structured extraction ───────────────────────────────

async function extractRecipes(messages: Message[], fallbackContent: string) {
  const doExtract = async (extraMsg?: Message): Promise<{ content: string; recipes: SuggestedRecipe[] }> => {
    const extractionMsgs: Message[] = [
      { role: "system", content: EXTRACTION_PROMPT },
      ...messages.slice(1),
      { role: "user", content: "請根據以上所有對話內容，以 JSON 格式整理出你的最終回覆（message）和推薦食譜（recipes）。" },
    ];
    if (extraMsg) extractionMsgs.push(extraMsg);

    const resp = await invokeLLM({
      messages: extractionMsgs, maxTokens: 8192, temperature: 0.3,
      responseFormat: { type: "json_schema", json_schema: { name: "chef_response", strict: true, schema: responseSchema } },
    });

    const raw = resp.choices[0]?.message?.content || "{}";
    let cleaned = raw.trim();
    if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim();

    try {
      const parsed = JSON.parse(cleaned) as { response: { message: string; recipes: SuggestedRecipe[] } };
      return { content: parsed.response.message || fallbackContent, recipes: parsed.response.recipes ?? [] };
    } catch {
      // Retry once with higher temperature if JSON parse fails
      try {
        const retryResp = await invokeLLM({
          messages: [...extractionMsgs, { role: "user", content: "剛才 JSON 格式錯誤，請嚴格按照 JSON schema 重新整理，確保所有欄位齊全。" }],
          maxTokens: 8192, temperature: 0.5,
          responseFormat: { type: "json_schema", json_schema: { name: "chef_response", strict: true, schema: responseSchema } },
        });
        const retryRaw = retryResp.choices[0]?.message?.content || "{}";
        let retryCleaned = retryRaw.trim();
        if (retryCleaned.startsWith("```")) retryCleaned = retryCleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
        const retryParsed = JSON.parse(retryCleaned) as { response: { message: string; recipes: SuggestedRecipe[] } };
        return { content: retryParsed.response.message || fallbackContent, recipes: retryParsed.response.recipes ?? [] };
      } catch {
        return { content: fallbackContent, recipes: [] };
      }
    }
  };

  let result = await doExtract();

  // Check if any recipes have empty/missing steps — force fix
  const missingSteps = result.recipes.filter(r => !r.steps || r.steps.length === 0);
  if (missingSteps.length > 0) {
    const fixMsg: Message = {
      role: "user",
      content: `以下食譜缺少烹飪步驟，請為每個食譜補充至少 3 步詳細做法（只返回 JSON，保持其他欄位不變）：\n${missingSteps.map(r => `- ${r.name}`).join("\n")}`,
    };
    try {
      const fixed = await doExtract(fixMsg);
      // Merge steps from fixed back into original
      result.recipes = result.recipes.map(r => {
        const fixedR = fixed.recipes.find(fr => fr.name === r.name);
        if (fixedR?.steps?.length) return { ...r, steps: fixedR.steps };
        return r;
      });
    } catch {
      // Keep original result if step-fix fails
    }
  }

  return result;
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
  return extractRecipes(allMessages, finalContent);
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

  // Stream the text response
  const streamMsgs: Message[] = [
    sysMsg,
    ...allMessages.slice(1),
    { role: "user", content: "請根據以上所有資訊給出你的回覆，用繁體中文，200字內，唔好加任何 JSON 格式。" },
  ];

  let streamedText = "";
  try {
    for await (const token of invokeLLMStream({
      messages: streamMsgs, maxTokens: 4096, temperature: 0.7, enableSearch: false,
    })) {
      streamedText += token;
      yield { type: "text", value: token };
    }
  } catch (e) {
    console.log("[AIChef] Stream error:", e);
  }

  // Extract recipes
  const { recipes } = await extractRecipes(
    [...allMessages, { role: "assistant", content: streamedText }],
    allMessages.filter(m => m.role === "assistant").pop()?.content as string ?? streamedText
  );

  if (recipes.length > 0) yield { type: "recipes", value: recipes };
  yield { type: "done" };
}

// ─── Router ──────────────────────────────────────────────

export const aiRecipeRouter = router({
  chat: publicProcedure
    .input(z.object({
      messages: z.array(messageSchema).min(1),
      familyId: z.number().optional(),
      userId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      return processAIChefChat(
        input.messages.map(m => ({ role: m.role, content: m.content })),
        input.familyId,
        input.userId
      );
    }),
});
