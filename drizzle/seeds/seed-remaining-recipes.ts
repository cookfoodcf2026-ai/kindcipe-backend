import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!);

const REMAINING_DISTRIBUTION = [
  { category: "日式", count: 20 },  // Need 50 total, have 30
  { category: "甜品", count: 40 },
  { category: "韓式", count: 30 },
  { category: "東南亞", count: 20 },
  { category: "其他", count: 30 },
];

const RECIPE_TEMPLATES: Record<string, Array<{
  name: string;
  description: string;
  cookTime: number;
  servings: number;
  difficulty: string;
  ingredients: Array<{ name: string; quantity: string; unit: string; category: string }>;
  steps: Array<{ instruction: string; duration: number }>;
  tags: string[];
}>> = {
  "日式": [
    {
      name: "日式親子丼",
      description: "雞肉滑嫩，蛋液半熟，配白飯一流。",
      cookTime: 20,
      servings: 2,
      difficulty: "簡單",
      ingredients: [
        { name: "雞腿肉", quantity: "200", unit: "克", category: "肉類" },
        { name: "雞蛋", quantity: "3", unit: "隻", category: "其他" },
        { name: "洋蔥", quantity: "半個", unit: "", category: "蔬菜" },
        { name: "生抽", quantity: "2", unit: "湯匙", category: "調味料" },
        { name: "味醂", quantity: "2", unit: "湯匙", category: "調味料" },
        { name: "水", quantity: "100", unit: "毫升", category: "其他" },
        { name: "糖", quantity: "1", unit: "茶匙", category: "調味料" },
        { name: "白飯", quantity: "2", unit: "碗", category: "其他" },
      ],
      steps: [
        { instruction: "雞腿肉切塊，洋蔥切絲，雞蛋打散。", duration: 5 },
        { instruction: "小鍋加入生抽、味醂、水、糖煮滾。", duration: 3 },
        { instruction: "加入洋蔥絲煮至軟化。", duration: 3 },
        { instruction: "加入雞肉煮至變色。", duration: 5 },
        { instruction: "倒入蛋液，蓋蓋煮30秒至半熟。", duration: 1 },
        { instruction: "連汁淋在白飯上即可。", duration: 1 },
      ],
      tags: ["下飯", "簡單", "經典"],
    },
    {
      name: "日式照燒雞",
      description: "醬汁濃郁，雞肉嫩滑，配飯配麵都適合。",
      cookTime: 25,
      servings: 3,
      difficulty: "簡單",
      ingredients: [
        { name: "雞腿肉", quantity: "400", unit: "克", category: "肉類" },
        { name: "生抽", quantity: "3", unit: "湯匙", category: "調味料" },
        { name: "味醂", quantity: "3", unit: "湯匙", category: "調味料" },
        { name: "清酒", quantity: "2", unit: "湯匙", category: "調味料" },
        { name: "糖", quantity: "1", unit: "湯匙", category: "調味料" },
        { name: "白芝麻", quantity: "適量", unit: "", category: "調味料" },
      ],
      steps: [
        { instruction: "雞腿肉去皮，用叉戳幾個小孔方便入味。", duration: 3 },
        { instruction: "調照燒汁：生抽、味醂、清酒、糖混合。", duration: 2 },
        { instruction: "中火燒熱鑊，雞皮向下煎至金黃。", duration: 5 },
        { instruction: "翻面繼續煎至兩面金黃。", duration: 5 },
        { instruction: "倒入照燒汁，小火煮至汁濃稠。", duration: 8 },
        { instruction: "切塊，灑白芝麻即可。", duration: 2 },
      ],
      tags: ["下飯", "經典", "簡單"],
    },
  ],
  "甜品": [
    {
      name: "芒果西米露",
      description: "清甜順滑，夏天必食甜品。",
      cookTime: 25,
      servings: 4,
      difficulty: "簡單",
      ingredients: [
        { name: "西米", quantity: "100", unit: "克", category: "其他" },
        { name: "芒果", quantity: "2", unit: "個", category: "蔬菜" },
        { name: "椰奶", quantity: "200", unit: "毫升", category: "其他" },
        { name: "糖", quantity: "3", unit: "湯匙", category: "調味料" },
        { name: "水", quantity: "500", unit: "毫升", category: "其他" },
      ],
      steps: [
        { instruction: "大鍋水煮滾，加入西米，攪拌防止黏底。", duration: 2 },
        { instruction: "中火煮至西米透明，約15分鐘。", duration: 15 },
        { instruction: "撈起西米過冷水，瀝乾。", duration: 3 },
        { instruction: "芒果切粒，一半打成泥。", duration: 3 },
        { instruction: "鍋中加入水同糖煮滾，加入芒果泥同椰奶。", duration: 3 },
        { instruction: "加入西米同芒果粒，拌勻即可。", duration: 2 },
      ],
      tags: ["清甜"],
    },
    {
      name: "紅豆沙",
      description: "傳統中式糖水，綿密香甜。",
      cookTime: 90,
      servings: 6,
      difficulty: "簡單",
      ingredients: [
        { name: "紅豆", quantity: "200", unit: "克", category: "乾貨" },
        { name: "冰糖", quantity: "100", unit: "克", category: "調味料" },
        { name: "水", quantity: "1500", unit: "毫升", category: "其他" },
        { name: "陳皮", quantity: "1", unit: "小塊", category: "調味料" },
      ],
      steps: [
        { instruction: "紅豆洗淨，浸水4小時或過夜。", duration: 240 },
        { instruction: "紅豆瀝乾，加入水同陳皮，大火煮滾。", duration: 5 },
        { instruction: "轉小火煮60分鐘至紅豆軟化。", duration: 60 },
        { instruction: "加入冰糖，攪拌至融化。", duration: 5 },
        { instruction: "繼續煮10分鐘至濃稠即可。", duration: 10 },
      ],
      tags: ["暖胃"],
    },
  ],
  "韓式": [
    {
      name: "韓式拌飯",
      description: "色彩豐富，營養均衡，韓式辣醬畫龍點睛。",
      cookTime: 30,
      servings: 2,
      difficulty: "簡單",
      ingredients: [
        { name: "白飯", quantity: "2", unit: "碗", category: "其他" },
        { name: "牛肉", quantity: "150", unit: "克", category: "肉類" },
        { name: "菠菜", quantity: "100", unit: "克", category: "蔬菜" },
        { name: "紅蘿蔔", quantity: "半條", unit: "", category: "蔬菜" },
        { name: "芽菜", quantity: "100", unit: "克", category: "蔬菜" },
        { name: "雞蛋", quantity: "2", unit: "隻", category: "其他" },
        { name: "韓式辣醬", quantity: "2", unit: "湯匙", category: "調味料" },
        { name: "麻油", quantity: "1", unit: "湯匙", category: "調味料" },
        { name: "生抽", quantity: "1", unit: "湯匙", category: "調味料" },
        { name: "蒜頭", quantity: "1", unit: "瓣", category: "調味料" },
      ],
      steps: [
        { instruction: "牛肉切片，用生抽、麻油、蒜蓉醃10分鐘。", duration: 10 },
        { instruction: "菠菜、芽菜分別飛水，瀝乾備用。", duration: 5 },
        { instruction: "紅蘿蔔切絲炒軟。", duration: 3 },
        { instruction: "煎牛肉至熟，煎太陽蛋。", duration: 5 },
        { instruction: "碗底放飯，鋪上所有配料。", duration: 2 },
        { instruction: "加韓式辣醬，拌勻即可。", duration: 1 },
      ],
      tags: ["經典"],
    },
    {
      name: "韓式泡菜湯",
      description: "酸辣暖胃，冬天必食。",
      cookTime: 25,
      servings: 3,
      difficulty: "簡單",
      ingredients: [
        { name: "韓式泡菜", quantity: "200", unit: "克", category: "蔬菜" },
        { name: "豬肉", quantity: "150", unit: "克", category: "肉類" },
        { name: "豆腐", quantity: "1", unit: "塊", category: "其他" },
        { name: "洋蔥", quantity: "半個", unit: "", category: "蔬菜" },
        { name: "蔥", quantity: "1", unit: "條", category: "蔬菜" },
        { name: "泡菜汁", quantity: "3", unit: "湯匙", category: "調味料" },
        { name: "生抽", quantity: "1", unit: "湯匙", category: "調味料" },
        { name: "蒜頭", quantity: "2", unit: "瓣", category: "調味料" },
        { name: "水", quantity: "600", unit: "毫升", category: "其他" },
      ],
      steps: [
        { instruction: "泡菜切小段，豬肉切片，豆腐切塊，洋蔥切絲。", duration: 5 },
        { instruction: "鍋中落少許油，炒香蒜蓉同洋蔥。", duration: 2 },
        { instruction: "加入豬肉炒至變色。", duration: 3 },
        { instruction: "加入泡菜翻炒。", duration: 3 },
        { instruction: "加入水同泡菜汁，煮滾。", duration: 5 },
        { instruction: "加入豆腐，小火煮5分鐘。", duration: 5 },
        { instruction: "加生抽調味，灑蔥花即可。", duration: 2 },
      ],
      tags: ["暖胃"],
    },
  ],
  "東南亞": [
    {
      name: "泰式青咖喱雞",
      description: "香辣濃郁，椰奶順滑，配白飯一流。",
      cookTime: 30,
      servings: 3,
      difficulty: "中等",
      ingredients: [
        { name: "雞腿肉", quantity: "300", unit: "克", category: "肉類" },
        { name: "青咖喱醬", quantity: "2", unit: "湯匙", category: "調味料" },
        { name: "椰奶", quantity: "200", unit: "毫升", category: "其他" },
        { name: "茄子", quantity: "1", unit: "個", category: "蔬菜" },
        { name: "紅椒", quantity: "1", unit: "個", category: "蔬菜" },
        { name: "羅勒葉", quantity: "適量", unit: "", category: "蔬菜" },
        { name: "魚露", quantity: "1", unit: "湯匙", category: "調味料" },
        { name: "糖", quantity: "1", unit: "茶匙", category: "調味料" },
        { name: "食油", quantity: "1", unit: "湯匙", category: "調味料" },
      ],
      steps: [
        { instruction: "雞肉切塊，茄子切塊，紅椒切條。", duration: 5 },
        { instruction: "中火燒熱鑊，落油，炒香青咖喱醬。", duration: 2 },
        { instruction: "加入一半椰奶，煮至油水分離。", duration: 3 },
        { instruction: "加入雞肉翻炒至變色。", duration: 5 },
        { instruction: "加入剩餘椰奶同茄子，煮5分鐘。", duration: 5 },
        { instruction: "加入紅椒、魚露、糖調味。", duration: 2 },
        { instruction: "灑羅勒葉即可上碟。", duration: 1 },
      ],
      tags: ["香辣", "下飯"],
    },
    {
      name: "越南春卷",
      description: "清爽開胃，配花生醬一流。",
      cookTime: 20,
      servings: 4,
      difficulty: "簡單",
      ingredients: [
        { name: "越南米紙", quantity: "10", unit: "張", category: "其他" },
        { name: "蝦", quantity: "200", unit: "克", category: "海鮮" },
        { name: "米粉", quantity: "50", unit: "克", category: "其他" },
        { name: "生菜", quantity: "4", unit: "片", category: "蔬菜" },
        { name: "青瓜", quantity: "1", unit: "條", category: "蔬菜" },
        { name: "紅蘿蔔", quantity: "半條", unit: "", category: "蔬菜" },
        { name: "薄荷葉", quantity: "適量", unit: "", category: "蔬菜" },
        { name: "花生醬", quantity: "3", unit: "湯匙", category: "調味料" },
      ],
      steps: [
        { instruction: "蝦煮熟去殼切半，米粉煮軟瀝乾。", duration: 5 },
        { instruction: "生菜洗淨，青瓜紅蘿蔔切絲。", duration: 5 },
        { instruction: "米紙浸軟，鋪平。", duration: 3 },
        { instruction: "放上生菜、米粉、蝦、蔬菜同薄荷葉。", duration: 3 },
        { instruction: "捲實即可，配花生醬食。", duration: 2 },
      ],
      tags: ["開胃", "健康"],
    },
  ],
  "其他": [
    {
      name: "牛油果多士",
      description: "健康早餐，簡單快捷。",
      cookTime: 10,
      servings: 1,
      difficulty: "簡單",
      ingredients: [
        { name: "牛油果", quantity: "1", unit: "個", category: "蔬菜" },
        { name: "麵包", quantity: "2", unit: "片", category: "其他" },
        { name: "雞蛋", quantity: "1", unit: "隻", category: "其他" },
        { name: "鹽", quantity: "適量", unit: "", category: "調味料" },
        { name: "黑胡椒", quantity: "適量", unit: "", category: "調味料" },
        { name: "檸檬汁", quantity: "少許", unit: "", category: "調味料" },
      ],
      steps: [
        { instruction: "牛油果切半去核，果肉挖出壓成泥。", duration: 3 },
        { instruction: "加檸檬汁、鹽、黑胡椒調味。", duration: 1 },
        { instruction: "麵包烤至金黃。", duration: 3 },
        { instruction: "牛油果泥塗在麵包上，煎太陽蛋放上面。", duration: 3 },
      ],
      tags: ["健康", "簡單"],
    },
    {
      name: "smoothie bowl",
      description: "色彩繽紛，營養豐富嘅健康早餐。",
      cookTime: 10,
      servings: 1,
      difficulty: "簡單",
      ingredients: [
        { name: "香蕉", quantity: "1", unit: "條", category: "蔬菜" },
        { name: "雜莓", quantity: "100", unit: "克", category: "蔬菜" },
        { name: "乳酪", quantity: "100", unit: "克", category: "其他" },
        { name: "燕麥片", quantity: "2", unit: "湯匙", category: "其他" },
        { name: "奇亞籽", quantity: "1", unit: "湯匙", category: "其他" },
        { name: "蜂蜜", quantity: "1", unit: "湯匙", category: "調味料" },
      ],
      steps: [
        { instruction: "香蕉切塊冷凍，雜莓洗淨。", duration: 3 },
        { instruction: "香蕉、雜莓、乳酪放入攪拌機打成泥。", duration: 2 },
        { instruction: "倒入碗中，鋪上燕麥片、奇亞籽。", duration: 2 },
        { instruction: "淋蜂蜜即可。", duration: 1 },
      ],
      tags: ["健康"],
    },
  ],
};

async function generateRecipesForCategory(category: string, count: number): Promise<number> {
  const templates = RECIPE_TEMPLATES[category] || [];
  if (templates.length === 0) {
    console.log(`  ⚠️ No templates for ${category}`);
    return 0;
  }

  let inserted = 0;

  for (let i = 0; i < count; i++) {
    const template = templates[i % templates.length];
    const variation = i < templates.length ? "" : ` (${Math.floor(i / templates.length) + 1})`;

    try {
      await sql`
        INSERT INTO official_recipes (
          imported_by_user_id, name, description, image, thumbnail_url,
          cook_time, servings, difficulty, recipe_category,
          ingredients, steps, tags, source_type, source_url, source_url_hash,
          source_author, tips, is_active
        ) VALUES (
          'seed-generator', ${template.name + variation}, ${template.description}, NULL, NULL,
          ${template.cookTime}, ${template.servings}, ${template.difficulty}, ${category},
          ${JSON.stringify(template.ingredients)}, ${JSON.stringify(template.steps)}, ${JSON.stringify(template.tags)},
          'manual', NULL, NULL, NULL, NULL, true
        )
      `;
      inserted++;
    } catch (err) {
      console.error(`  ❌ Failed to insert ${template.name}:`, err);
    }
  }

  return inserted;
}

async function main() {
  console.log('🚀 Continuing recipe seeding...\n');

  let totalGenerated = 0;

  for (const dist of REMAINING_DISTRIBUTION) {
    console.log(`\n📝 Generating ${dist.count} ${dist.category} recipes...`);
    const generated = await generateRecipesForCategory(dist.category, dist.count);
    totalGenerated += generated;
    console.log(`  ✅ Generated ${generated} ${dist.category} recipes`);
  }

  const count = await sql`SELECT COUNT(*) as count FROM official_recipes`;
  console.log(`\n✅ Total recipes in database: ${count[0].count}`);
  console.log(`🎉 Seeding complete! Generated ${totalGenerated} additional recipes.`);

  await sql.end();
}

main().catch(console.error);
