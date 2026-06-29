import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!);

// Recipe categories aligned with frontend CATEGORY_ORDER
const DISTRIBUTION = [
  { category: "中菜", subType: "小炒", count: 120, tags: ["小炒", "家常", "快手"] },
  { category: "中菜", subType: "湯水", count: 80, tags: ["湯水", "滋補", "廣東"] },
  { category: "中菜", subType: "早餐", count: 35, tags: ["早餐", "快手", "簡單"] },
  { category: "西餐", subType: "早餐", count: 35, tags: ["早餐", "西式", "快手"] },
  { category: "西餐", subType: "主菜", count: 60, tags: ["西式", "主菜"] },
  { category: "日式", subType: "主菜", count: 50, tags: ["日式", "和風"] },
  { category: "韓式", subType: "主菜", count: 30, tags: ["韓式", "辣"] },
  { category: "東南亞", subType: "主菜", count: 20, tags: ["東南亞", "酸辣"] },
  { category: "甜品", subType: "小食", count: 40, tags: ["甜品", "小食"] },
  { category: "其他", subType: "素食", count: 15, tags: ["素食", "健康", "清淡"] },
  { category: "其他", subType: "健康", count: 15, tags: ["健康", "低卡", "高蛋白"] },
];

// Base recipes for each category/subtype
const BASE_RECIPES = {
  "中菜 - 小炒": [
    {
      name: "蒜蓉炒時蔬",
      description: "簡單快手的家常炒青菜，蒜香四溢，清脆爽口，配飯一流。",
      cookTime: 15,
      servings: 4,
      difficulty: "簡單",
      ingredients: [
        { name: "時蔬（如菜心/生菜/芥蘭）", quantity: "400", unit: "克", category: "蔬菜" },
        { name: "蒜頭", quantity: "4", unit: "瓣", category: "調味料" },
        { name: "生抽", quantity: "1", unit: "湯匙", category: "調味料" },
        { name: "蠔油", quantity: "1", unit: "湯匙", category: "調味料" },
        { name: "糖", quantity: "1/2", unit: "茶匙", category: "調味料" },
        { name: "食油", quantity: "2", unit: "湯匙", category: "調味料" },
      ],
      steps: [
        { instruction: "時蔬洗淨，瀝乾水份，較粗的菜梗可先切小段。", duration: 0 },
        { instruction: "蒜頭去皮，拍扁後切成蒜蓉。", duration: 0 },
        { instruction: "中火燒熱鑊，加入食油，爆香蒜蓉至微金黃。", duration: 2 },
        { instruction: "轉大火，加入時蔬快速翻炒約 2-3 分鐘。", duration: 3 },
        { instruction: "加入生抽、蠔油和糖調味，繼續翻炒均勻。", duration: 1 },
        { instruction: "蔬菜變軟但仍保持翠綠即可上碟。", duration: 0 },
      ],
      tags: ["快手", "清淡健康", "素食", "家常菜", "30 分鐘內"],
    },
    {
      name: "宮保雞丁",
      description: "經典川菜，雞肉嫩滑，花生香脆，酸辣帶甜，非常開胃。",
      cookTime: 30,
      servings: 4,
      difficulty: "中等",
      ingredients: [
        { name: "雞胸肉", quantity: "300", unit: "克", category: "肉類" },
        { name: "乾辣椒", quantity: "6", unit: "條", category: "調味料" },
        { name: "花椒", quantity: "1", unit: "茶匙", category: "調味料" },
        { name: "花生", quantity: "50", unit: "克", category: "乾貨" },
        { name: "蒜頭", quantity: "3", unit: "瓣", category: "調味料" },
        { name: "薑", quantity: "1", unit: "片", category: "調味料" },
        { name: "蔥", quantity: "2", unit: "條", category: "調味料" },
        { name: "生抽", quantity: "2", unit: "湯匙", category: "調味料" },
        { name: "老抽", quantity: "1/2", unit: "湯匙", category: "調味料" },
        { name: "米醋", quantity: "1", unit: "湯匙", category: "調味料" },
        { name: "糖", quantity: "1", unit: "湯匙", category: "調味料" },
        { name: "料酒", quantity: "1", unit: "湯匙", category: "調味料" },
        { name: "生粉", quantity: "1", unit: "茶匙", category: "調味料" },
        { name: "食油", quantity: "3", unit: "湯匙", category: "調味料" },
      ],
      steps: [
        { instruction: "雞胸肉切成約 1.5 厘米小丁，加入生抽、料酒、生粉醃 15 分鐘。", duration: 0 },
        { instruction: "蒜頭、薑切末，蔥切段，乾辣椒剪小段去籽。", duration: 0 },
        { instruction: "調汁：生抽、老抽、米醋、糖、少許水混合備用。", duration: 0 },
        { instruction: "中火燒熱鑊，加入食油，炒香花生後盛起備用。", duration: 3 },
        { instruction: "同一鑊加入雞丁，大火炒至變色，約 3-4 分鐘，盛起。", duration: 4 },
        { instruction: "加入乾辣椒和花椒爆香，再放蒜蓉薑末炒香。", duration: 2 },
        { instruction: "倒入雞丁和調汁，快速翻炒均勻。", duration: 2 },
        { instruction: "加入花生和蔥段，炒勻後即可上碟。", duration: 0 },
      ],
      tags: ["中式", "微辣", "宴客", "家常菜", "30 分鐘內"],
    },
  ],
  "中菜 - 湯水": [
    {
      name: "紅蘿蔔豬骨湯",
      description: "廣東經典老火湯，清甜滋補，適合全家饮用。",
      cookTime: 120,
      servings: 6,
      difficulty: "簡單",
      ingredients: [
        { name: "紅蘿蔔", quantity: "2", unit: "條", category: "蔬菜" },
        { name: "豬骨", quantity: "500", unit: "克", category: "肉類" },
        { name: "蜜棗", quantity: "4", unit: "粒", category: "乾貨" },
        { name: "南北杏", quantity: "1", unit: "湯匙", category: "乾貨" },
        { name: "薑", quantity: "2", unit: "片", category: "調味料" },
        { name: "鹽", quantity: "適量", unit: "", category: "調味料" },
      ],
      steps: [
        { instruction: "豬骨洗淨，飛水去血沫，撈起備用。", duration: 5 },
        { instruction: "紅蘿蔔去皮切大塊，蜜棗洗淨。", duration: 0 },
        { instruction: "煲中加入 2 公升水，放入所有材料，大火煲滾。", duration: 10 },
        { instruction: "轉細火煲 1.5-2 小時。", duration: 90 },
        { instruction: "加鹽調味即可。", duration: 0 },
      ],
      tags: ["湯水", "老火湯", "廣東", "滋補", "家常"],
    },
  ],
  "中菜 - 早餐": [
    {
      name: "蕃茄蛋三文治",
      description: "5 分鐘快手早餐，營養均衡，小朋友最鍾意。",
      cookTime: 5,
      servings: 2,
      difficulty: "簡單",
      ingredients: [
        { name: "方包", quantity: "4", unit: "片", category: "主食" },
        { name: "蕃茄", quantity: "1", unit: "個", category: "蔬菜" },
        { name: "雞蛋", quantity: "2", unit: "隻", category: "蛋奶" },
        { name: "沙律醬", quantity: "2", unit: "湯匙", category: "調味料" },
        { name: "牛油", quantity: "1", unit: "湯匙", category: "調味料" },
      ],
      steps: [
        { instruction: "蕃茄切片，雞蛋煎熟。", duration: 3 },
        { instruction: "方包塗牛油，煎至金黃。", duration: 2 },
        { instruction: "夾入蕃茄、雞蛋，塗沙律醬即可。", duration: 0 },
      ],
      tags: ["早餐", "快手", "小朋友啱食", "5 分鐘"],
    },
  ],
  "西餐 - 早餐": [
    {
      name: "卡邦尼意粉",
      description: "經典義大利早餐，蛋奶醬濃郁，煙肉香脆。",
      cookTime: 20,
      servings: 2,
      difficulty: "中等",
      ingredients: [
        { name: "意粉", quantity: "200", unit: "克", category: "主食" },
        { name: "煙肉", quantity: "100", unit: "克", category: "肉類" },
        { name: "雞蛋", quantity: "2", unit: "隻", category: "蛋奶" },
        { name: "芝士粉", quantity: "2", unit: "湯匙", category: "調味料" },
        { name: "黑胡椒", quantity: "適量", unit: "", category: "調味料" },
      ],
      steps: [
        { instruction: "意粉按包裝煮至八成熟，留 50ml 煮麵水。", duration: 8 },
        { instruction: "煙肉切小片，煎至香脆。", duration: 3 },
        { instruction: "雞蛋打散，加入芝士粉和黑胡椒拌勻。", duration: 0 },
        { instruction: "意粉加入煙肉鑊，倒入蛋汁快速拌勻，加煮麵水調整濃稠度。", duration: 2 },
      ],
      tags: ["西式", "早餐", "意粉", "30 分鐘內"],
    },
  ],
  "西餐 - 主菜": [
    {
      name: "香煎三文魚",
      description: "外脆內嫩，檸檬牛油汁，西餐廳水準在家輕鬆做。",
      cookTime: 20,
      servings: 2,
      difficulty: "中等",
      ingredients: [
        { name: "三文魚柳", quantity: "2", unit: "塊", category: "海鮮" },
        { name: "檸檬", quantity: "半個", unit: "", category: "蔬菜" },
        { name: "牛油", quantity: "1", unit: "湯匙", category: "調味料" },
        { name: "蒜頭", quantity: "2", unit: "瓣", category: "調味料" },
        { name: "鹽", quantity: "適量", unit: "", category: "調味料" },
        { name: "黑胡椒", quantity: "適量", unit: "", category: "調味料" },
      ],
      steps: [
        { instruction: "三文魚用紙巾吸乾水份，兩面撒鹽和黑胡椒醃 5 分鐘。", duration: 5 },
        { instruction: "中火燒熱鑊，加入牛油和蒜蓉爆香。", duration: 2 },
        { instruction: "放入三文魚，每面煎 3-4 分鐘至金黃。", duration: 7 },
        { instruction: "擠檸檬汁，即可上碟。", duration: 0 },
      ],
      tags: ["西式", "海鮮", "健康", "高蛋白", "30 分鐘內"],
    },
  ],
  "日式 - 主菜": [
    {
      name: "日式親子丼",
      description: "滑蛋雞肉丼，日式甜醬油湯底，10 分鐘快手午餐。",
      cookTime: 15,
      servings: 2,
      difficulty: "簡單",
      ingredients: [
        { name: "雞腿肉", quantity: "300", unit: "克", category: "肉類" },
        { name: "雞蛋", quantity: "3", unit: "隻", category: "蛋奶" },
        { name: "洋蔥", quantity: "半個", unit: "", category: "蔬菜" },
        { name: "日式醬油", quantity: "3", unit: "湯匙", category: "調味料" },
        { name: "味醂", quantity: "2", unit: "湯匙", category: "調味料" },
        { name: "清酒", quantity: "1", unit: "湯匙", category: "調味料" },
        { name: "砂糖", quantity: "1", unit: "茶匙", category: "調味料" },
      ],
      steps: [
        { instruction: "雞腿肉切件；洋蔥切絲；醬油、味醂、清酒、砂糖混合備用。", duration: 0 },
        { instruction: "小鍋下洋蔥絲，倒入調味汁，中火煮至洋蔥軟化，加入雞肉煮熟。", duration: 5 },
        { instruction: "雞蛋打散，倒入鍋中，蓋蓋小火煮至蛋液半凝固，鋪在白飯上即成。", duration: 3 },
      ],
      tags: ["日式", "丼飯", "快手", "30 分鐘內"],
    },
  ],
  "韓式 - 主菜": [
    {
      name: "韓式辣炒年糕",
      description: "正宗韓式辣炒年糕，QQ 年糕配魚餅，香辣甜鹹。",
      cookTime: 20,
      servings: 2,
      difficulty: "簡單",
      ingredients: [
        { name: "韓式年糕條", quantity: "300", unit: "克", category: "主食" },
        { name: "韓式魚餅", quantity: "150", unit: "克", category: "海鮮" },
        { name: "韓式辣椒醬", quantity: "3", unit: "湯匙", category: "調味料" },
        { name: "砂糖", quantity: "1", unit: "湯匙", category: "調味料" },
        { name: "醬油", quantity: "1", unit: "湯匙", category: "調味料" },
        { name: "蔥", quantity: "2", unit: "條", category: "蔬菜" },
      ],
      steps: [
        { instruction: "年糕條提前浸水 20 分鐘；魚餅切件；辣椒醬、砂糖、醬油混合備用。", duration: 0 },
        { instruction: "鍋中加入 500ml 水，放入辣醬汁，大火煮沸。", duration: 5 },
        { instruction: "加入年糕和魚餅，中火煮 10-15 分鐘至年糕軟化、醬汁濃稠，撒上蔥花即成。", duration: 12 },
      ],
      tags: ["韓式", "年糕", "辣", "小食", "30 分鐘內"],
    },
  ],
  "東南亞 - 主菜": [
    {
      name: "泰式香葉肉碎煎蛋飯",
      description: "正宗泰式打拋豬，九層塔香氣濃郁，一碟過癮。",
      cookTime: 20,
      servings: 2,
      difficulty: "中等",
      ingredients: [
        { name: "免治豬肉", quantity: "300", unit: "克", category: "肉類" },
        { name: "雞蛋", quantity: "2", unit: "隻", category: "蛋奶" },
        { name: "豆角", quantity: "100", unit: "克", category: "蔬菜" },
        { name: "九層塔", quantity: "1", unit: "棵", category: "蔬菜" },
        { name: "蒜頭", quantity: "2", unit: "粒", category: "調味料" },
        { name: "魚露", quantity: "3", unit: "茶匙", category: "調味料" },
        { name: "油", quantity: "1", unit: "茶匙", category: "調味料" },
      ],
      steps: [
        { instruction: "下油爆香蒜頭，加入免治豬肉炒散至熟。", duration: 3 },
        { instruction: "加入豆角炒熟，倒入魚露、蠔油調味。", duration: 2 },
        { instruction: "最後加入九層塔炒勻，另鍋煎太陽蛋，鋪在飯上即成。", duration: 3 },
      ],
      tags: ["泰式", "香葉", "肉碎", "30 分鐘內"],
    },
  ],
  "甜品 - 小食": [
    {
      name: "椰汁西米露",
      description: "經典港式糖水，清甜滑溜，冷熱皆宜。",
      cookTime: 30,
      servings: 4,
      difficulty: "簡單",
      ingredients: [
        { name: "西米", quantity: "100", unit: "克", category: "主食" },
        { name: "椰汁", quantity: "400", unit: "毫升", category: "飲品" },
        { name: "砂糖", quantity: "2", unit: "湯匙", category: "調味料" },
        { name: "清水", quantity: "500", unit: "毫升", category: "調味料" },
      ],
      steps: [
        { instruction: "水煲滾，加入西米煮 15 分鐘至透明，過冷河。", duration: 15 },
        { instruction: "椰汁加糖煮溶，加入西米拌勻即可。", duration: 5 },
      ],
      tags: ["糖水", "甜品", "廣東", "消暑", "清熱"],
    },
  ],
  "其他 - 素食": [
    {
      name: "清炒豆腐",
      description: "簡單健康的素食選擇，豆腐嫩滑，清淡美味。",
      cookTime: 15,
      servings: 2,
      difficulty: "簡單",
      ingredients: [
        { name: "硬豆腐", quantity: "1", unit: "塊", category: "蛋奶" },
        { name: "蔥", quantity: "2", unit: "條", category: "蔬菜" },
        { name: "生抽", quantity: "1", unit: "湯匙", category: "調味料" },
        { name: "麻油", quantity: "1", unit: "茶匙", category: "調味料" },
      ],
      steps: [
        { instruction: "豆腐切件，蔥切花。", duration: 0 },
        { instruction: "鑊中下少許油，放入豆腐煎至兩面金黃。", duration: 5 },
        { instruction: "加入生抽和少許水，煮至入味，撒蔥花和麻油即成。", duration: 3 },
      ],
      tags: ["素食", "清淡健康", "快手", "30 分鐘內"],
    },
  ],
  "其他 - 健康": [
    {
      name: "雞胸肉沙律",
      description: "高蛋白低卡健康餐，適合健身人士。",
      cookTime: 20,
      servings: 2,
      difficulty: "簡單",
      ingredients: [
        { name: "雞胸肉", quantity: "300", unit: "克", category: "肉類" },
        { name: "生菜", quantity: "100", unit: "克", category: "蔬菜" },
        { name: "蕃茄", quantity: "1", unit: "個", category: "蔬菜" },
        { name: "青瓜", quantity: "半條", unit: "", category: "蔬菜" },
        { name: "橄欖油", quantity: "1", unit: "湯匙", category: "調味料" },
        { name: "檸檬汁", quantity: "1", unit: "湯匙", category: "調味料" },
      ],
      steps: [
        { instruction: "雞胸肉用鹽和黑胡椒醃 10 分鐘，煎熟切件。", duration: 10 },
        { instruction: "生菜洗淨撕小片，蕃茄和青瓜切片。", duration: 0 },
        { instruction: "所有材料混合，淋上橄欖油和檸檬汁拌勻即成。", duration: 0 },
      ],
      tags: ["健康", "低卡", "高蛋白", "沙律"],
    },
  ],
};

async function seedOfficialRecipes() {
  console.log(' Seeding official recipes...');
  console.log('BASE_RECIPES keys:', Object.keys(BASE_RECIPES));

  const recipes = [];

  for (const dist of DISTRIBUTION) {
    const key = `${dist.category} - ${dist.subType}`;
    const baseRecipes = BASE_RECIPES[key] || [];

    for (let i = 0; i < dist.count; i++) {
      const template = baseRecipes[i % baseRecipes.length];

      if (!template) {
        console.warn(`No template for ${key}, skipping`);
        continue;
      }

      // Add variation to name for uniqueness
      const variations = ["", "（家常版）", "（快手版）", "（宴客版）", "（小朋友版）", "（健康版）"];
      const variation = variations[i % variations.length];

      recipes.push({
        imported_by_user_id: "system",
        name: template.name + variation,
        description: template.description,
        image: null,
        thumbnail_url: null,
        cook_time: template.cookTime,
        servings: template.servings,
        difficulty: template.difficulty,
        recipe_category: dist.category,
        ingredients: JSON.stringify(template.ingredients),
        steps: JSON.stringify(template.steps),
        tags: JSON.stringify([...template.tags, ...dist.tags]),
        source_type: "manual",
        source_url: null,
        source_url_hash: null,
        source_author: null,
        tips: null,
        is_active: true,
      });
    }
  }

  console.log(`Generated ${recipes.length} recipes`);

  // Insert one by one
  for (let i = 0; i < recipes.length; i++) {
    const r = recipes[i];

    await sql`
      INSERT INTO official_recipes (
        imported_by_user_id, name, description, image, thumbnail_url,
        cook_time, servings, difficulty, recipe_category,
        ingredients, steps, tags, source_type, source_url, source_url_hash,
        source_author, tips, is_active
      ) VALUES (
        ${r.imported_by_user_id}, ${r.name}, ${r.description}, ${r.image}, ${r.thumbnail_url},
        ${r.cook_time}, ${r.servings}, ${r.difficulty}, ${r.recipe_category},
        ${r.ingredients}, ${r.steps}, ${r.tags}, ${r.source_type}, ${r.source_url}, ${r.source_url_hash},
        ${r.source_author}, ${r.tips}, ${r.is_active}
      )
    `;

    if ((i + 1) % 50 === 0) {
      console.log(`✅ Inserted ${i + 1} recipes...`);
    }
  }

  // Verify count
  const count = await sql`SELECT COUNT(*) as count FROM official_recipes`;
  console.log(`✅ Total recipes in database: ${count[0].count}`);

  await sql.end();
}

seedOfficialRecipes().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
