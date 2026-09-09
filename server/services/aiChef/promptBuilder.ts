export interface BuildSystemPromptOptions {
  mode: 'chat' | 'recipe' | 'library';
  soupIntent: boolean;
  libraryContext?: string;
}

export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
  const { mode, soupIntent, libraryContext } = options;

  let prompt = `你係一個親切、專業嘅 AI 烹飪助手，專注於香港家庭煮食。

語氣：親切、自然、用廣東話書面語。
目標：幫用戶搵食譜、規劃餐單、解答煮食問題。

`;

  // Add library context if available
  if (libraryContext) {
    prompt += `【用戶食譜庫參考】\n${libraryContext}\n\n`;
  }

  // Mode-specific instructions
  if (mode === 'chat') {
    prompt += `【智能對話模式】
- 用戶問煮食問題：直接回答，唔使輸出食譜 JSON
- 用戶想食譜：先輸出食譜 JSON，再傾偈
- 用戶打招呼（hi/hello/你好/多謝/唔該）：簡單問候，唔使輸出食譜
`;
  } else if (mode === 'recipe' || mode === 'library') {
    prompt += `【食譜推薦模式】
- 直接輸出完整食譜，包含：名稱、描述、煮食時間、難度、份量、食材、步驟
- 食材每行一種，唔好加功效或備註
- 步驟要有詳細動作、火力、時間
`;
  }

  // Soup intent rules
  if (soupIntent) {
    prompt += `

🍲 【3 餸 1 湯強制規則】
用戶請求「3 餸 1 湯」「三餸一湯」時，你**必須生成剛好 4 個食譜**：
1. 食譜一：肉類主菜（豬/牛/雞）
2. 食譜二：海鮮/其他蛋白（魚/蝦/豆腐/蛋）
3. 食譜三：蔬菜/小炒
4. 食譜四：湯水（必須包含湯類型、功效、水量）

每個食譜用「食譜一：…」「食譜二：…」獨立成段，用 --- 分隔。
唔可以只有 1-3 個食譜，必須係剛好 4 個！
`;
  }

  // General rules
  prompt += `

規則：
- 繁體中文，廣東話語氣
- 每個食譜 4-6 個步驟
- 推薦唔同菜系、唔同蛋白質、唔同季節食材
- 用戶發圖片：幫佢認食材或菜式
- 如果無合適食譜：返回空陣列，唔好硬編碼
`;

  return prompt;
}

export function buildShortPrompt(options: { count: number; soupIntent: boolean; source: 'library' | 'ai' }): string {
  const { count, soupIntent, source } = options;

  if (source === 'library') {
    return soupIntent
      ? `從食譜庫揀 ${count} 個家常菜，包含 1 個湯水。直接輸出 JSON。`
      : `從食譜庫揀 ${count} 個家常菜。直接輸出 JSON。`;
  }

  return soupIntent
    ? `推薦 ${count} 個香港家庭家常菜，必須包含 1 個湯水。直接輸出 JSON。`
    : `推薦 ${count} 個香港家庭家常菜。直接輸出 JSON。`;
}
