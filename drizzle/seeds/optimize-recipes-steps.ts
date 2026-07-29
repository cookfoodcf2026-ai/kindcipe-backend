import postgres from 'postgres';
import 'dotenv/config';

// 優化所有 20 個食譜
async function optimizeRecipes() {
  const db = postgres(process.env.DATABASE_URL!, { ssl: { rejectUnauthorized: false } });
  
  try {
    // 獲取所有官方食譜
    const recipes = await db`SELECT * FROM official_recipes ORDER BY id`;
    console.log(`📖 Found ${recipes.length} recipes\n`);

    // 逐個優化
    for (const recipe of recipes) {
      console.log(`\n🔍 Analyzing: ${recipe.name}`);
      
      const optimized = await optimizeRecipe(recipe);
      
      if (optimized) {
        await db`
          UPDATE official_recipes 
          SET 
            steps = ${optimized.steps},
            cook_time = ${optimized.cookTime},
            servings = ${optimized.servings},
            difficulty = ${optimized.difficulty},
            updated_at = NOW()
          WHERE id = ${recipe.id}
        `;
        console.log(`✅ Updated: ${recipe.name}`);
      } else {
        console.log(`⏭️  Skipped: ${recipe.name}`);
      }
    }

    console.log('\n✨ Optimization complete!');
  } catch (err) {
    console.error('❌ Error:', (err as any).message);
  } finally {
    await db.end();
  }
}

// 優化單個食譜
async function optimizeRecipe(recipe: any) {
  const name = recipe.name;
  let steps = JSON.parse(recipe.steps);
  let cookTime = recipe.cook_time;
  let servings = recipe.servings;
  let difficulty = recipe.difficulty;
  let hasChanges = false;

  // 1. 調整份量到 3-4 人
  if (servings && servings < 3) {
    servings = 4;
    hasChanges = true;
    console.log(`   📊 Servings: ${recipe.servings} → ${servings}`);
  }

  // 2. 步驟細化 - 根據食譜類型
  const category = recipe.recipe_category;
  
  if (category === '中菜' || category === '家常菜') {
    const optimizedSteps = optimizeChineseRecipe(name, steps, cookTime);
    if (optimizedSteps) {
      steps = optimizedSteps;
      hasChanges = true;
    }
  }

  // 3. 調整烹調時間（如果步驟增加）
  if (steps.length > recipe.steps.length) {
    cookTime = Math.max(cookTime, calculateTotalTime(steps));
    hasChanges = true;
    console.log(`   ⏱️  Cook time: ${recipe.cook_time} → ${cookTime} min`);
  }

  // 4. 難度調整（如果步驟複雜）
  if (steps.length >= 10 && difficulty === '簡單') {
    difficulty = '中等';
    hasChanges = true;
    console.log(`   📈 Difficulty: ${recipe.difficulty} → ${difficulty}`);
  }

  if (hasChanges) {
    return { steps: JSON.stringify(steps), cookTime, servings, difficulty };
  }
  
  return null;
}

// 優化中菜食譜步驟
function optimizeChineseRecipe(name: string, steps: any[], cookTime: number) {
  // 根據食譜名稱匹配優化模板
  const optimizations: Record<string, (steps: any[]) => any[]> = {
    '榨菜肉絲湯米粉': optimizeNoodleSoup,
    '蠔油冬菇炆雞': optimizeBraisedChicken,
    '鹽焗雞翼': optimizeBakedWings,
    '腐乳通菜': optimizeStirFryVegetables,
    '魚香茄子': optimizeFishFragrantEggplant,
    '薑蔥蒸雞': optimizeSteamedChicken,
    '梅菜扣肉': optimizeBraisedPork,
    '蝦仁炒蛋': optimizeShrimpEggs,
    '干煸四季豆': optimizeDryFriedBeans,
    '回鍋肉': optimizeTwiceCookedPork,
  };

  const optimizer = Object.keys(optimizations).find(key => name.includes(key));
  if (optimizer && optimizations[optimizer]) {
    return optimizations[optimizer](steps);
  }

  // 通用優化
  return optimizeGenericSteps(steps);
}

// 通用步驟優化
function optimizeGenericSteps(steps: any[]) {
  const optimized = [...steps];
  
  // 檢查是否有準備步驟
  const hasPrep = steps.some(s => 
    s.instruction?.includes('洗') || 
    s.instruction?.includes('切') ||
    s.instruction?.includes('醃')
  );

  if (!hasPrep && steps.length < 8) {
    // 加準備步驟
    optimized.unshift({
      instruction: '準備好所有食材，洗淨切好備用。',
      duration: 5
    });
  }

  // 檢查是否有預熱步驟
  const hasPreheat = steps.some(s => 
    s.instruction?.includes('燒熱') || 
    s.instruction?.includes('預熱')
  );

  // 檢查是否有試味步驟
  const hasTasting = steps.some(s => s.instruction?.includes('試味'));
  if (!hasTasting && steps.length >= 5) {
    // 加試味步驟
    optimized.push({
      instruction: '試味，按需調整鹹淡。',
      duration: 1
    });
  }

  // 檢查是否有上碟步驟
  const hasPlating = steps.some(s => 
    s.instruction?.includes('上碟') || 
    s.instruction?.includes('盛起')
  );
  if (!hasPlating) {
    optimized.push({
      instruction: '盛起上碟，即可享用。',
      duration: 1
    });
  }

  return optimized.length > steps.length ? optimized : null;
}

// 計算總時間
function calculateTotalTime(steps: any[]) {
  return steps.reduce((total, s) => total + (s.duration || 0), 0);
}

// 個別食譜優化函數（示例）
function optimizeNoodleSoup(steps: any[]) {
  const optimized = [
    { instruction: '米粉用冷水浸 10 分鐘至軟，撈起瀝乾。', duration: 10 },
    { instruction: '豬肉洗淨切絲，用 1 茶匙生抽、1 茶匙生粉醃 10 分鐘。', duration: 10 },
    { instruction: '榨菜洗淨切絲，薑切絲，蔥切蔥花。', duration: 3 },
    { instruction: '鍋中加 800ml 水煮滾，放入薑片。', duration: 5 },
    { instruction: '加入豬肉絲煮至變色（約 2 分鐘），撇走浮沫。', duration: 3 },
    { instruction: '加入榨菜絲煮 2 分鐘。', duration: 2 },
    { instruction: '放入米粉煮 3 分鐘至完全軟身。', duration: 3 },
    { instruction: '加鹽和少許白胡椒粉調味。', duration: 1 },
    { instruction: '盛起，灑蔥花，淋幾滴麻油即可。', duration: 1 }
  ];
  return optimized;
}

function optimizeBraisedChicken(steps: any[]) {
  const optimized = [
    { instruction: '冬菇用暖水浸 20 分鐘至軟，去蒂，浸菇水留用。', duration: 20 },
    { instruction: '雞腿洗淨切塊，用 1 湯匙生抽、1 茶匙生粉、1 茶匙油醃 15 分鐘。', duration: 15 },
    { instruction: '薑切片，蒜頭拍扁。', duration: 2 },
    { instruction: '中火燒熱鑊，落 2 湯匙油，爆香薑蒜。', duration: 2 },
    { instruction: '加入雞塊煎至兩面金黃（每面約 2 分鐘）。', duration: 5 },
    { instruction: '加入冬菇翻炒 1 分鐘。', duration: 1 },
    { instruction: '加入 2 湯匙蠔油、1 茶匙糖、浸菇水（約 1 碗），蓋冚。', duration: 2 },
    { instruction: '細火炆 15 分鐘至雞塊軟腍。', duration: 15 },
    { instruction: '開蓋，倒入 1 茶匙生粉開 2 湯匙水勾芡，大火收汁。', duration: 2 },
    { instruction: '盛起上碟，即可享用。', duration: 1 }
  ];
  return optimized;
}

function optimizeBakedWings(steps: any[]) {
  const optimized = [
    { instruction: '雞翼洗淨，用廚房紙徹底抹乾（重要！）。', duration: 5 },
    { instruction: '鹽焗雞粉 3 湯匙加 2 湯匙水調成糊狀。', duration: 2 },
    { instruction: '將鹽焗雞粉糊塗勻雞翼，按摩入味。', duration: 3 },
    { instruction: '加 3 片薑、2 條蔥、1 湯匙料酒，醃至少 30 分鐘（或雪櫃過夜）。', duration: 30 },
    { instruction: '焗爐預熱 200°C（上下火），焗盤鋪錫紙。', duration: 10 },
    { instruction: '雞翼放焗盤，皮向上，放入焗爐中層。', duration: 2 },
    { instruction: '200°C 焗 20 分鐘至表面金黃。', duration: 20 },
    { instruction: '翻面，再焗 5 分鐘至兩面金黃酥脆。', duration: 5 },
    { instruction: '取出，放 5 分鐘至稍涼，即可享用。', duration: 5 }
  ];
  return optimized;
}

function optimizeStirFryVegetables(steps: any[]) {
  const optimized = [
    { instruction: '通菜洗淨，切 5cm 段，瀝乾水分（重要！）。', duration: 5 },
    { instruction: '蒜頭 3 粒拍扁，去皮切碎。', duration: 2 },
    { instruction: '腐乳 2 塊壓爛，加 1 茶匙糖、2 湯匙水調勻成腐乳汁。', duration: 2 },
    { instruction: '大火燒熱鑊至冒煙，落 2 湯匙油，轉勻鑊。', duration: 1 },
    { instruction: '爆香蒜頭至金黃（約 30 秒）。', duration: 1 },
    { instruction: '加入通菜，大火快速翻炒 2 分鐘至軟身。', duration: 2 },
    { instruction: '倒入腐乳汁，快速翻炒均勻（約 1 分鐘）。', duration: 1 },
    { instruction: '試味，按需加鹽，盛起上碟。', duration: 1 }
  ];
  return optimized;
}

function optimizeFishFragrantEggplant(steps: any[]) {
  const optimized = [
    { instruction: '茄子洗淨切長條，用 1 茶匙鹽醃 10 分鐘出水。', duration: 10 },
    { instruction: '沖洗茄子，用手揸乾水分（重要！）。', duration: 2 },
    { instruction: '調魚香汁：2 湯匙醋、2 湯匙糖、1 湯匙生抽、1 茶匙生粉、3 湯匙水，拌勻。', duration: 2 },
    { instruction: '薑切末，蒜切末，蔥切蔥花。', duration: 2 },
    { instruction: '大火燒熱鑊，落 4 湯匙油，放入茄子煎至軟身，盛起瀝油。', duration: 5 },
    { instruction: '留 1 湯匙底油，爆香蒜蓉薑末。', duration: 1 },
    { instruction: '加入免治豬肉 100g 炒至變色。', duration: 3 },
    { instruction: '加入 1 湯匙豆瓣醬，炒出紅油（約 1 分鐘）。', duration: 1 },
    { instruction: '倒回茄子，淋入魚香汁，快速翻炒均勻。', duration: 2 },
    { instruction: '大火收汁，灑蔥花，盛起上碟。', duration: 1 }
  ];
  return optimized;
}

function optimizeSteamedChicken(steps: any[]) {
  const optimized = [
    { instruction: '雞腿洗淨，抹乾，用 1 湯匙生抽、1 茶匙麻油、1 湯匙料酒、1 湯匙生粉醃 20 分鐘。', duration: 20 },
    { instruction: '薑一半切絲，一半切片；蔥 2 條切段，1 條切蔥絲。', duration: 3 },
    { instruction: '深碟底部鋪薑片和蔥段。', duration: 1 },
    { instruction: '放上醃好嘅雞腿，皮向上。', duration: 1 },
    { instruction: '蒸籠水滾後，放入雞腿，大火蒸 15 分鐘。', duration: 15 },
    { instruction: '用筷子插最厚位，無血水滲出即熟。', duration: 1 },
    { instruction: '取出，薑絲蔥絲。', duration: 1 },
    { instruction: '燒熱 2 湯匙油至冒煙，淋在蔥絲上，吱聲即成。', duration: 2 }
  ];
  return optimized;
}

function optimizeBraisedPork(steps: any[]) {
  const optimized = [
    { instruction: '五花肉 500g 整塊冷水下鑊，加薑片、1 湯匙料酒，煮 20 分鐘至熟。', duration: 20 },
    { instruction: '撈起，用廚房紙徹底抹乾（重要！防油濺）。', duration: 3 },
    { instruction: '五花肉皮用 1 湯匙老抽塗勻，晾 5 分鐘。', duration: 5 },
    { instruction: '中落多啲油（約 3 碗），燒至 180°C，放入五花肉炸至金黃（蓋鑊蓋！）。', duration: 5 },
    { instruction: '撈起放涼，切 0.5cm 厚片。', duration: 5 },
    { instruction: '梅菜 100g 浸軟洗淨，切碎，用薑蒜爆香，加 1 湯匙生抽、1 茶匙糖調味。', duration: 10 },
    { instruction: '碗底鋪五花肉片，皮向下，上面鋪梅菜，壓實。', duration: 5 },
    { instruction: '放入蒸籠，大火蒸 1.5 小時至軟爛。', duration: 90 },
    { instruction: '取出，倒扣落碟，即可享用。', duration: 2 }
  ];
  return optimized;
}

function optimizeShrimpEggs(steps: any[]) {
  const optimized = [
    { instruction: '蝦仁 150g 洗淨，用 ¼ 茶匙鹽、1 茶匙生粉、1 茶匙料酒醃 10 分鐘。', duration: 10 },
    { instruction: '雞蛋 4 隻打散，加 ¼ 茶匙鹽、1 湯匙水拌勻（加水令蛋更滑）。', duration: 2 },
    { instruction: '蔥切蔥花。', duration: 1 },
    { instruction: '中火燒熱鑊，落 2 湯匙油，放入蝦仁炒至變色，盛起。', duration: 3 },
    { instruction: '同一加 1 湯匙油，倒入蛋液，用筷子快速撥散。', duration: 2 },
    { instruction: '蛋液半熟時（仍少少流心）加入蝦仁，翻炒均勻。', duration: 2 },
    { instruction: '蔥花，盛起上碟。', duration: 1 }
  ];
  return optimized;
}

function optimizeDryFriedBeans(steps: any[]) {
  const optimized = [
    { instruction: '四季豆 300g 撕去老筋，切 5cm 段，洗淨瀝乾。', duration: 5 },
    { instruction: '蒜頭 3 粒切末，薑切末，乾辣椒 2 隻切段。', duration: 2 },
    { instruction: '大火燒熱鑊，落 4 湯匙油，放入四季豆炸至表面起皺（約 3 分鐘），撈起瀝油。', duration: 5 },
    { instruction: '留 1 湯匙底油，爆香蒜末薑末乾辣椒。', duration: 1 },
    { instruction: '加入免治豬肉 100g 炒至變色。', duration: 3 },
    { instruction: '加入芽菜 50g 炒香。', duration: 2 },
    { instruction: '倒回四季豆，加 1 湯匙生抽，快速翻炒均勻。', duration: 2 },
    { instruction: '️ 注意：四季豆必須煮至完全軟身，否則會食物中毒！', duration: 1 },
    { instruction: '盛起上碟，即可享用。', duration: 1 }
  ];
  return optimized;
}

function optimizeTwiceCookedPork(steps: any[]) {
  const optimized = [
    { instruction: '五花肉 400g 整塊冷水下鑊，加薑片、1 湯匙料酒，煮 20 分鐘至熟。', duration: 20 },
    { instruction: '撈起放涼，切 0.3cm 薄片。', duration: 5 },
    { instruction: '蒜苗 200g 切段，蒜頭 3 粒切片，薑切片。', duration: 3 },
    { instruction: '中火燒熱鑊，落 1 湯匙油，放入五花肉片煎至兩面金黃微焦。', duration: 5 },
    { instruction: '加入 1 湯匙豆瓣醬、1 茶匙甜麵醬，炒出紅油。', duration: 2 },
    { instruction: '加入蒜苗白色部分，快速翻炒至斷生。', duration: 2 },
    { instruction: '加入蒜苗綠色部分，加 1 茶匙生抽，翻炒均勻。', duration: 1 },
    { instruction: '盛起上碟，即可享用。', duration: 1 }
  ];
  return optimized;
}

// 運行優化
optimizeRecipes().catch(console.error);
