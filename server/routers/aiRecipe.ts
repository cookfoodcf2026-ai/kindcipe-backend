import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";

const SYSTEM_PROMPT = `你是「Kindcipe」的 AI 食譜助手，幫香港家庭決定今晚煮什麼。

職責：根據用戶需求推薦 1-3 道菜（主菜+蔬菜+湯），說明推薦原因。

規則：
- 繁體中文，親切語氣，200字內
- 必須在回覆最末尾加上食譜 JSON，不能省略
- JSON 格式嚴格如下，缺一不可

<!--RECIPES:[{"name":"菜名","cookTime":分鐘,"servings":人數,"difficulty":"簡單/中等/困難","description":"一句話","ingredients":[{"name":"食材","quantity":"數量","unit":"單位"}]}]-->

注意：cookTime 為整數分鐘，difficulty 只能是「簡單」「中等」「困難」三選一，quantity 和 unit 要具體（例如 "500" "克"）。JSON 必須放在回覆最後一行。`;

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

export type SuggestedRecipe = {
  name: string;
  cookTime: number;
  servings: number;
  difficulty: string;
  description: string;
  ingredients: { name: string; quantity: string; unit: string }[];
};

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

      const response = await invokeLLM({ messages: llmMessages, maxTokens: 4096, temperature: 0.7 });
      const rawContent = response.choices?.[0]?.message?.content;
      const content: string = typeof rawContent === "string"
        ? rawContent
        : (Array.isArray(rawContent as unknown[])
          ? (rawContent as Array<{ type: string; text?: string }>).map((c) => (c.type === "text" ? c.text ?? "" : "")).join("")
          : "抱歉，我暫時無法回應，請稍後再試。");

      const match = content.match(/<!--RECIPES:(\[[\s\S]*?\])-->/);
      let recipes: SuggestedRecipe[] = [];
      if (match) {
        try {
          recipes = JSON.parse(match[1]);
        } catch {
          recipes = [];
        }
      }

      const displayContent = content
        .replace(/<!--RECIPES:\[[\s\S]*?\]-->/g, "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .trim();

      return {
        content: displayContent,
        recipes,
      };
    }),
});
