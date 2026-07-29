export const CUSTOM_QUICK_RECIPES = [
  {
    name: "上湯枸杞浸菜心",
    description: "清甜健康嘅快手滾湯菜，枸杞明目，菜心爽脆，上湯鮮美。",
    cookTime: 12,
    servings: 2,
    difficulty: "簡單",
    recipeCategory: "中菜",
    ingredients: [
      { name: "菜心", quantity: "300", unit: "克", category: "蔬菜" },
      { name: "枸杞", quantity: "15", unit: "克", category: "蔬菜" },
      { name: "薑絲", quantity: "5", unit: "克", category: "調味料" },
      { name: "清雞湯", quantity: "500", unit: "毫升", category: "調味料" },
      { name: "鹽", quantity: "適量", unit: "", category: "調味料" },
    ],
    steps: [
      { instruction: "菜心洗淨切段，枸杞洗淨浸泡，薑切絲。", duration: 4 },
      { instruction: "鍋中倒入清雞湯同薑絲，大火燒開。", duration: 3 },
      { instruction: "加入菜心同枸杞，煮至菜心變軟（約3-4分鐘）。", duration: 4 },
      { instruction: "加少許鹽調味即可上碟。", duration: 1 },
    ],
    tags: ["15 分鐘內", "快手", "簡單", "清淡", "健康"],
  },
  {
    name: "洋蔥炒豬肉片",
    description: "非常惹味下飯嘅家常小炒，洋蔥香甜，肉片滑嫩，簡單快捷。",
    cookTime: 15,
    servings: 2,
    difficulty: "簡單",
    recipeCategory: "中菜",
    ingredients: [
      { name: "豬肉片", quantity: "200", unit: "克", category: "肉類" },
      { name: "洋蔥", quantity: "1", unit: "個", category: "蔬菜" },
      { name: "生抽", quantity: "1", unit: "湯匙", category: "調味料" },
      { name: "老抽", quantity: "1", unit: "茶匙", category: "調味料" },
      { name: "糖", quantity: "1", unit: "茶匙", category: "調味料" },
      { name: "生粉", quantity: "1", unit: "茶匙", category: "調味料" },
      { name: "食油", quantity: "2", unit: "湯匙", category: "調味料" },
    ],
    steps: [
      { instruction: "洋蔥切絲；豬肉片加生抽、糖同生粉醃10分鐘。", duration: 5 },
      { instruction: "大火燒熱鑊落油，下肉片炒至八成熟，盛起備用。", duration: 3 },
      { instruction: "同一鑊下洋蔥絲翻炒至變軟出香味。", duration: 4 },
      { instruction: "倒回肉片，加老抽同少許水，大火快速翻炒均勻即可。", duration: 3 },
    ],
    tags: ["15 分鐘內", "快手", "簡單", "家常", "下飯"],
  },
  {
    name: "勝瓜炒蝦仁",
    description: "勝瓜（絲瓜）清甜多汁，蝦仁爽口彈牙，係一道清爽美味嘅快手家常菜。",
    cookTime: 12,
    servings: 2,
    difficulty: "簡單",
    recipeCategory: "中菜",
    ingredients: [
      { name: "勝瓜", quantity: "1", unit: "條", category: "蔬菜" },
      { name: "蝦仁", quantity: "150", unit: "克", category: "海鮮" },
      { name: "蒜蓉", quantity: "1", unit: "湯匙", category: "調味料" },
      { name: "薑片", quantity: "2", unit: "片", category: "調味料" },
      { name: "鹽", quantity: "適量", unit: "", category: "調味料" },
      { name: "紹興酒", quantity: "1", unit: "茶匙", category: "調味料" },
    ],
    steps: [
      { instruction: "勝瓜去硬皮切滾刀塊；蝦仁洗淨瀝乾加少許鹽同紹興酒醃5分鐘。", duration: 4 },
      { instruction: "大火熱鑊落油，爆香蒜蓉同薑片，下蝦仁炒至變色盛起。", duration: 3 },
      { instruction: "下勝瓜塊翻炒，加少許水，蓋上鍋蓋燜煮2分鐘至勝瓜變軟。", duration: 3 },
      { instruction: "倒回蝦仁，加鹽調味，快速炒勻即可上碟。", duration: 2 },
    ],
    tags: ["15 分鐘內", "快手", "簡單", "鮮味", "家常"],
  },
  {
    name: "薑蔥生蠔煲",
    description: "經典大牌檔風味，生蠔肥美滑嫩，薑蔥香濃惹味，用砂鍋保溫效果極佳。",
    cookTime: 25,
    servings: 2,
    difficulty: "中等",
    recipeCategory: "中菜",
    ingredients: [
      { name: "生蠔", quantity: "8", unit: "隻", category: "海鮮" },
      { name: "薑片", quantity: "8", unit: "片", category: "調味料" },
      { name: "蔥段", quantity: "3", unit: "條", category: "蔬菜" },
      { name: "蒜頭", quantity: "4", unit: "瓣", category: "調味料" },
      { name: "生抽", quantity: "1", unit: "湯匙", category: "調味料" },
      { name: "蠔油", quantity: "1", unit: "湯匙", category: "調味料" },
      { name: "紹興酒", quantity: "1", unit: "湯匙", category: "調味料" },
      { name: "生粉", quantity: "適量", unit: "", category: "調味料" },
    ],
    steps: [
      { instruction: "生蠔用生粉洗淨粘液，汆水10秒鎖住水分，撈出瀝乾，拍上薄薄生粉。", duration: 8 },
      { instruction: "熱鑊下油，下生蠔煎至兩面金黃，盛起備用。", duration: 4 },
      { instruction: "砂鍋熱油，爆香薑片、蒜頭同蔥白段。", duration: 4 },
      { instruction: "放入生蠔，淋上生抽、蠔油調成嘅醬汁，灑入蔥綠段同紹興酒，蓋上蓋焗1分鐘即可。", duration: 4 },
    ],
    tags: ["30 分鐘內", "經典", "大牌檔", "煲仔", "海鮮", "送酒"],
  },
  {
    name: "金銀蛋浸莧菜",
    description: "傳統粵菜，莧菜吸收咗皮蛋同鹹蛋嘅鮮味，湯汁濃郁，菜葉軟滑。",
    cookTime: 15,
    servings: 2,
    difficulty: "簡單",
    recipeCategory: "中菜",
    ingredients: [
      { name: "莧菜", quantity: "300", unit: "克", category: "蔬菜" },
      { name: "皮蛋", quantity: "1", unit: "個", category: "其他" },
      { name: "鹹蛋黃", quantity: "1", unit: "個", category: "其他" },
      { name: "蒜頭", quantity: "3", unit: "瓣", category: "調味料" },
      { name: "清雞湯", quantity: "400", unit: "毫升", category: "調味料" },
    ],
    steps: [
      { instruction: "莧菜洗淨切段；皮蛋同鹹蛋黃蒸熟切丁；蒜頭拍扁。", duration: 5 },
      { instruction: "熱鍋落油，爆香蒜頭至金黃色。", duration: 2 },
      { instruction: "倒入清雞湯，下皮蛋同鹹蛋黃丁煮至湯汁微白。", duration: 4 },
      { instruction: "放入莧菜，煮至莧菜軟身（約3-4分鐘），加少許鹽調味即可。", duration: 4 },
    ],
    tags: ["15 分鐘內", "快手", "簡單", "鮮味", "家常"],
  },
  {
    name: "南乳煲仔齋",
    description: "香濃下飯嘅經典素食，南乳汁鹹香濃郁，多種食材吸滿湯汁，美味健康。",
    cookTime: 25,
    servings: 3,
    difficulty: "簡單",
    recipeCategory: "中菜",
    ingredients: [
      { name: "大白菜", quantity: "200", unit: "克", category: "蔬菜" },
      { name: "冬菇", quantity: "6", unit: "朵", category: "蔬菜" },
      { name: "炸支竹", quantity: "50", unit: "克", category: "其他" },
      { name: "粉絲", quantity: "1", unit: "包", category: "麵類" },
      { name: "紅豆腐乳(南乳)", quantity: "1.5", unit: "塊", category: "調味料" },
      { name: "薑片", quantity: "3", unit: "片", category: "調味料" },
    ],
    steps: [
      { instruction: "冬菇、支竹同粉絲提前浸軟；大白菜切段；南乳加少許水壓碎成汁。", duration: 8 },
      { instruction: "熱鑊下油爆香薑片，下南乳汁炒香。", duration: 2 },
      { instruction: "加入大白菜、冬菇同支竹翻炒勻，加少許水煮開。", duration: 5 },
      { instruction: "轉至砂鍋中，蓋上蓋中火燜煮8分鐘，最後加入粉絲煮2分鐘吸汁即成。", duration: 10 },
    ],
    tags: ["30 分鐘內", "簡單", "素食", "家常", "煲仔"],
  },
  {
    name: "電飯煲豉油皇雞翼飯",
    description: "一煲熟嘅電飯煲懶人料理，雞翼滑嫩入味，米飯吸滿豉油皇醬汁，極之方便。",
    cookTime: 30,
    servings: 2,
    difficulty: "簡單",
    recipeCategory: "中菜",
    ingredients: [
      { name: "米", quantity: "2", unit: "杯", category: "麵類" },
      { name: "雞翼", quantity: "6", unit: "隻", category: "肉類" },
      { name: "生抽", quantity: "2", unit: "湯匙", category: "調味料" },
      { name: "老抽", quantity: "1", unit: "湯匙", category: "調味料" },
      { name: "糖", quantity: "1", unit: "湯匙", category: "調味料" },
      { name: "薑片", quantity: "3", unit: "片", category: "調味料" },
    ],
    steps: [
      { instruction: "雞翼用生抽、老抽、糖同薑片醃15分鐘。", duration: 5 },
      { instruction: "米洗淨放入電飯煲，加入平時煮飯水量少2湯匙嘅水（因為醃料有水分）。", duration: 3 },
      { instruction: "將醃好嘅雞翼同醬汁平鋪喺米上面。", duration: 2 },
      { instruction: "按下煮飯掣，煮好後再保溫燜10分鐘，開蓋拌勻即可食用。", duration: 20 },
    ],
    tags: ["30 分鐘內", "簡單", "快手", "電飯煲料理"],
  },
  {
    name: "電飯煲香菇滑雞飯",
    description: "傳統茶餐廳滑雞飯嘅電飯煲改良版，雞肉滑嫩，冬菇香濃，飯粒晶瑩剔透。",
    cookTime: 30,
    servings: 2,
    difficulty: "簡單",
    recipeCategory: "中菜",
    ingredients: [
      { name: "米", quantity: "2", unit: "杯", category: "麵類" },
      { name: "雞肉", quantity: "250", unit: "克", category: "肉類" },
      { name: "冬菇", quantity: "4", unit: "朵", category: "蔬菜" },
      { name: "生抽", quantity: "1", unit: "湯匙", category: "調味料" },
      { name: "蠔油", quantity: "1", unit: "湯匙", category: "調味料" },
      { name: "生粉", quantity: "1", unit: "茶匙", category: "調味料" },
      { name: "薑絲", quantity: "5", unit: "克", category: "調味料" },
    ],
    steps: [
      { instruction: "冬菇浸軟切條；雞肉切塊，加生抽、蠔油、薑絲同生粉醃15分鐘。", duration: 5 },
      { instruction: "米洗淨放入電飯煲，加入適量水。", duration: 3 },
      { instruction: "將冬菇條同醃好嘅雞肉平鋪喺米飯表面。", duration: 2 },
      { instruction: "啟動普通煮飯程式，跳掣後再燜10分鐘，淋上少許熟油同生抽即可。", duration: 20 },
    ],
    tags: ["30 分鐘內", "簡單", "快手", "電飯煲料理", "經典"],
  },
  {
    name: "電飯煲番茄牛肉燉飯",
    description: "網紅原隻番茄飯升級版，番茄酸甜多汁，肥牛滑嫩，芝士拉絲，大人細路都鍾意。",
    cookTime: 30,
    servings: 2,
    difficulty: "簡單",
    recipeCategory: "中菜",
    ingredients: [
      { name: "米", quantity: "2", unit: "杯", category: "麵類" },
      { name: "番茄", quantity: "1", unit: "個", category: "蔬菜" },
      { name: "肥牛肉片", quantity: "150", unit: "克", category: "肉類" },
      { name: "黑胡椒", quantity: "適量", unit: "", category: "調味料" },
      { name: "鹽", quantity: "適量", unit: "", category: "調味料" },
      { name: "橄欖油", quantity: "1", unit: "湯匙", category: "調味料" },
      { name: "芝士碎", quantity: "30", unit: "克", category: "其他" },
    ],
    steps: [
      { instruction: "米洗淨放入電飯煲，加水平時煮飯量略少（番茄會出水），加橄欖油、鹽同黑胡椒拌勻。", duration: 4 },
      { instruction: "番茄去蒂，頂部劃十字，平放喺電飯煲中間，肥牛鋪喺番茄周圍。", duration: 4 },
      { instruction: "按下煮飯掣。煮好後趁熱撒入芝士碎，將番茄用勺子壓碎，同米飯、肥牛、芝士一起拌勻即可。", duration: 22 },
    ],
    tags: ["30 分鐘內", "簡單", "快手", "電飯煲料理", "酸甜"],
  },
  {
    name: "電飯煲南瓜排骨燜飯",
    description: "南瓜香甜軟糯，排骨滑嫩多汁，一碗飯有齊肉有蔬菜，營養豐富又快手。",
    cookTime: 30,
    servings: 2,
    difficulty: "簡單",
    recipeCategory: "中菜",
    ingredients: [
      { name: "米", quantity: "2", unit: "杯", category: "麵類" },
      { name: "南瓜", quantity: "150", unit: "克", category: "蔬菜" },
      { name: "小排骨", quantity: "200", unit: "克", category: "肉類" },
      { name: "生抽", quantity: "1.5", unit: "湯匙", category: "調味料" },
      { name: "蠔油", quantity: "1", unit: "湯匙", category: "調味料" },
      { name: "薑末", quantity: "5", unit: "克", category: "調味料" },
    ],
    steps: [
      { instruction: "南瓜去籽切小塊；排骨切小段，加生抽、蠔油、薑末醃15分鐘。", duration: 5 },
      { instruction: "米洗淨入電飯煲加水，將醃好嘅排骨同南瓜塊鋪喺米上面。", duration: 3 },
      { instruction: "按下煮飯鍵正常煮飯。", duration: 20 },
      { instruction: "煮好後開蓋拌勻，可以撒少許蔥花增香。", duration: 2 },
    ],
    tags: ["30 分鐘內", "簡單", "快手", "電飯煲料理"],
  },
  {
    name: "電飯煲臘味糯米飯",
    description: "香噴噴嘅廣式臘味糯米飯，唔需要繁瑣嘅蒸鍋手續，用電飯煲就能做出糯口咸香、油潤誘人嘅味道。",
    cookTime: 35,
    servings: 3,
    difficulty: "簡單",
    recipeCategory: "中菜",
    ingredients: [
      { name: "糯米", quantity: "1.5", unit: "杯", category: "麵類" },
      { name: "白米", quantity: "0.5", unit: "杯", category: "麵類" },
      { name: "廣式臘腸", quantity: "1", unit: "條", category: "肉類" },
      { name: "臘肉", quantity: "50", unit: "克", category: "肉類" },
      { name: "冬菇", quantity: "3", unit: "朵", category: "蔬菜" },
      { name: "生抽", quantity: "1.5", unit: "湯匙", category: "調味料" },
      { name: "糖", quantity: "1", unit: "茶匙", category: "調味料" },
    ],
    steps: [
      { instruction: "糯米同白米混合洗淨（混合米飯口感更好，唔易太黏）；臘腸、臘肉、浸軟嘅冬菇切小丁。", duration: 8 },
      { instruction: "米洗淨加入平時煮飯水量略少嘅水，加入生抽同糖拌勻。", duration: 3 },
      { instruction: "將臘腸、臘肉、冬菇丁均勻鋪喺米上面。", duration: 2 },
      { instruction: "啟動標準煮飯程序，煮好後燜10分鐘，開蓋拌勻，撒上蔥花即成。", duration: 22 },
    ],
    tags: ["30 分鐘內", "簡單", "快手", "電飯煲料理", "經典"],
  },
  {
    name: "電飯煲海南雞飯",
    description: "東南亞經典海南雞飯嘅電飯煲懶人版！雞油滲入飯粒，雞肉鮮嫩滑口，一煲過香噴噴。",
    cookTime: 30,
    servings: 2,
    difficulty: "簡單",
    recipeCategory: "中菜",
    ingredients: [
      { name: "雞髀肉", quantity: "2", unit: "塊", category: "肉類" },
      { name: "米", quantity: "2", unit: "杯", category: "麵類" },
      { name: "香茅", quantity: "1", unit: "條", category: "蔬菜" },
      { name: "薑蓉", quantity: "1", unit: "湯匙", category: "調味料" },
      { name: "蒜蓉", quantity: "1", unit: "湯匙", category: "調味料" },
      { name: "薑黃粉", quantity: "0.5", unit: "茶匙", category: "調味料" },
      { name: "食油", quantity: "1", unit: "湯匙", category: "調味料" },
      { name: "鹽", quantity: "適量", unit: "", category: "調味料" },
    ],
    steps: [
      { instruction: "雞髀肉用少許鹽抹勻醃10分鐘；香茅用刀拍扁；薑蒜切蓉。", duration: 5 },
      { instruction: "熱鑊落油，爆香薑蓉、蒜蓉同香茅。", duration: 2 },
      { instruction: "米洗淨放進電飯煲，加入爆香嘅薑蒜同香茅，加平時煮飯水量，放少許鹽同薑黃粉拌勻。", duration: 3 },
      { instruction: "將醃好嘅雞髀肉平鋪在米飯表面，按下普通煮飯掣。", duration: 20 },
    ],
    tags: ["30 分鐘內", "簡單", "快手", "電飯煲料理", "經典"],
  },
  {
    name: "電飯煲番茄芝士肉醬意粉",
    description: "完全唔使開火煮滾水！用電飯煲一煲過做出酸甜惹味、芝士拉絲嘅番茄牛肉意粉。",
    cookTime: 25,
    servings: 2,
    difficulty: "簡單",
    recipeCategory: "西餐",
    ingredients: [
      { name: "意粉", quantity: "150", unit: "克", category: "麵類" },
      { name: "免治牛肉", quantity: "150", unit: "克", category: "肉類" },
      { name: "洋蔥", quantity: "0.5", unit: "個", category: "蔬菜" },
      { name: "番茄意粉醬", quantity: "200", unit: "克", category: "調味料" },
      { name: "莫扎里拉芝士碎", quantity: "40", unit: "克", category: "其他" },
      { name: "鹽", quantity: "適量", unit: "", category: "調味料" },
      { name: "水", quantity: "350", unit: "毫升", category: "其他" },
      { name: "食油", quantity: "1", unit: "湯匙", category: "調味料" },
    ],
    steps: [
      { instruction: "洋蔥切細丁；意粉折成兩段。", duration: 3 },
      { instruction: "電飯煲中加少許油，放入洋蔥丁同免治牛肉，按下煮飯掣炒至牛肉變色（約3分鐘）。", duration: 3 },
      { instruction: "加入番茄意粉醬、水同少許鹽拌勻，然後放入折斷嘅意粉，蓋上蓋繼續煮（約15分鐘），中途開蓋攪拌一次防止黏底。", duration: 15 },
      { instruction: "煮好後趁熱撒入芝士碎，快速攪拌至芝士融化拉絲即可食用。", duration: 4 },
    ],
    tags: ["30 分鐘內", "簡單", "快手", "電飯煲料理", "西餐", "酸甜"],
  },
  {
    name: "電飯煲日式鮭魚菇菌炊飯",
    description: "經典嘅日式和風炊飯，三文魚滑嫩、菇菌鮮美，少油低卡，非常健康。",
    cookTime: 30,
    servings: 2,
    difficulty: "簡單",
    recipeCategory: "日式",
    ingredients: [
      { name: "米", quantity: "2", unit: "杯", category: "麵類" },
      { name: "三文魚柳", quantity: "1", unit: "塊", category: "海鮮" },
      { name: "鴻喜菇", quantity: "100", unit: "克", category: "蔬菜" },
      { name: "日式醬油", quantity: "1.5", unit: "湯匙", category: "調味料" },
      { name: "味醂", quantity: "1", unit: "湯匙", category: "調味料" },
      { name: "昆布高湯", quantity: "350", unit: "毫升", category: "其他" },
      { name: "蔥花", quantity: "適量", unit: "", category: "蔬菜" },
    ],
    steps: [
      { instruction: "三文魚柳用少許鹽抹勻醃5分鐘；鴻喜菇去根掰開。", duration: 4 },
      { instruction: "米洗淨放入電飯煲，加入日式醬油、味醂同昆布高湯（平時煮飯水量），稍微拌勻。", duration: 3 },
      { instruction: "將鴻喜菇同三文魚柳平鋪在米上面，按下普通煮飯掣。", duration: 20 },
      { instruction: "煮好後保溫燜10分鐘，開蓋用勺子將三文魚肉壓碎並挑去魚皮，同米飯、菇菌拌勻，撒上蔥花即成。", duration: 3 },
    ],
    tags: ["30 分鐘內", "簡單", "快手", "電飯煲料理", "和風", "健康"],
  },
  {
    name: "電飯煲韓式泡菜五花肉燜飯",
    description: "酸辣開胃嘅韓式一煲過，泡菜中和咗五花肉嘅油脂，米飯濃郁香口，肥而不膩。",
    cookTime: 30,
    servings: 2,
    difficulty: "簡單",
    recipeCategory: "韓式",
    ingredients: [
      { name: "米", quantity: "2", unit: "杯", category: "麵類" },
      { name: "五花肉片", quantity: "150", unit: "克", category: "肉類" },
      { name: "韓式泡菜", quantity: "100", unit: "克", category: "蔬菜" },
      { name: "洋蔥", quantity: "0.5", unit: "個", category: "蔬菜" },
      { name: "韓式辣醬", quantity: "1", unit: "湯匙", category: "調味料" },
      { name: "芝麻油", quantity: "1", unit: "茶匙", category: "調味料" },
      { name: "溫泉蛋", quantity: "1", unit: "個", category: "其他" },
    ],
    steps: [
      { instruction: "洋蔥切絲；五花肉片切小段；泡菜切碎。", duration: 4 },
      { instruction: "米洗淨入電飯煲，加入比平時略少嘅水（因為泡菜會出水）。", duration: 3 },
      { instruction: "加入韓式辣醬同芝麻油，同米飯混合均勻，再鋪上洋蔥絲、泡菜碎同五花肉片，按下煮飯掣。", duration: 20 },
      { instruction: "煮好後燜10分鐘，開蓋拌勻，裝碟後放上一隻溫泉蛋即可享用。", duration: 3 },
    ],
    tags: ["30 分鐘內", "簡單", "快手", "電飯煲料理", "韓式", "酸辣"],
  },
  {
    name: "電飯煲豉汁排骨陳村粉",
    description: "經典粵式茶樓點心風味！用電飯煲自帶嘅蒸架，15分鐘就能蒸出肉汁滲滿粉皮、油潤滑溜嘅陳村粉。",
    cookTime: 15,
    servings: 2,
    difficulty: "簡單",
    recipeCategory: "中菜",
    ingredients: [
      { name: "陳村粉", quantity: "200", unit: "克", category: "麵類" },
      { name: "排骨", quantity: "250", unit: "克", category: "肉類" },
      { name: "豆豉", quantity: "1", unit: "湯匙", category: "調味料" },
      { name: "蒜蓉", quantity: "1", unit: "湯匙", category: "調味料" },
      { name: "生抽", quantity: "1", unit: "湯匙", category: "調味料" },
      { name: "蠔油", quantity: "1", unit: "湯匙", category: "調味料" },
      { name: "生粉", quantity: "1", unit: "茶匙", category: "調味料" },
      { name: "食油", quantity: "1", unit: "茶匙", category: "調味料" },
      { name: "蔥花", quantity: "適量", unit: "", category: "蔬菜" },
    ],
    steps: [
      { instruction: "排骨切小段，用蒜蓉、豆豉、生抽、蠔油、生粉、糖同少許油醃15分鐘。", duration: 5 },
      { instruction: "電飯煲內放2杯水，按下煮飯掣煮滾，放入蒸架。", duration: 4 },
      { instruction: "將陳村粉平鋪在碟底，上面鋪上醃好嘅排骨，放入碟，蒸15分鐘至排骨熟透。", duration: 15 },
      { instruction: "撒上蔥花即可享用。", duration: 1 },
    ],
    tags: ["15 分鐘內", "快手", "簡單", "電飯煲料理", "鮮味", "家常"],
  },
  {
    name: "電飯煲三色藜麥時蔬雞胸肉飯",
    description: "健身減脂必備！高蛋白、高纖維、低升糖，一煲過有齊雞胸肉同多種時蔬，營養豐富又方便。",
    cookTime: 25,
    servings: 2,
    difficulty: "簡單",
    recipeCategory: "中菜",
    ingredients: [
      { name: "三色藜麥", quantity: "0.5", unit: "杯", category: "麵類" },
      { name: "白米", quantity: "1", unit: "杯", category: "麵類" },
      { name: "雞胸肉", quantity: "150", unit: "克", category: "肉類" },
      { name: "西藍花", quantity: "100", unit: "克", category: "蔬菜" },
      { name: "甘筍", quantity: "50", unit: "克", category: "蔬菜" },
      { name: "玉米粒", quantity: "30", unit: "克", category: "蔬菜" },
      { name: "黑胡椒", quantity: "適量", unit: "", category: "調味料" },
      { name: "生抽", quantity: "1", unit: "湯匙", category: "調味料" },
    ],
    steps: [
      { instruction: "雞胸肉切小丁，用生抽、黑胡椒同生粉醃10分鐘；西藍花切小朵；甘筍切丁。", duration: 5 },
      { instruction: "三色藜麥同白米混合洗淨，放入電飯煲，加入適量水。", duration: 3 },
      { instruction: "將雞胸肉丁、西藍花、甘筍丁同玉米粒均勻鋪在表面，按下煮飯掣。", duration: 20 },
      { instruction: "煮好後再保溫燜5分鐘，開蓋撒少許黑胡椒拌勻即可。", duration: 2 },
    ],
    tags: ["30 分鐘內", "簡單", "快手", "電飯煲料理", "健康", "低卡"],
  },
{
  "name": "電飯煲台式高麗菜鹹飯",
  "description": "傳統台灣家常鹹飯。高麗菜（椰菜）嘅清甜、香菇嘅香氣同蝦米、肉絲嘅鹹香完全融入米飯中，油潤軟糯。",
  "cookTime": 30,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "米",
      "quantity": "2",
      "unit": "杯",
      "category": "麵類"
    },
    {
      "name": "高麗菜",
      "quantity": "150",
      "unit": "克",
      "category": "蔬菜"
    },
    {
      "name": "五花肉絲",
      "quantity": "100",
      "unit": "克",
      "category": "肉類"
    },
    {
      "name": "鮮香菇",
      "quantity": "4",
      "unit": "朵",
      "category": "蔬菜"
    },
    {
      "name": "蝦米",
      "quantity": "15",
      "unit": "克",
      "category": "海鮮"
    },
    {
      "name": "紅蔥頭酥",
      "quantity": "1",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "生抽",
      "quantity": "1.5",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "鹽",
      "quantity": "適量",
      "unit": "",
      "category": "調味料"
    }
  ],
  "steps": [
    {
      "instruction": "高麗菜洗淨切細絲；香菇切丁；蝦米浸軟。",
      "duration": 5
    },
    {
      "instruction": "熱鑊落油，爆香蝦米同香菇，下五花肉絲炒至變色，下高麗菜絲、生抽同鹽翻炒均勻（唔使炒熟，上色即可）。",
      "duration": 5
    },
    {
      "instruction": "米洗淨放入電飯煲，加入剛才炒好嘅料同汁，加水平時煮飯水量略少（高麗菜會出水），灑入紅蔥頭酥拌勻。",
      "duration": 3
    },
    {
      "instruction": "按下煮飯掣。煮好後再保溫燜10分鐘，開蓋拌勻即可。",
      "duration": 17
    }
  ],
  "tags": [
    "30 分鐘內",
    "簡單",
    "快手",
    "電飯煲料理",
    "家常"
  ]
},
{
  "name": "電飯煲川味麻辣牛肉豆腐飯",
  "description": "將麻婆豆腐肥牛做成「一煲熟」！豆腐極其軟嫩，肥牛片吸滿湯汁，米飯麻辣鮮香，極具創意。",
  "cookTime": 30,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "米",
      "quantity": "2",
      "unit": "杯",
      "category": "麵類"
    },
    {
      "name": "肥牛肉片",
      "quantity": "150",
      "unit": "克",
      "category": "肉類"
    },
    {
      "name": "嫩豆腐",
      "quantity": "1",
      "unit": "盒",
      "category": "其他"
    },
    {
      "name": "麻婆豆腐醬",
      "quantity": "2",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "生抽",
      "quantity": "1",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "蔥花",
      "quantity": "適量",
      "unit": "",
      "category": "蔬菜"
    }
  ],
  "steps": [
    {
      "instruction": "豆腐切小方丁；肥牛片切小段。",
      "duration": 4
    },
    {
      "instruction": "米洗淨入電飯煲，加平時煮飯水量，加入麻婆豆腐醬同生抽攪拌均勻。",
      "duration": 3
    },
    {
      "instruction": "將豆腐丁同肥牛片鋪在米上面，按下煮飯掣。",
      "duration": 20
    },
    {
      "instruction": "煮好後保溫燜10分鐘，開蓋輕輕拌勻，撒上蔥花即可。",
      "duration": 3
    }
  ],
  "tags": [
    "30 分鐘內",
    "簡單",
    "快手",
    "電飯煲料理",
    "麻辣"
  ]
},
{
  "name": "電飯煲意式奶油煙肉野菌燉飯",
  "description": "懶人免攪拌版 Risotto！電飯煲直接煮出奶香四溢、煙肉鹹香、菌菇鮮美嘅美味意式燉飯。",
  "cookTime": 25,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "西餐",
  "ingredients": [
    {
      "name": "米",
      "quantity": "2",
      "unit": "杯",
      "category": "麵類"
    },
    {
      "name": "煙肉碎",
      "quantity": "60",
      "unit": "克",
      "category": "肉類"
    },
    {
      "name": "蘑菇",
      "quantity": "100",
      "unit": "克",
      "category": "蔬菜"
    },
    {
      "name": "淡忌廉",
      "quantity": "50",
      "unit": "毫升",
      "category": "調味料"
    },
    {
      "name": "水",
      "quantity": "300",
      "unit": "毫升",
      "category": "其他"
    },
    {
      "name": "巴馬臣芝士粉",
      "quantity": "15",
      "unit": "克",
      "category": "其他"
    },
    {
      "name": "鹽",
      "quantity": "適量",
      "unit": "",
      "category": "調味料"
    },
    {
      "name": "牛油",
      "quantity": "15",
      "unit": "克",
      "category": "調味料"
    }
  ],
  "steps": [
    {
      "instruction": "蘑菇切片；煙肉切碎段。",
      "duration": 3
    },
    {
      "instruction": "電飯煲中加牛油，放入煙肉碎同蘑菇片，按煮飯掣炒香（約3分鐘）。",
      "duration": 3
    },
    {
      "instruction": "加入米、水、淡忌廉同鹽拌勻，蓋上蓋繼續煮（約15分鐘），中途開蓋攪拌一次防止黏底。",
      "duration": 15
    },
    {
      "instruction": "煮好後撒入芝士粉，拌勻即可食用。",
      "duration": 4
    }
  ],
  "tags": [
    "30 分鐘內",
    "簡單",
    "快手",
    "電飯煲料理",
    "西餐"
  ]
},
{
  "name": "電飯煲韓式春川辣炒雞拉麵",
  "description": "春川辣炒雞排嘅拉麵一煲過版本！年糕糯口、雞肉嫩滑、拉麵在電飯煲中吸滿甜辣醬汁，做法極簡。",
  "cookTime": 20,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "韓式",
  "ingredients": [
    {
      "name": "即食麵",
      "quantity": "1",
      "unit": "包",
      "category": "麵類"
    },
    {
      "name": "雞髀肉",
      "quantity": "150",
      "unit": "克",
      "category": "肉類"
    },
    {
      "name": "椰菜",
      "quantity": "80",
      "unit": "克",
      "category": "蔬菜"
    },
    {
      "name": "韓式年糕",
      "quantity": "50",
      "unit": "克",
      "category": "其他"
    },
    {
      "name": "韓式辣醬",
      "quantity": "1.5",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "芝麻油",
      "quantity": "1",
      "unit": "茶匙",
      "category": "調味料"
    },
    {
      "name": "水",
      "quantity": "250",
      "unit": "毫升",
      "category": "其他"
    }
  ],
  "steps": [
    {
      "instruction": "雞髀肉切小丁；椰菜切碎塊。",
      "duration": 4
    },
    {
      "instruction": "電飯煲中加芝麻油、水和韓式辣醬拌勻，放入雞丁、年糕同椰菜，蓋上蓋煮滾（約5分鐘）。",
      "duration": 5
    },
    {
      "instruction": "放入即食麵（折成兩段易吸汁），攪拌均勻蓋上蓋繼續煮5-8分鐘至麵條熟透且湯汁濃稠即可。",
      "duration": 8
    },
    {
      "instruction": "出鍋前可撒上少許芝士或蔥花。",
      "duration": 3
    }
  ],
  "tags": [
    "30 分鐘內",
    "簡單",
    "快手",
    "電飯煲料理",
    "韓式",
    "酸辣"
  ]
},
{
  "name": "電飯煲廣東經典滑蛋牛肉粥",
  "description": "15分鐘極速滾粥。剩飯快速滾出綿滑粥底，滑入醃好嘅鮮牛肉片同蛋花，牛肉極其滑嫩。",
  "cookTime": 15,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "熟米飯",
      "quantity": "200",
      "unit": "克",
      "category": "麵類"
    },
    {
      "name": "牛肉片",
      "quantity": "120",
      "unit": "克",
      "category": "肉類"
    },
    {
      "name": "雞蛋",
      "quantity": "1",
      "unit": "隻",
      "category": "其他"
    },
    {
      "name": "薑絲",
      "quantity": "5",
      "unit": "克",
      "category": "調味料"
    },
    {
      "name": "蔥花",
      "quantity": "適量",
      "unit": "",
      "category": "蔬菜"
    },
    {
      "name": "清雞湯",
      "quantity": "600",
      "unit": "毫升",
      "category": "調味料"
    },
    {
      "name": "生抽",
      "quantity": "1",
      "unit": "茶匙",
      "category": "調味料"
    },
    {
      "name": "生粉",
      "quantity": "1",
      "unit": "茶匙",
      "category": "調味料"
    }
  ],
  "steps": [
    {
      "instruction": "牛肉片加生抽、生粉醃10分鐘；雞蛋打散成蛋液。",
      "duration": 5
    },
    {
      "instruction": "電飯煲中加入熟米飯同清雞湯、薑絲，按下煮飯掣煮滾，保持沸騰約8分鐘至米飯開花綿軟。",
      "duration": 8
    },
    {
      "instruction": "下牛肉片快速攪散，煮1-2分鐘至變色熟透。",
      "duration": 2
    },
    {
      "instruction": "關掉煮飯掣，趁熱淋入蛋液攪成蛋花，撒上蔥花同麻油即可出鍋。",
      "duration": 0
    }
  ],
  "tags": [
    "15 分鐘內",
    "快手",
    "簡單",
    "電飯煲料理",
    "鮮味",
    "家常"
  ]
},
{
  "name": "電飯煲南洋風味椰漿雞肉飯",
  "description": "馬來西亞椰漿飯 (Nasi Lemak) 嘅一煲過版本！米飯加入椰漿和香茅煲熟，雞髀肉鋪在上面同蒸，雞肉滑嫩、飯粒充滿椰香。",
  "cookTime": 30,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "東南亞",
  "ingredients": [
    {
      "name": "米",
      "quantity": "2",
      "unit": "杯",
      "category": "麵類"
    },
    {
      "name": "雞髀肉",
      "quantity": "2",
      "unit": "塊",
      "category": "肉類"
    },
    {
      "name": "椰漿",
      "quantity": "100",
      "unit": "毫升",
      "category": "調味料"
    },
    {
      "name": "水",
      "quantity": "250",
      "unit": "毫升",
      "category": "其他"
    },
    {
      "name": "香茅",
      "quantity": "1",
      "unit": "條",
      "category": "蔬菜"
    },
    {
      "name": "薑片",
      "quantity": "3",
      "unit": "片",
      "category": "調味料"
    },
    {
      "name": "鹽",
      "quantity": "0.5",
      "unit": "茶匙",
      "category": "調味料"
    }
  ],
  "steps": [
    {
      "instruction": "雞髀肉用少許鹽抹勻醃10分鐘；香茅拍扁。",
      "duration": 5
    },
    {
      "instruction": "米洗淨放入電飯煲，加入椰漿、水、鹽、薑片同香茅，稍微拌勻。",
      "duration": 3
    },
    {
      "instruction": "將雞髀肉鋪在米飯表面，按下普通煮飯掣。",
      "duration": 20
    },
    {
      "instruction": "煮好後再保溫燜10分鐘，開蓋拌勻，雞肉切塊即可食用。",
      "duration": 2
    }
  ],
  "tags": [
    "30 分鐘內",
    "簡單",
    "快手",
    "電飯煲料理"
  ]
},
{
  "name": "大牌檔風味薑蔥炒牛肉",
  "description": "大牌檔究極鑊氣小炒！用大火快速爆香薑片、蔥段同手切牛肉片，牛肉滑嫩香濃，15分鐘內完成。",
  "cookTime": 12,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "牛肉片",
      "quantity": "200",
      "unit": "克",
      "category": "肉類"
    },
    {
      "name": "蔥",
      "quantity": "3",
      "unit": "條",
      "category": "蔬菜"
    },
    {
      "name": "薑",
      "quantity": "15",
      "unit": "克",
      "category": "調味料"
    },
    {
      "name": "蒜頭",
      "quantity": "2",
      "unit": "瓣",
      "category": "調味料"
    },
    {
      "name": "生抽",
      "quantity": "1",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "蠔油",
      "quantity": "1",
      "unit": "茶匙",
      "category": "調味料"
    },
    {
      "name": "紹興酒",
      "quantity": "1",
      "unit": "茶匙",
      "category": "調味料"
    },
    {
      "name": "生粉",
      "quantity": "1",
      "unit": "茶匙",
      "category": "調味料"
    }
  ],
  "steps": [
    {
      "instruction": "牛肉片加半湯匙生抽同生粉醃5分鐘；薑切片；蔥切段；蒜頭切片。",
      "duration": 4
    },
    {
      "instruction": "大火燒熱鑊下油，爆香薑片、蒜片同蔥白段。",
      "duration": 2
    },
    {
      "instruction": "下牛肉片快速大火翻炒至七成熟，沿鑊邊灒入紹興酒。",
      "duration": 3
    },
    {
      "instruction": "加入蔥綠段、生抽、蠔油快速炒勻即可上碟。",
      "duration": 3
    }
  ],
  "tags": [
    "15 分鐘內",
    "快手",
    "簡單",
    "家常",
    "下飯"
  ]
},
{
  "name": "蝦仁豆腐蒸水蛋",
  "description": "滑嫩無比嘅極速蒸餸。水豆腐、鮮蝦仁配滑蛋一齊蒸 8 分鐘，淋上少許熟油同生抽，營養豐富，老少皆宜。",
  "cookTime": 15,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "鮮蝦仁",
      "quantity": "100",
      "unit": "克",
      "category": "海鮮"
    },
    {
      "name": "嫩豆腐",
      "quantity": "0.5",
      "unit": "盒",
      "category": "其他"
    },
    {
      "name": "雞蛋",
      "quantity": "2",
      "unit": "隻",
      "category": "其他"
    },
    {
      "name": "溫水",
      "quantity": "200",
      "unit": "毫升",
      "category": "其他"
    },
    {
      "name": "生抽",
      "quantity": "1",
      "unit": "茶匙",
      "category": "調味料"
    },
    {
      "name": "熟油",
      "quantity": "1",
      "unit": "茶匙",
      "category": "調味料"
    }
  ],
  "steps": [
    {
      "instruction": "豆腐切小方塊平鋪在碟底；蝦仁用少許鹽醃5分鐘；雞蛋加溫水、少許鹽打散，過篩濾入放豆腐嘅碟中。",
      "duration": 5
    },
    {
      "instruction": "水滾後將碟放入蒸架，蓋上蓋中火蒸6分鐘至蛋液微凝固。",
      "duration": 6
    },
    {
      "instruction": "開蓋將蝦仁鋪在蛋面，蓋上蓋繼續蒸3分鐘至蝦仁熟透。",
      "duration": 3
    },
    {
      "instruction": "出鑊後淋上生抽、熟油，撒上少許蔥花即成。",
      "duration": 1
    }
  ],
  "tags": [
    "15 分鐘內",
    "快手",
    "簡單",
    "鮮味",
    "家常"
  ]
},
{
  "name": "蒜蓉豆豉蒸雞髀肉",
  "description": "超惹味下飯神餸。滑嫩嘅雞髀肉加上香濃嘅蒜蓉、豆豉同醬油一齊隔水蒸 12 分鐘，肉汁鮮美，極速方便。",
  "cookTime": 15,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "雞髀肉",
      "quantity": "250",
      "unit": "克",
      "category": "肉類"
    },
    {
      "name": "豆豉",
      "quantity": "1",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "蒜蓉",
      "quantity": "1",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "生抽",
      "quantity": "1",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "生粉",
      "quantity": "1",
      "unit": "茶匙",
      "category": "調味料"
    },
    {
      "name": "糖",
      "quantity": "0.5",
      "unit": "茶匙",
      "category": "調味料"
    },
    {
      "name": "食油",
      "quantity": "1",
      "unit": "茶匙",
      "category": "調味料"
    }
  ],
  "steps": [
    {
      "instruction": "雞髀肉切一口大小，用生抽、生粉、糖同少許油拌勻醃10分鐘。",
      "duration": 5
    },
    {
      "instruction": "將蒜蓉同豆豉切碎混合，鋪在醃好嘅雞肉上面拌勻，平鋪在碟中。",
      "duration": 2
    },
    {
      "instruction": "水滾後放入蒸架，蓋上蓋大火隔水蒸12-15分鐘至雞肉熟透即可。",
      "duration": 8
    }
  ],
  "tags": [
    "15 分鐘內",
    "快手",
    "簡單",
    "家常",
    "下飯"
  ]
},
{
  "name": "經典港式生炒牛肉飯",
  "description": "茶餐廳經典。用賸飯、免治牛肉、雞蛋同生菜絲快速翻炒，牛肉香濃、飯粒乾身，係都市人極速解決一餐嘅完美方案。",
  "cookTime": 12,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "熟米飯",
      "quantity": "250",
      "unit": "克",
      "category": "麵類"
    },
    {
      "name": "免治牛肉",
      "quantity": "100",
      "unit": "克",
      "category": "肉類"
    },
    {
      "name": "雞蛋",
      "quantity": "1",
      "unit": "隻",
      "category": "其他"
    },
    {
      "name": "生菜",
      "quantity": "20",
      "unit": "克",
      "category": "蔬菜"
    },
    {
      "name": "生抽",
      "quantity": "1",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "老抽",
      "quantity": "1",
      "unit": "茶匙",
      "category": "調味料"
    },
    {
      "name": "食油",
      "quantity": "2",
      "unit": "湯匙",
      "category": "調味料"
    }
  ],
  "steps": [
    {
      "instruction": "生菜洗淨切細絲；免治牛肉用少許生抽醃5分鐘；雞蛋打散。",
      "duration": 4
    },
    {
      "instruction": "大火熱鑊落油，倒入蛋液快速炒散，盛起備用。",
      "duration": 2
    },
    {
      "instruction": "同一鑊落少許油，爆香免治牛肉炒至變色，盛起備用。",
      "duration": 2
    },
    {
      "instruction": "倒入熟米飯翻炒至粒粒分明，倒回炒蛋同牛肉，加生抽和老抽炒勻上色，最後下生菜絲快速翻炒10秒即可出鑊。",
      "duration": 4
    }
  ],
  "tags": [
    "15 分鐘內",
    "快手",
    "簡單",
    "家常",
    "下飯"
  ]
},
{
  "name": "電飯煲日式蒲燒鰻魚滑蛋飯",
  "description": "用賸飯/熟米，電飯煲加少許昆布汁、洋蔥絲，鋪上蒲燒鰻魚片同打散嘅蛋液，15分鐘極速做出美味鰻魚飯。",
  "cookTime": 15,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "日式",
  "ingredients": [
    {
      "name": "熟米飯",
      "quantity": "250",
      "unit": "克",
      "category": "麵類"
    },
    {
      "name": "蒲燒鰻魚",
      "quantity": "1",
      "unit": "條",
      "category": "海鮮"
    },
    {
      "name": "洋蔥",
      "quantity": "0.5",
      "unit": "個",
      "category": "蔬菜"
    },
    {
      "name": "雞蛋",
      "quantity": "2",
      "unit": "隻",
      "category": "其他"
    },
    {
      "name": "日式生抽",
      "quantity": "1",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "味醂",
      "quantity": "1",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "水",
      "quantity": "50",
      "unit": "毫升",
      "category": "其他"
    }
  ],
  "steps": [
    {
      "instruction": "洋蔥切絲；鰻魚切塊；雞蛋打散成粗略蛋液（唔使太均勻）。",
      "duration": 3
    },
    {
      "instruction": "電飯煲中鋪上洋蔥絲，加入日式生抽、味醂同水，按煮飯掣煮5分鐘至洋蔥變軟。",
      "duration": 5
    },
    {
      "instruction": "平鋪上熟米飯同鰻魚塊，沿邊淋入蛋液，蓋上蓋保溫燜煮7-10分鐘至蛋液呈半熟滑蛋狀即可。",
      "duration": 7
    }
  ],
  "tags": [
    "15 分鐘內",
    "快手",
    "簡單",
    "電飯煲料理",
    "和風"
  ]
},
{
  "name": "電飯煲豉油皇肥牛煲仔飯",
  "description": "懶人版肥牛煲仔飯！米飯鋪上肥牛片同薑絲燜熟，最後淋上甜豉油，牛肉軟滑，米飯吸滿牛肉油脂香氣。",
  "cookTime": 30,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "米",
      "quantity": "2",
      "unit": "杯",
      "category": "麵類"
    },
    {
      "name": "肥牛肉片",
      "quantity": "150",
      "unit": "克",
      "category": "肉類"
    },
    {
      "name": "薑絲",
      "quantity": "5",
      "unit": "克",
      "category": "調味料"
    },
    {
      "name": "生抽",
      "quantity": "2",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "老抽",
      "quantity": "1",
      "unit": "茶匙",
      "category": "調味料"
    },
    {
      "name": "糖",
      "quantity": "1",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "蔥花",
      "quantity": "適量",
      "unit": "",
      "category": "蔬菜"
    }
  ],
  "steps": [
    {
      "instruction": "肥牛片切小段；薑切絲。將生抽、老抽、糖調成甜豉油醬汁。",
      "duration": 5
    },
    {
      "instruction": "米洗淨放入電飯煲，加適量水按普通煮飯掣。",
      "duration": 3
    },
    {
      "instruction": "煮飯至跳掣前約10分鐘（或開蓋見米飯表面水分剛吸乾），鋪上肥牛片同薑絲，蓋上煲蓋至跳掣。",
      "duration": 15
    },
    {
      "instruction": "煮好後燜7分鐘，淋上甜豉油醬汁，撒上蔥花拌勻即成。",
      "duration": 7
    }
  ],
  "tags": [
    "30 分鐘內",
    "簡單",
    "快手",
    "電飯煲料理",
    "家常",
    "下飯"
  ]
},
{
  "name": "電飯煲日式咖喱雞肉燉飯",
  "description": "一煲過咖喱飯！雞肉、甘筍、薯仔、洋蔥與米飯，加入日式咖喱磚一齊燜煮。出鍋時咖喱極濃郁，雞肉軟爛。",
  "cookTime": 30,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "日式",
  "ingredients": [
    {
      "name": "米",
      "quantity": "2",
      "unit": "杯",
      "category": "麵類"
    },
    {
      "name": "雞髀肉",
      "quantity": "200",
      "unit": "克",
      "category": "肉類"
    },
    {
      "name": "薯仔",
      "quantity": "1",
      "unit": "個",
      "category": "蔬菜"
    },
    {
      "name": "甘筍",
      "quantity": "0.5",
      "unit": "條",
      "category": "蔬菜"
    },
    {
      "name": "洋蔥",
      "quantity": "0.5",
      "unit": "個",
      "category": "蔬菜"
    },
    {
      "name": "日式咖喱塊",
      "quantity": "2",
      "unit": "塊",
      "category": "調味料"
    }
  ],
  "steps": [
    {
      "instruction": "雞肉、薯仔、甘筍、洋蔥全部切一口大小丁。",
      "duration": 5
    },
    {
      "instruction": "米洗淨放入電飯煲，加入薯仔、甘筍、洋蔥同雞丁，加水平時煮飯水量，放上咖喱塊。",
      "duration": 5
    },
    {
      "instruction": "按下普通煮飯掣煮飯。中途（約15分鐘後，電飯煲水滾時）開蓋，用筷子或勺子將融化嘅咖喱塊攪拌均勻，蓋上煲蓋繼續完成程序。",
      "duration": 15
    },
    {
      "instruction": "煮好後燜5分鐘，攪拌勻即可享用。",
      "duration": 5
    }
  ],
  "tags": [
    "30 分鐘內",
    "簡單",
    "快手",
    "電飯煲料理",
    "和風"
  ]
},
{
  "name": "電飯煲台式香菇油飯",
  "description": "經典台灣風味。糯米與白米混合，鋪上爆香嘅香菇絲、蝦米、豬肉絲、紅蔥頭酥一齊燜熟，糯口咸香。",
  "cookTime": 30,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "糯米",
      "quantity": "1.5",
      "unit": "杯",
      "category": "麵類"
    },
    {
      "name": "米",
      "quantity": "0.5",
      "unit": "杯",
      "category": "麵類"
    },
    {
      "name": "鮮香菇",
      "quantity": "4",
      "unit": "朵",
      "category": "蔬菜"
    },
    {
      "name": "蝦米",
      "quantity": "15",
      "unit": "克",
      "category": "海鮮"
    },
    {
      "name": "豬肉片",
      "quantity": "80",
      "unit": "克",
      "category": "肉類"
    },
    {
      "name": "紅蔥頭酥",
      "quantity": "1",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "生抽",
      "quantity": "2",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "麻油",
      "quantity": "1",
      "unit": "湯匙",
      "category": "調味料"
    }
  ],
  "steps": [
    {
      "instruction": "糯米同白米混合洗淨（混合更易熟且口感Q彈）；香菇、豬肉切細絲；蝦米浸軟。",
      "duration": 6
    },
    {
      "instruction": "熱鑊落油（用麻油），爆香蝦米、香菇同豬肉絲，倒入生抽炒香（不用炒熟）。",
      "duration": 4
    },
    {
      "instruction": "米放入電飯煲，加水平時煮飯水量略少，加入炒好嘅料、汁同紅蔥頭酥拌勻。",
      "duration": 3
    },
    {
      "instruction": "按下煮飯掣。煮好後再保溫燜10分鐘，開蓋拌勻即可。",
      "duration": 17
    }
  ],
  "tags": [
    "30 分鐘內",
    "簡單",
    "快手",
    "電飯煲料理",
    "家常"
  ]
},
{
  "name": "避風塘炒蝦仁",
  "description": "用超市買到嘅避風塘炸蒜酥、麵包糠，大火快速翻炒鮮蝦仁。香辣、香脆、避風塘風味十足，做法極簡。",
  "cookTime": 12,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "鮮蝦仁",
      "quantity": "200",
      "unit": "克",
      "category": "海鮮"
    },
    {
      "name": "避風塘蒜酥",
      "quantity": "3",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "麵包糠",
      "quantity": "2",
      "unit": "湯匙",
      "category": "其他"
    },
    {
      "name": "辣椒丁",
      "quantity": "1",
      "unit": "茶匙",
      "category": "調味料"
    },
    {
      "name": "生粉",
      "quantity": "1",
      "unit": "茶匙",
      "category": "調味料"
    },
    {
      "name": "生抽",
      "quantity": "1",
      "unit": "茶匙",
      "category": "調味料"
    }
  ],
  "steps": [
    {
      "instruction": "蝦仁洗淨瀝乾，用生抽、生粉醃5分鐘。",
      "duration": 4
    },
    {
      "instruction": "大火熱鑊落油，下蝦仁快速翻炒至八成熟（表面金黃），盛起備用。",
      "duration": 3
    },
    {
      "instruction": "同一個鑊轉中小火，落少許油，炒香辣椒丁同麵包糠至香脆，下蒜酥炒勻。",
      "duration": 3
    },
    {
      "instruction": "倒回蝦仁，大火快速翻炒勻即可起鑊上碟。",
      "duration": 2
    }
  ],
  "tags": [
    "15 分鐘內",
    "快手",
    "簡單",
    "鮮味",
    "香辣"
  ]
},
{
  "name": "泰式酸辣無骨雞爪",
  "description": "都市人最愛宵夜冷盤！無骨雞爪、洋蔥絲、芫荽，拌入檸檬汁、魚汁、泰國椒、糖，即拌即食，酸辣開胃。",
  "cookTime": 15,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "東南亞",
  "ingredients": [
    {
      "name": "無骨雞爪",
      "quantity": "200",
      "unit": "克",
      "category": "肉類"
    },
    {
      "name": "洋蔥",
      "quantity": "0.5",
      "unit": "個",
      "category": "蔬菜"
    },
    {
      "name": "芫荽",
      "quantity": "1",
      "unit": "棵",
      "category": "蔬菜"
    },
    {
      "name": "檸檬汁",
      "quantity": "2",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "魚露",
      "quantity": "1.5",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "糖",
      "quantity": "1",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "泰國小辣椒",
      "quantity": "1",
      "unit": "條",
      "category": "調味料"
    }
  ],
  "steps": [
    {
      "instruction": "無骨雞爪汆水煮熟（約5分鐘），撈出浸冰水瀝乾；洋蔥切絲；芫荽切小段；辣椒切圈。",
      "duration": 8
    },
    {
      "instruction": "將檸檬汁、魚露、糖、泰國椒混合均勻調成酸辣醬汁。",
      "duration": 3
    },
    {
      "instruction": "將雞爪、洋蔥絲、芫荽段放入大碗，淋入醬汁，攪拌均勻入味即可享用（放入雪櫃冰鎮後風味更佳）。",
      "duration": 4
    }
  ],
  "tags": [
    "15 分鐘內",
    "快手",
    "簡單",
    "開胃",
    "酸辣"
  ]
},
{
  "name": "日式茶碗蒸",
  "description": "經典日式茶杯蒸蛋 (Chawanmushi)，蛋羹嫩滑如布丁、入口即化，帶有鮮甜昆布湯香，係一道健康、低脂、高蛋白嘅美味小食。",
  "cookTime": 15,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "日式",
  "ingredients": [
    {
      "name": "雞蛋",
      "quantity": "2",
      "unit": "隻",
      "category": "其他"
    },
    {
      "name": "鮮蝦仁",
      "quantity": "2",
      "unit": "隻",
      "category": "海鮮"
    },
    {
      "name": "雞胸肉丁",
      "quantity": "20",
      "unit": "克",
      "category": "肉類"
    },
    {
      "name": "鮮香菇",
      "quantity": "1",
      "unit": "朵",
      "category": "蔬菜"
    },
    {
      "name": "魚板",
      "quantity": "2",
      "unit": "片",
      "category": "其他"
    },
    {
      "name": "日式醬油",
      "quantity": "1",
      "unit": "茶匙",
      "category": "調味料"
    },
    {
      "name": "味醂",
      "quantity": "0.5",
      "unit": "茶匙",
      "category": "調味料"
    },
    {
      "name": "昆布高湯",
      "quantity": "240",
      "unit": "毫升",
      "category": "其他"
    },
    {
      "name": "蔥花",
      "quantity": "適量",
      "unit": "",
      "category": "蔬菜"
    }
  ],
  "steps": [
    {
      "instruction": "雞胸肉丁加少許生抽醃製；蝦仁洗淨瀝乾；香菇切薄片。",
      "duration": 3
    },
    {
      "instruction": "雞蛋打散，加入昆布高湯、日式生抽和味醂（比例約1:2），攪拌均勻，然後用篩過濾蛋液2次濾走氣泡。",
      "duration": 4
    },
    {
      "instruction": "茶碗底部放入雞肉丁同香菇片，輕輕倒入過篩後嘅蛋液至八分滿，蓋上錫紙或保鮮膜（防止倒汗水）。",
      "duration": 3
    },
    {
      "instruction": "放入滾水蒸鍋（或電飯煲蒸籠），蓋上蓋大火蒸10分鐘至表面凝固。",
      "duration": 10
    },
    {
      "instruction": "開蓋，在蛋液表面輕輕放上鮮蝦仁同魚板片，重新蓋蓋繼續蒸3-4分鐘至蝦仁熟透，出鑊撒上少許蔥花即成。",
      "duration": 4
    }
  ],
  "tags": [
    "15 分鐘內",
    "簡單",
    "快手",
    "電飯煲料理",
    "和風",
    "健康"
  ]
},
{
  "name": "豉油雞翼",
  "description": "經典廣東家常菜，做法極其簡單。雞翼吸收咗豉油同冰糖嘅鹹香甜味，滑嫩多汁，係大人細路都鍾意嘅下飯神餸。",
  "cookTime": 15,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "雞翼",
      "quantity": "8",
      "unit": "隻",
      "category": "肉類"
    },
    {
      "name": "生抽",
      "quantity": "100",
      "unit": "毫升",
      "category": "調味料"
    },
    {
      "name": "老抽",
      "quantity": "2",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "冰糖",
      "quantity": "30",
      "unit": "克",
      "category": "調味料"
    },
    {
      "name": "薑片",
      "quantity": "4",
      "unit": "片",
      "category": "調味料"
    },
    {
      "name": "蔥段",
      "quantity": "2",
      "unit": "條",
      "category": "蔬菜"
    },
    {
      "name": "八角",
      "quantity": "1",
      "unit": "粒",
      "category": "調味料"
    },
    {
      "name": "水",
      "quantity": "150",
      "unit": "毫升",
      "category": "其他"
    }
  ],
  "steps": [
    {
      "instruction": "雞翼洗淨抹乾；薑切片，蔥切段。",
      "duration": 3
    },
    {
      "instruction": "鍋中倒入生抽、老抽、水、冰糖、薑片、蔥段同八角，大火煮滾調成豉油汁。",
      "duration": 3
    },
    {
      "instruction": "放入雞翼，大火煮滾後轉小火，蓋上鍋蓋煮10分鐘。",
      "duration": 10
    },
    {
      "instruction": "熄火，蓋住蓋再燜5分鐘，等雞翼完全入味，撈出裝碟即可享用。",
      "duration": 4
    }
  ],
  "tags": [
    "15 分鐘內",
    "簡單",
    "快手",
    "家常",
    "下飯",
    "經典",
    "小朋友"
  ]
},
{
  "name": "焗蜜糖雞翼",
  "description": "外皮微焦金黃、肉質軟嫩、帶有蜜糖香甜嘅焗雞翼！用焗爐或氣炸鍋20分鐘即可搞定，做法極速方便。",
  "cookTime": 25,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "雞翼",
      "quantity": "8",
      "unit": "隻",
      "category": "肉類"
    },
    {
      "name": "蜜糖",
      "quantity": "2",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "生抽",
      "quantity": "1.5",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "蠔油",
      "quantity": "1",
      "unit": "茶匙",
      "category": "調味料"
    },
    {
      "name": "蒜蓉",
      "quantity": "1",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "紹興酒",
      "quantity": "1",
      "unit": "茶匙",
      "category": "調味料"
    },
    {
      "name": "黑胡椒",
      "quantity": "適量",
      "unit": "",
      "category": "調味料"
    }
  ],
  "steps": [
    {
      "instruction": "雞翼洗淨抹乾，用刀在背面劃兩刀便於入味。",
      "duration": 3
    },
    {
      "instruction": "加入生抽、蠔油、蒜蓉、紹興酒同少許黑胡椒，拌勻醃製15分鐘。",
      "duration": 15
    },
    {
      "instruction": "焗爐或氣炸鍋預熱至200°C，將雞翼平鋪在烤網上，烤15分鐘（中途翻面一次）。",
      "duration": 15
    },
    {
      "instruction": "最後2分鐘，在兩面均勻刷上蜜糖，烤至表面呈金黃微焦色即可出爐。",
      "duration": 2
    }
  ],
  "tags": [
    "30 分鐘內",
    "簡單",
    "快手",
    "烤",
    "家常",
    "小朋友",
    "香甜"
  ]
},
{
  "name": "蜜汁焗叉燒",
  "description": "屋企都能做出茶餐廳水準嘅蜜汁叉燒！選用梅頭肉切成薄條，用焗爐或氣炸鍋大火快速烤製，肉質軟嫩多汁、邊緣焦香。",
  "cookTime": 30,
  "servings": 3,
  "difficulty": "簡單",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "梅頭豬肉",
      "quantity": "400",
      "unit": "克",
      "category": "肉類"
    },
    {
      "name": "叉燒醬",
      "quantity": "3",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "生抽",
      "quantity": "1",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "蜜糖",
      "quantity": "2",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "蒜蓉",
      "quantity": "1",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "玫瑰露酒",
      "quantity": "1",
      "unit": "茶匙",
      "category": "調味料"
    }
  ],
  "steps": [
    {
      "instruction": "梅頭豬肉切成厚約3厘米嘅長條狀（切太厚難熟），用叉子在兩面戳孔以便醃製入味。",
      "duration": 5
    },
    {
      "instruction": "肉加叉燒醬、生抽、玫瑰露酒同蒜蓉，用力抓勻醃製15分鐘。",
      "duration": 15
    },
    {
      "instruction": "氣炸鍋或焗爐預熱至200°C，放入豬肉，大火烤15分鐘。",
      "duration": 15
    },
    {
      "instruction": "取出翻面，刷上一層剩餘嘅醃醬，繼續烤10分鐘至邊緣微焦。",
      "duration": 10
    },
    {
      "instruction": "最後3分鐘，在兩面刷上蜜糖，烤至表面呈油亮金黃色，取出稍微放涼後切片裝碟。",
      "duration": 3
    }
  ],
  "tags": [
    "30 分鐘內",
    "簡單",
    "快手",
    "烤",
    "經典",
    "家常",
    "下飯"
  ]
}
];