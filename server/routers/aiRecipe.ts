import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";

// 精簡版食譜清單，供 AI 參考（避免 token 過多）
const RECIPE_CATALOG = [
  { id: "r1", name: "清蒸石斑魚", nameEn: "Steamed Grouper", tags: ["海鮮", "清淡", "廣東", "家常"], cookTime: 20, difficulty: "中等", estimatedCost: 180, servings: 4 },
  { id: "r2", name: "番茄炒蛋", nameEn: "Tomato & Egg Stir-fry", tags: ["家常", "快手", "素"], cookTime: 15, difficulty: "簡單", estimatedCost: 40, servings: 3 },
  { id: "r3", name: "豉汁蒸排骨", nameEn: "Steamed Ribs in Black Bean Sauce", tags: ["豬肉", "蒸", "廣東"], cookTime: 30, difficulty: "中等", estimatedCost: 95, servings: 3 },
  { id: "r4", name: "薑蔥炒蟹", nameEn: "Ginger & Spring Onion Crab", tags: ["海鮮", "節日", "廣東"], cookTime: 20, difficulty: "困難", estimatedCost: 220, servings: 3 },
  { id: "r5", name: "白切雞", nameEn: "Poached Chicken", tags: ["雞肉", "清淡", "廣東", "家常"], cookTime: 45, difficulty: "中等", estimatedCost: 120, servings: 4 },
  { id: "r6", name: "麻婆豆腐", nameEn: "Mapo Tofu", tags: ["豆腐", "四川", "辣", "素食可"], cookTime: 20, difficulty: "簡單", estimatedCost: 45, servings: 3 },
  { id: "r7", name: "蒜蓉炒西蘭花", nameEn: "Garlic Broccoli", tags: ["蔬菜", "清淡", "快手", "素"], cookTime: 10, difficulty: "簡單", estimatedCost: 30, servings: 3 },
  { id: "r8", name: "紅燒肉", nameEn: "Red-Braised Pork Belly", tags: ["豬肉", "紅燒", "上海", "節日"], cookTime: 90, difficulty: "困難", estimatedCost: 85, servings: 4 },
  { id: "r9", name: "冬瓜排骨湯", nameEn: "Winter Melon & Pork Rib Soup", tags: ["湯", "清淡", "廣東", "家常"], cookTime: 60, difficulty: "簡單", estimatedCost: 70, servings: 4 },
  { id: "r10", name: "乾炒牛河", nameEn: "Dry-Fried Beef Ho Fun", tags: ["牛肉", "廣東", "炒麵"], cookTime: 15, difficulty: "困難", estimatedCost: 80, servings: 2 },
  { id: "r11", name: "揚州炒飯", nameEn: "Yangzhou Fried Rice", tags: ["炒飯", "家常", "快手"], cookTime: 15, difficulty: "簡單", estimatedCost: 50, servings: 3 },
  { id: "r12", name: "蒸水蛋", nameEn: "Steamed Egg Custard", tags: ["雞蛋", "清淡", "廣東", "家常"], cookTime: 15, difficulty: "簡單", estimatedCost: 20, servings: 3 },
];

const SYSTEM_PROMPT = `你是「和譜食譜 Kindcipe」的 AI 食譜助手，專門幫香港家庭決定今天煮什麼。

你的職責：
1. 根據用戶的需求（食材、口味、時間、人數、預算）推薦合適的食譜
2. 每次推薦 1-3 道菜，組合成一頓完整的家庭晚餐（主菜 + 蔬菜 + 湯）
3. 說明為什麼這個組合適合用戶的需求
4. 在回覆末尾，用 JSON 格式列出推薦的食譜 ID，格式如下：
   <!--RECIPES:["r1","r2"]-->

可用食譜清單（JSON）：
${JSON.stringify(RECIPE_CATALOG, null, 2)}

回覆規則：
- 用繁體中文回覆
- 語氣親切、像家人一樣
- 回覆要簡潔，不要超過 200 字
- 必須在回覆末尾加上 <!--RECIPES:[...]-->，即使只推薦一道菜
- 如果用戶問的不是食譜相關問題，溫和地引導回食譜話題`;

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

export const aiRecipeRouter = router({
  chat: publicProcedure
    .input(
      z.object({
        messages: z.array(messageSchema).min(1).max(20),
      })
    )
    .mutation(async ({ input }) => {
      const llmMessages = [
        { role: "system" as const, content: SYSTEM_PROMPT },
        ...input.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ];

      const response = await invokeLLM({ messages: llmMessages });
      const rawContent = response.choices?.[0]?.message?.content;
      const content: string = typeof rawContent === "string"
        ? rawContent
        : (Array.isArray(rawContent as unknown[])
          ? (rawContent as Array<{ type: string; text?: string }>).map((c) => (c.type === "text" ? c.text ?? "" : "")).join("")
          : "抱歉，我暫時無法回應，請稍後再試。");

      // Extract recommended recipe IDs from the response
      const match = content.match(/<!--RECIPES:(\[.*?\])-->/);
      let recommendedIds: string[] = [];
      if (match) {
        try {
          recommendedIds = JSON.parse(match[1]);
        } catch {
          recommendedIds = [];
        }
      }

      // Clean the display text (remove the hidden JSON tag)
      const displayContent = content.replace(/<!--RECIPES:\[.*?\]-->/, "").trim();

      return {
        content: displayContent,
        recommendedIds,
      };
    }),
});
