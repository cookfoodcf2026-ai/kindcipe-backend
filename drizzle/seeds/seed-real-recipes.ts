import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!);

const DISTRIBUTION = [
  { category: "中菜", count: 235 },
  { category: "西餐", count: 95 },
  { category: "日式", count: 50 },
  { category: "甜品", count: 40 },
  { category: "韓式", count: 30 },
  { category: "東南亞", count: 20 },
  { category: "其他", count: 30 },
];

// Pre-defined unique recipes for each category
// These are real, practical recipes that work
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
  "中菜": [
    {
      name: "番茄炒蛋",
      description: "最經典嘅家常菜，酸甜開胃，簡單快捷。",
      cookTime: 15,
      servings: 2,
      difficulty: "簡單",
      ingredients: [
        { name: "番茄", quantity: "2", unit: "個", category: "蔬菜" },
        { name: "雞蛋", quantity: "3", unit: "隻", category: "其他" },
        { name: "蔥", quantity: "1", unit: "條", category: "蔬菜" },
        { name: "糖", quantity: "1", unit: "茶匙", category: "調味料" },
        { name: "鹽", quantity: "適量", unit: "", category: "調味料" },
        { name: "食油", quantity: "2", unit: "湯匙", category: "調味料" },
      ],
      steps: [
        { instruction: "番茄切塊，雞蛋打散加少許鹽，蔥切花。", duration: 5 },
        { instruction: "中火燒熱鑊，落油，倒入蛋液炒至半熟，盛起備用。", duration: 2 },
        { instruction: "同一鑊落番茄塊，翻炒至出汁。", duration: 3 },
        { instruction: "加入糖同少許鹽調味，倒回炒蛋，翻炒均勻。", duration: 2 },
        { instruction: "灑蔥花，即可上碟。", duration: 0 },
      ],
      tags: ["快手", "家常", "開胃"],
    },
    {
      name: "蒜蓉炒時蔬",
      description: "簡單健康嘅炒青菜，蒜香四溢，清脆爽口。",
      cookTime: 10,
      servings: 2,
      difficulty: "簡單",
      ingredients: [
        { name: "菜心", quantity: "300", unit: "克", category: "蔬菜" },
        { name: "蒜頭", quantity: "3", unit: "瓣", category: "調味料" },
        { name: "生抽", quantity: "1", unit: "湯匙", category: "調味料" },
        { name: "鹽", quantity: "適量", unit: "", category: "調味料" },
        { name: "食油", quantity: "2", unit: "湯匙", category: "調味料" },
      ],
      steps: [
        { instruction: "菜心洗淨切段，蒜頭拍扁切蓉。", duration: 3 },
        { instruction: "大火燒熱鑊，落油，爆香蒜蓉。", duration: 1 },
        { instruction: "加入菜心快速翻炒。", duration: 3 },
        { instruction: "加生抽同鹽調味，炒至菜心變軟即可。", duration: 2 },
      ],
      tags: ["快手", "清淡", "健康"],
    },
    {
      name: "蒸水蛋",
      description: "滑嫩可口，老少咸宜，簡單易做。",
      cookTime: 20,
      servings: 2,
      difficulty: "簡單",
      ingredients: [
        { name: "雞蛋", quantity: "3", unit: "隻", category: "其他" },
        { name: "水", quantity: "200", unit: "毫升", category: "其他" },
        { name: "生抽", quantity: "1", unit: "湯匙", category: "調味料" },
        { name: "麻油", quantity: "少許", unit: "", category: "調味料" },
        { name: "蔥花", quantity: "適量", unit: "", category: "蔬菜" },
      ],
      steps: [
        { instruction: "雞蛋打散，加入水同少許鹽攪勻，過篩去除泡沫。", duration: 3 },
        { instruction: "碗面封保鮮紙，用牙籤戳幾個小孔。", duration: 1 },
        { instruction: "大火蒸約12-15分鐘至蛋液凝固。", duration: 15 },
        { instruction: "淋上生抽同麻油，灑蔥花即可。", duration: 1 },
      ],
      tags: ["清淡", "簡單", "家常"],
    },
    {
      name: "紅燒肉",
      description: "肥而不膩，入口即化，經典家常菜。",
      cookTime: 90,
      servings: 4,
      difficulty: "中等",
      ingredients: [
        { name: "五花肉", quantity: "500", unit: "克", category: "肉類" },
        { name: "薑", quantity: "3", unit: "片", category: "調味料" },
        { name: "蔥", quantity: "2", unit: "條", category: "蔬菜" },
        { name: "八角", quantity: "2", unit: "粒", category: "調味料" },
        { name: "冰糖", quantity: "30", unit: "克", category: "調味料" },
        { name: "生抽", quantity: "2", unit: "湯匙", category: "調味料" },
        { name: "老抽", quantity: "1", unit: "湯匙", category: "調味料" },
        { name: "料酒", quantity: "2", unit: "湯匙", category: "調味料" },
      ],
      steps: [
        { instruction: "五花肉切塊，飛水去血沫，撈起備用。", duration: 5 },
        { instruction: "鑊中落少許油，放入冰糖炒至融化呈金黃色。", duration: 3 },
        { instruction: "加入五花肉翻炒上色。", duration: 3 },
        { instruction: "加入薑片、蔥段、八角爆香。", duration: 2 },
        { instruction: "加入料酒、生抽、老抽翻炒均勻。", duration: 2 },
        { instruction: "加入適量水，大火燒開後轉小火燉60分鐘。", duration: 60 },
        { instruction: "大火收汁至濃稠即可。", duration: 5 },
      ],
      tags: ["經典", "下飯", "宴客"],
    },
    {
      name: "宮保雞丁",
      description: "經典川菜，雞肉嫩滑，花生香脆，微辣開胃。",
      cookTime: 25,
      servings: 3,
      difficulty: "中等",
      ingredients: [
        { name: "雞胸肉", quantity: "300", unit: "克", category: "肉類" },
        { name: "花生", quantity: "50", unit: "克", category: "乾貨" },
        { name: "乾辣椒", quantity: "5", unit: "條", category: "調味料" },
        { name: "花椒", quantity: "1", unit: "茶匙", category: "調味料" },
        { name: "蔥", quantity: "2", unit: "條", category: "蔬菜" },
        { name: "薑", quantity: "2", unit: "片", category: "調味料" },
        { name: "蒜頭", quantity: "2", unit: "瓣", category: "調味料" },
        { name: "生抽", quantity: "2", unit: "湯匙", category: "調味料" },
        { name: "醋", quantity: "1", unit: "湯匙", category: "調味料" },
        { name: "糖", quantity: "1", unit: "湯匙", category: "調味料" },
        { name: "生粉", quantity: "1", unit: "茶匙", category: "調味料" },
        { name: "食油", quantity: "3", unit: "湯匙", category: "調味料" },
      ],
      steps: [
        { instruction: "雞胸肉切丁，加生抽、生粉醃15分鐘。", duration: 15 },
        { instruction: "花生炒香備用，蔥切段，薑蒜切末，乾辣椒剪段。", duration: 5 },
        { instruction: "調汁：生抽、醋、糖、少許水混合。", duration: 1 },
        { instruction: "大火燒熱鑊，落油，炒香花椒同乾辣椒。", duration: 1 },
        { instruction: "加入雞丁炒至變色。", duration: 4 },
        { instruction: "加入薑蒜末炒香，倒入調汁翻炒均勻。", duration: 2 },
        { instruction: "加入花生同蔥段，快速翻炒即可上碟。", duration: 1 },
      ],
      tags: ["微辣", "開胃", "經典"],
    },
  ],
  "西餐": [
    {
      name: "意式番茄肉醬意粉",
      description: "經典意大利菜，肉醬濃郁，配意粉一流。",
      cookTime: 45,
      servings: 4,
      difficulty: "中等",
      ingredients: [
        { name: "意大利粉", quantity: "400", unit: "克", category: "其他" },
        { name: "免治牛肉", quantity: "300", unit: "克", category: "肉類" },
        { name: "番茄", quantity: "4", unit: "個", category: "蔬菜" },
        { name: "洋蔥", quantity: "1", unit: "個", category: "蔬菜" },
        { name: "蒜頭", quantity: "3", unit: "瓣", category: "調味料" },
        { name: "番茄膏", quantity: "2", unit: "湯匙", category: "調味料" },
        { name: "橄欖油", quantity: "2", unit: "湯匙", category: "調味料" },
        { name: "鹽", quantity: "適量", unit: "", category: "調味料" },
        { name: "黑胡椒", quantity: "適量", unit: "", category: "調味料" },
        { name: "芝士粉", quantity: "適量", unit: "", category: "其他" },
      ],
      steps: [
        { instruction: "大鍋水煮滾，加鹽，煮意粉至al dente，撈起備用。", duration: 10 },
        { instruction: "番茄切塊，洋蔥同蒜頭切末。", duration: 5 },
        { instruction: "中火燒熱鑊，落橄欖油，炒香洋蔥同蒜末。", duration: 3 },
        { instruction: "加入免治牛肉炒至變色。", duration: 5 },
        { instruction: "加入番茄塊同番茄膏，翻炒至番茄軟化。", duration: 5 },
        { instruction: "加鹽同黑胡椒調味，小火燉20分鐘。", duration: 20 },
        { instruction: "將肉醬淋在意粉上，灑芝士粉即可。", duration: 2 },
      ],
      tags: ["經典", "家庭", "飽肚"],
    },
    {
      name: "凱撒沙律",
      description: "清爽開胃，脆口生菜配濃郁醬汁。",
      cookTime: 15,
      servings: 2,
      difficulty: "簡單",
      ingredients: [
        { name: "羅馬生菜", quantity: "1", unit: "棵", category: "蔬菜" },
        { name: "麵包", quantity: "2", unit: "片", category: "其他" },
        { name: " Parmesan芝士", quantity: "30", unit: "克", category: "其他" },
        { name: "雞蛋", quantity: "1", unit: "隻", category: "其他" },
        { name: "蒜頭", quantity: "1", unit: "瓣", category: "調味料" },
        { name: "檸檬汁", quantity: "1", unit: "湯匙", category: "調味料" },
        { name: "橄欖油", quantity: "3", unit: "湯匙", category: "調味料" },
        { name: "鹽", quantity: "適量", unit: "", category: "調味料" },
        { name: "黑胡椒", quantity: "適量", unit: "", category: "調味料" },
      ],
      steps: [
        { instruction: "生菜洗淨撕小片，瀝乾水分。", duration: 3 },
        { instruction: "麵包切小粒，用橄欖油煎至金黃脆口。", duration: 5 },
        { instruction: "做醬：雞蛋黃、蒜蓉、檸檬汁、橄欖油攪勻。", duration: 3 },
        { instruction: "生菜拌入醬汁，灑麵包粒同芝士粉。", duration: 2 },
        { instruction: "加鹽同黑胡椒調味即可。", duration: 1 },
      ],
      tags: ["清淡", "開胃", "健康"],
    },
    {
      name: "奶油蘑菇湯",
      description: "濃郁順滑，暖胃之選。",
      cookTime: 30,
      servings: 4,
      difficulty: "簡單",
      ingredients: [
        { name: "蘑菇", quantity: "300", unit: "克", category: "蔬菜" },
        { name: "洋蔥", quantity: "1", unit: "個", category: "蔬菜" },
        { name: "牛油", quantity: "30", unit: "克", category: "其他" },
        { name: "麵粉", quantity: "2", unit: "湯匙", category: "其他" },
        { name: "雞湯", quantity: "500", unit: "毫升", category: "其他" },
        { name: "淡奶油", quantity: "100", unit: "毫升", category: "其他" },
        { name: "鹽", quantity: "適量", unit: "", category: "調味料" },
        { name: "黑胡椒", quantity: "適量", unit: "", category: "調味料" },
      ],
      steps: [
        { instruction: "蘑菇切片，洋蔥切末。", duration: 3 },
        { instruction: "中火融化牛油，炒香洋蔥末。", duration: 3 },
        { instruction: "加入蘑菇炒至軟化。", duration: 5 },
        { instruction: "篩入麵粉翻炒均勻。", duration: 2 },
        { instruction: "慢慢加入雞湯，攪勻避免起粒。", duration: 3 },
        { instruction: "小火煮10分鐘，加入淡奶油。", duration: 10 },
        { instruction: "加鹽同黑胡椒調味即可。", duration: 2 },
      ],
      tags: ["暖胃", "濃郁", "簡單"],
    },
  ],
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
      tags: ["營養", "色彩豐富", "經典"],
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
      tags: ["暖胃", "酸辣", "冬天"],
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
      tags: ["香辣", "濃郁", "下飯"],
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
      tags: ["清爽", "開胃", "健康"],
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
      tags: ["清甜", "夏天", "順滑"],
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
      tags: ["傳統", "暖胃", "香甜"],
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
      tags: ["健康", "早餐", "簡單"],
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
      tags: ["健康", "早餐", "營養"],
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

  // Generate recipes by cycling through templates with variations
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
  console.log('🚀 Starting recipe seeding...\n');

  // Clear existing recipes
  console.log('📋 Clearing existing official recipes...');
  await sql`DELETE FROM official_recipes`;
  console.log('✅ Cleared\n');

  let totalGenerated = 0;

  for (const dist of DISTRIBUTION) {
    console.log(`\n📝 Generating ${dist.count} ${dist.category} recipes...`);
    const generated = await generateRecipesForCategory(dist.category, dist.count);
    totalGenerated += generated;
    console.log(`  ✅ Generated ${generated} ${dist.category} recipes`);
  }

  // Verify
  const count = await sql`SELECT COUNT(*) as count FROM official_recipes`;
  console.log(`\n✅ Total recipes in database: ${count[0].count}`);
  console.log(`🎉 Seeding complete! Generated ${totalGenerated} recipes.`);

  await sql.end();
}

main().catch(console.error);
