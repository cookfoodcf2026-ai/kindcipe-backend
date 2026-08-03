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
},
{
  "name": "日式五目炊飯",
  "description": "經典嘅日式五目炊飯 (Gomoku Gohan)！將雞肉、鮮菇、甘筍、油豆腐皮、蒟蒻等五種營養食材同米飯一煲過燜熟，香氣溫馨、營養均衡。",
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
      "name": "雞髀肉丁",
      "quantity": "120",
      "unit": "克",
      "category": "肉類"
    },
    {
      "name": "鮮香菇",
      "quantity": "3",
      "unit": "朵",
      "category": "蔬菜"
    },
    {
      "name": "甘筍",
      "quantity": "50",
      "unit": "克",
      "category": "蔬菜"
    },
    {
      "name": "日式油豆腐皮",
      "quantity": "1",
      "unit": "張",
      "category": "其他"
    },
    {
      "name": "蒟蒻",
      "quantity": "40",
      "unit": "克",
      "category": "其他"
    },
    {
      "name": "日式生抽",
      "quantity": "1.5",
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
      "name": "昆布高湯",
      "quantity": "340",
      "unit": "毫升",
      "category": "其他"
    }
  ],
  "steps": [
    {
      "instruction": "雞髀肉切小丁用少許生抽醃製；香菇、甘筍、油豆腐皮同蒟蒻全部切細絲。",
      "duration": 5
    },
    {
      "instruction": "米洗淨放入電飯煲，加入日式生抽、味醂同昆布高湯，稍微拌勻。",
      "duration": 3
    },
    {
      "instruction": "將雞肉丁、香菇絲、甘筍絲、油豆腐皮絲、蒟蒻絲均勻鋪在米飯表面，按下普通煮飯掣。",
      "duration": 20
    },
    {
      "instruction": "煮好後再保溫燜10分鐘，開蓋用勺子將所有食材同米飯輕輕拌勻即可。",
      "duration": 2
    }
  ],
  "tags": [
    "30 分鐘內",
    "簡單",
    "快手",
    "電飯煲料理",
    "和風",
    "健康"
  ]
},
{
  "name": "雪菜牛肉米粉",
  "description": "茶餐廳經典湯粉！鹹香爽脆嘅雪菜碎爆炒出香氣，加上嫩滑肥牛片，米粉吸滿熱乎乎嘅湯汁，15分鐘極速暖胃。",
  "cookTime": 15,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "米粉",
      "quantity": "150",
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
      "name": "雪菜碎",
      "quantity": "50",
      "unit": "克",
      "category": "蔬菜"
    },
    {
      "name": "薑絲",
      "quantity": "5",
      "unit": "克",
      "category": "調味料"
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
    },
    {
      "name": "糖",
      "quantity": "0.5",
      "unit": "茶匙",
      "category": "調味料"
    },
    {
      "name": "麻油",
      "quantity": "1",
      "unit": "茶匙",
      "category": "調味料"
    }
  ],
  "steps": [
    {
      "instruction": "牛肉片用生抽、生粉醃10分鐘；雪菜洗淨切碎，揸乾水分；米粉用溫水浸軟。",
      "duration": 5
    },
    {
      "instruction": "熱鑊落油爆香薑絲，下雪菜碎同少許糖快速翻炒1分鐘至香氣散發，盛起備用。",
      "duration": 3
    },
    {
      "instruction": "鍋中倒入清雞湯煮滾，放入浸軟嘅米粉煮2分鐘，加入炒香嘅雪菜，滑入牛肉片滾1分鐘至熟透。",
      "duration": 5
    },
    {
      "instruction": "關火淋上麻油，撒上少許蔥花即可一碗端上桌。",
      "duration": 2
    }
  ],
  "tags": [
    "15 分鐘內",
    "簡單",
    "快手",
    "茶餐廳",
    "家常"
  ]
},
{
  "name": "港式沙爹牛肉公仔麵",
  "description": "香港茶餐廳不可動搖嘅王牌早餐！滑嫩牛肉裹滿濃郁、帶微甜微辣與花生香氣嘅港式沙爹醬，配上彈牙嘅即食麵，極致享受。",
  "cookTime": 15,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "即食麵",
      "quantity": "2",
      "unit": "包",
      "category": "麵類"
    },
    {
      "name": "牛肉片",
      "quantity": "150",
      "unit": "克",
      "category": "肉類"
    },
    {
      "name": "沙爹醬",
      "quantity": "2",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "花生醬",
      "quantity": "1",
      "unit": "茶匙",
      "category": "調味料"
    },
    {
      "name": "洋蔥",
      "quantity": "0.5",
      "unit": "個",
      "category": "蔬菜"
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
    },
    {
      "name": "清雞湯",
      "quantity": "600",
      "unit": "毫升",
      "category": "調味料"
    }
  ],
  "steps": [
    {
      "instruction": "牛肉片加生抽、生粉醃10分鐘；洋蔥切絲；沙爹醬與花生醬加2湯匙熱水調開。",
      "duration": 5
    },
    {
      "instruction": "熱鑊落油爆香洋蔥絲，下牛肉片大火快速炒至半熟，倒入調好嘅沙爹花生醬汁，炒勻至醬汁濃稠裹滿牛肉，盛起備用。",
      "duration": 4
    },
    {
      "instruction": "小鍋中倒入清雞湯煮滾，放入即食麵煮3分鐘至彈牙，撈出裝碗，倒入湯汁，最後鋪上沙爹牛肉即成。",
      "duration": 6
    }
  ],
  "tags": [
    "15 分鐘內",
    "簡單",
    "快手",
    "茶餐廳",
    "家常",
    "下飯"
  ]
},
{
  "name": "經典榨菜肉絲米粉",
  "description": "茶餐廳經久不衰嘅人氣王！鹹香脆口嘅即食榨菜絲，與滑嫩豬肉絲下鑊炒香，鋪在熱騰騰嘅清湯米粉上，超級開胃。",
  "cookTime": 15,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "米粉",
      "quantity": "150",
      "unit": "克",
      "category": "麵類"
    },
    {
      "name": "豬肉絲",
      "quantity": "100",
      "unit": "克",
      "category": "肉類"
    },
    {
      "name": "即食榨菜絲",
      "quantity": "60",
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
      "name": "生粉",
      "quantity": "1",
      "unit": "茶匙",
      "category": "調味料"
    },
    {
      "name": "清雞湯",
      "quantity": "600",
      "unit": "毫升",
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
      "instruction": "肉絲加半湯匙生抽同生粉醃10分鐘；米粉用溫水浸軟。",
      "duration": 4
    },
    {
      "instruction": "熱鑊落油，下肉絲大火炒至變色，加入榨菜絲，加半湯匙生抽翻炒2分鐘炒出香味，盛起備用。",
      "duration": 4
    },
    {
      "instruction": "小鍋倒入清雞湯煮滾，放入浸軟嘅米粉煮2-3分鐘至熟，撈出盛在碗中，倒入雞湯。",
      "duration": 5
    },
    {
      "instruction": "鋪上炒香嘅榨菜肉絲，撒上蔥花即成。",
      "duration": 2
    }
  ],
  "tags": [
    "15 分鐘內",
    "簡單",
    "快手",
    "茶餐廳",
    "家常"
  ]
},
{
  "name": "番茄肥牛過橋米線",
  "description": "近年極之流行嘅極速一煲過米線！用鮮番茄慢火炒出酸甜濃郁嘅番茄湯底，下米線同肥牛片，酸甜開胃、暖胃舒心。",
  "cookTime": 15,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "米線",
      "quantity": "150",
      "unit": "克",
      "category": "麵類"
    },
    {
      "name": "肥牛肉片",
      "quantity": "150",
      "unit": "克",
      "category": "肉類"
    },
    {
      "name": "番茄",
      "quantity": "2",
      "unit": "個",
      "category": "蔬菜"
    },
    {
      "name": "金針菇",
      "quantity": "80",
      "unit": "克",
      "category": "蔬菜"
    },
    {
      "name": "生菜",
      "quantity": "2",
      "unit": "片",
      "category": "蔬菜"
    },
    {
      "name": "清雞湯",
      "quantity": "500",
      "unit": "毫升",
      "category": "調味料"
    },
    {
      "name": "鹽",
      "quantity": "適量",
      "unit": "",
      "category": "調味料"
    },
    {
      "name": "食油",
      "quantity": "1",
      "unit": "湯匙",
      "category": "調味料"
    }
  ],
  "steps": [
    {
      "instruction": "番茄去蒂切小丁；金針菇去根掰開；生菜洗淨。",
      "duration": 4
    },
    {
      "instruction": "熱鍋下油，倒入番茄丁大火翻炒，用勺子一邊壓碎，炒3分鐘至番茄出沙、成濃稠醬狀。",
      "duration": 3
    },
    {
      "instruction": "倒入清雞湯，大火煮滾，下米線和金針菇煮3分鐘至入味。",
      "duration": 4
    },
    {
      "instruction": "滑入肥牛片和生菜葉，大火滾30秒至肥牛片變色熟透，加少許鹽調味即可整鍋上桌。",
      "duration": 4
    }
  ],
  "tags": [
    "15 分鐘內",
    "簡單",
    "快手",
    "家常",
    "酸甜"
  ]
},
{
  "name": "花甲蒸水蛋",
  "description": "經典粵式海鮮家常菜！新鮮花甲汆水釋放嘅無敵蜆汁，混合雞蛋液蒸出滑嫩如布丁、鮮甜透骨嘅完美水蛋。",
  "cookTime": 15,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "新鮮花甲",
      "quantity": "200",
      "unit": "克",
      "category": "海鮮"
    },
    {
      "name": "雞蛋",
      "quantity": "2",
      "unit": "隻",
      "category": "其他"
    },
    {
      "name": "蒸魚豉油",
      "quantity": "1",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "熟油",
      "quantity": "1",
      "unit": "茶匙",
      "category": "調味料"
    },
    {
      "name": "蔥花",
      "quantity": "適量",
      "unit": "",
      "category": "蔬菜"
    },
    {
      "name": "溫水",
      "quantity": "200",
      "unit": "毫升",
      "category": "其他"
    }
  ],
  "steps": [
    {
      "instruction": "花甲洗淨吐沙；雞蛋在碗中打散。",
      "duration": 4
    },
    {
      "instruction": "小鍋下少許水煮滾，下花甲燙至剛開口（約1-2分鐘），立刻盛起（燙花甲嘅水過濾留150毫升放涼備用）。",
      "duration": 3
    },
    {
      "instruction": "打散嘅蛋液加入150毫升放涼嘅花甲水和少許鹽攪勻，過篩1次濾去氣泡，倒入蒸碟中，均勻排入開口嘅花甲，碟面蓋上保鮮膜。",
      "duration": 3
    },
    {
      "instruction": "水滾後放入蒸鍋，中火蒸8分鐘至蛋液表面凝固，出鑊撒上蔥花，淋上蒸魚豉油同熟油即可享用。",
      "duration": 5
    }
  ],
  "tags": [
    "15 分鐘內",
    "簡單",
    "快手",
    "鮮味",
    "家常",
    "海鮮"
  ]
},
{
  "name": "經典南乳花生炆豬手",
  "description": "香氣誘人、骨膠原滿滿嘅廣東年菜大碟！豬手皮軟肉糯、鹹香微甜，花生吸飽南乳與肉汁精華，濃郁誘人。",
  "cookTime": 60,
  "servings": 4,
  "difficulty": "簡單",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "豬手",
      "quantity": "600",
      "unit": "克",
      "category": "肉類"
    },
    {
      "name": "生花生",
      "quantity": "80",
      "unit": "克",
      "category": "其他"
    },
    {
      "name": "南乳",
      "quantity": "2",
      "unit": "塊",
      "category": "調味料"
    },
    {
      "name": "柱侯醬",
      "quantity": "1",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "冰糖",
      "quantity": "20",
      "unit": "克",
      "category": "調味料"
    },
    {
      "name": "薑片",
      "quantity": "5",
      "unit": "片",
      "category": "調味料"
    },
    {
      "name": "蒜頭",
      "quantity": "4",
      "unit": "瓣",
      "category": "調味料"
    },
    {
      "name": "紹興酒",
      "quantity": "2",
      "unit": "湯匙",
      "category": "調味料"
    }
  ],
  "steps": [
    {
      "instruction": "生花生提前浸水2小時；豬手切塊冷水下鍋，加2片薑同紹興酒汆水，撈出洗淨瀝乾；南乳加少許水壓碎調勻。",
      "duration": 10
    },
    {
      "instruction": "熱鑊落油爆香薑片、蒜頭，下南乳汁和柱侯醬炒出香味，倒入豬手大火翻炒上色。",
      "duration": 4
    },
    {
      "instruction": "沿鑊邊灒入紹興酒，加入冰糖同浸好嘅花生，倒入熱水沒過豬手，大火煮滾，然後轉小火蓋蓋炆煮50分鐘至豬手皮軟骨爛（中途注意水分，可適量加水）。",
      "duration": 50
    },
    {
      "instruction": "大火收乾湯汁至濃稠，即可上碟食用。",
      "duration": 3
    }
  ],
  "tags": [
    "30 分鐘以上",
    "簡單",
    "家常",
    "下飯",
    "經典"
  ]
},
{
  "name": "支竹冬菇炆牛筋腩",
  "description": "冬天暖身極品！牛腱、牛筋慢火炆至軟糯化口、冬菇香氣逼人，吸盡牛腩汁精華嘅炸支竹比肉本身更具風味。",
  "cookTime": 60,
  "servings": 4,
  "difficulty": "中等",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "牛腩",
      "quantity": "300",
      "unit": "克",
      "category": "肉類"
    },
    {
      "name": "牛筋",
      "quantity": "150",
      "unit": "克",
      "category": "肉類"
    },
    {
      "name": "炸支竹",
      "quantity": "60",
      "unit": "克",
      "category": "其他"
    },
    {
      "name": "鮮冬菇",
      "quantity": "6",
      "unit": "朵",
      "category": "蔬菜"
    },
    {
      "name": "柱侯醬",
      "quantity": "2",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "薑片",
      "quantity": "4",
      "unit": "片",
      "category": "調味料"
    },
    {
      "name": "八角",
      "quantity": "2",
      "unit": "粒",
      "category": "調味料"
    },
    {
      "name": "冰糖",
      "quantity": "15",
      "unit": "克",
      "category": "調味料"
    }
  ],
  "steps": [
    {
      "instruction": "牛筋牛腩切塊飛水撈出；支竹浸軟切段；冬菇去蒂洗淨。",
      "duration": 10
    },
    {
      "instruction": "熱鑊下油爆香薑片，下柱侯醬、八角炒香，倒入牛腩牛筋大火翻炒均勻。",
      "duration": 4
    },
    {
      "instruction": "加冰糖、生抽同足量熱水，煮滾後轉小火蓋蓋炆煮45分鐘（至牛筋腩變軟）。",
      "duration": 45
    },
    {
      "instruction": "下冬菇同支竹段，蓋蓋繼續小火炆15分鐘，最後大火收濃湯汁即可上碟。",
      "duration": 15
    }
  ],
  "tags": [
    "30 分鐘以上",
    "中等",
    "家常",
    "下飯",
    "經典"
  ]
},
{
  "name": "台式滷肉飯",
  "description": "手切五花肉丁爆香，加五香粉、生抽、冰糖和油蔥酥，連同雞蛋一齊放電飯煲一齊燜，肉爛汁濃，淋飯一流！",
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
      "name": "五花肉",
      "quantity": "200",
      "unit": "克",
      "category": "肉類"
    },
    {
      "name": "紅蔥頭酥",
      "quantity": "3",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "雞蛋",
      "quantity": "2",
      "unit": "隻",
      "category": "其他"
    },
    {
      "name": "五香粉",
      "quantity": "0.5",
      "unit": "茶匙",
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
      "name": "冰糖",
      "quantity": "15",
      "unit": "克",
      "category": "調味料"
    }
  ],
  "steps": [
    {
      "instruction": "五花肉切成0.5厘米嘅小丁；雞蛋煮熟去殼。",
      "duration": 5
    },
    {
      "instruction": "熱鑊落少許油，下五花肉丁煸炒至微焦出油，加入生抽、老抽、五香粉和冰糖炒勻上色。",
      "duration": 4
    },
    {
      "instruction": "米洗淨放入電飯煲加平時煮飯水量，倒入炒好嘅五花肉丁同汁，加入去殼熟雞蛋同紅蔥頭酥拌勻，按下煮飯掣。",
      "duration": 18
    },
    {
      "instruction": "煮好後再保溫燜10分鐘，開蓋將滷肉、滷蛋（切半）連同香濃滷汁一齊澆在白飯上即可享用。",
      "duration": 3
    }
  ],
  "tags": [
    "30 分鐘內",
    "簡單",
    "快手",
    "電飯煲料理",
    "下飯"
  ]
},
{
  "name": "蒜泥白肉",
  "description": "四川經典冷盤極速版！利用超薄嘅火鍋五花肉片，30秒汆熟，肉質極其滑嫩，搭配清爽青瓜片和香辣蒜泥醬，清爽開胃。",
  "cookTime": 12,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "火鍋五花肉片",
      "quantity": "150",
      "unit": "克",
      "category": "肉類"
    },
    {
      "name": "青瓜",
      "quantity": "1",
      "unit": "條",
      "category": "蔬菜"
    },
    {
      "name": "大蒜",
      "quantity": "6",
      "unit": "瓣",
      "category": "調味料"
    },
    {
      "name": "生抽",
      "quantity": "2",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "香醋",
      "quantity": "1",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "糖",
      "quantity": "1",
      "unit": "茶匙",
      "category": "調味料"
    },
    {
      "name": "辣椒油",
      "quantity": "1.5",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "花椒粉",
      "quantity": "少許",
      "unit": "",
      "category": "調味料"
    }
  ],
  "steps": [
    {
      "instruction": "大蒜剁成極細嘅蒜泥；青瓜用削皮刀刨成薄長片，鋪在碟底。",
      "duration": 4
    },
    {
      "instruction": "將生抽、香醋、糖、辣椒油、花椒粉同大量蒜泥在碗中攪拌均勻，調成「特製蒜泥辣椒醬汁」。",
      "duration": 3
    },
    {
      "instruction": "小鍋加水、薑片煮滾，下火鍋五花肉片汆水煮熟（約30秒至1分鐘變色即可），撈出瀝乾，碼在青瓜片上面。",
      "duration": 3
    },
    {
      "instruction": "均勻淋上調好嘅醬汁，撒上少許熟白芝麻和蔥花即成。",
      "duration": 2
    }
  ],
  "tags": [
    "15 分鐘內",
    "快手",
    "簡單",
    "冷盤",
    "開胃",
    "家常",
    "高蛋白"
  ]
},
{
  "name": "清蒸白切鮮魷",
  "description": "廣東人食海鮮嘅至愛。新鮮魷魚切花刀，大火精準蒸4分鐘，完美封鎖爽脆同甘甜，淋上熱油同薑蔥豉油，無敵鮮美。",
  "cookTime": 12,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "新鮮魷魚",
      "quantity": "300",
      "unit": "克",
      "category": "海鮮"
    },
    {
      "name": "薑",
      "quantity": "15",
      "unit": "克",
      "category": "調味料"
    },
    {
      "name": "蔥",
      "quantity": "3",
      "unit": "條",
      "category": "蔬菜"
    },
    {
      "name": "蒸魚豉油",
      "quantity": "2",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "食油",
      "quantity": "1.5",
      "unit": "湯匙",
      "category": "調味料"
    }
  ],
  "steps": [
    {
      "instruction": "鮮魷魚去內臟和外皮洗淨，切花刀或切圈；薑蔥切極細嘅絲。",
      "duration": 5
    },
    {
      "instruction": "將鮮魷魚平鋪在盤中，上面鋪少許薑絲，水滾後入蒸鍋，大火快火蒸4分鐘（切勿蒸久，會變硬！），倒去碟中多餘水分。",
      "duration": 4
    },
    {
      "instruction": "鋪上大量蔥絲和薑絲，燒熱食油至冒煙，淋在蔥薑絲上激發香氣，最後淋上蒸魚豉油即成。",
      "duration": 3
    }
  ],
  "tags": [
    "15 分鐘內",
    "快手",
    "簡單",
    "鮮味",
    "家常",
    "海鮮"
  ]
},
{
  "name": "生煎土魷肉餅",
  "description": "傳統土魷肉餅嘅煎香升級版！手剁肉餅拌入香濃煙韌嘅土魷粒（乾魷魚），下鑊慢火雙面生煎，外皮金黃焦香，肉汁飽滿。",
  "cookTime": 15,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "免治豬肉",
      "quantity": "250",
      "unit": "克",
      "category": "肉類"
    },
    {
      "name": "土魷乾",
      "quantity": "0.5",
      "unit": "隻",
      "category": "乾貨"
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
      "name": "砂糖",
      "quantity": "0.5",
      "unit": "茶匙",
      "category": "調味料"
    },
    {
      "name": "薑蓉",
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
      "instruction": "土魷乾溫水浸軟去膜，切成細小丁（土魷粒）；豬肉加生抽、生粉、糖、薑蓉同土魷粒拌勻，向一個方向攪拌至起膠醃10分鐘。",
      "duration": 5
    },
    {
      "instruction": "將肉泥分成圓餅狀（約1.5cm厚）。",
      "duration": 2
    },
    {
      "instruction": "熱鑊下油，中小火下肉餅煎至一面微黃（約3分鐘），翻面，蓋上鑊蓋，利用內部蒸氣焗熟肉餅（約4分鐘）。",
      "duration": 5
    },
    {
      "instruction": "最後開蓋，大火將兩面各煎30秒至外皮金黃香脆即可起鑊。",
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
  "name": "無水雞肉椰菜煲",
  "description": "極受歡迎、極其健康嘅20分鐘一煲熟料理！用半棵椰菜切大塊墊底（完全唔加一滴水），鋪上醃好嘅雞髀肉。利用蔬菜自身水汽慢火蒸熟雞肉，雞肉嫩滑、椰菜極甜！",
  "cookTime": 20,
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
      "name": "椰菜",
      "quantity": "0.5",
      "unit": "個",
      "category": "蔬菜"
    },
    {
      "name": "蒜頭",
      "quantity": "3",
      "unit": "瓣",
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
      "name": "鹽",
      "quantity": "少許",
      "unit": "",
      "category": "調味料"
    }
  ],
  "steps": [
    {
      "instruction": "雞髀肉切一口大小，用生抽、蠔油、蒜頭片同生粉醃10分鐘；椰菜洗淨，切成大塊；蒜頭切片。",
      "duration": 5
    },
    {
      "instruction": "砂鍋（或普通平底深鍋）底部不落水，平鋪上全部椰菜塊，稍微撒一點點鹽，將醃好嘅雞肉及醬汁平鋪在椰菜上面。",
      "duration": 3
    },
    {
      "instruction": "蓋緊鍋蓋，中火加熱3分鐘（聽見滋滋聲），隨後轉最小火，蓋緊蓋慢火「無水蒸焗」12-15分鐘（椰菜會出大量香甜蔬菜水，絕對唔會黏底）。",
      "duration": 10
    },
    {
      "instruction": "開蓋，大火輕輕翻拌均勻，讓湯汁包裹住雞肉，撒上少許蔥花即成。",
      "duration": 2
    }
  ],
  "tags": [
    "30 分鐘內",
    "簡單",
    "快手",
    "健康",
    "家常"
  ]
},
{
  "name": "港式洋蔥豬扒飯",
  "description": "茶餐廳神級王牌淋飯！帶骨或無骨豬扒用刀背拍鬆，煎至外皮金黃，與大量香甜嘅洋蔥絲慢炒，淋上帶微酸甜嘅豉油皇醬汁，極致美味。",
  "cookTime": 30,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "豬扒",
      "quantity": "2",
      "unit": "塊",
      "category": "肉類"
    },
    {
      "name": "洋蔥",
      "quantity": "1",
      "unit": "個",
      "category": "蔬菜"
    },
    {
      "name": "生抽",
      "quantity": "1.5",
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
      "name": "茄汁",
      "quantity": "1",
      "unit": "茶匙",
      "category": "調味料"
    },
    {
      "name": "水",
      "quantity": "100",
      "unit": "毫升",
      "category": "其他"
    },
    {
      "name": "生粉",
      "quantity": "2",
      "unit": "茶匙",
      "category": "調味料"
    }
  ],
  "steps": [
    {
      "instruction": "豬扒用肉槌或刀背正反拍鬆，切大塊，用1湯匙生抽同1茶匙生粉醃15分鐘；洋蔥切絲。將生抽、老抽、糖、茄汁和水調成洋蔥汁。",
      "duration": 10
    },
    {
      "instruction": "大火熱鑊落油，下豬扒中小火煎至兩面金黃熟透（約每面3分鐘），盛起切條，鋪在熱米飯上。",
      "duration": 6
    },
    {
      "instruction": "同一個鑊加少許油，炒香洋蔥絲至變軟出甜味，倒入洋蔥汁煮開，加入生粉水（1茶匙生粉加水）勾芡煮至濃稠。",
      "duration": 11
    },
    {
      "instruction": "將香濃嘅洋蔥汁連同洋蔥絲均勻淋在豬扒飯上即可享用。",
      "duration": 3
    }
  ],
  "tags": [
    "30 分鐘內",
    "簡單",
    "快手",
    "家常",
    "下飯"
  ]
},
{
  "name": "番茄大蝦意粉",
  "description": "鮮美多汁、酸甜開胃嘅西式大菜！鮮蝦仁在大火中煎出蝦油，與濃郁番茄肉醬同炒，意粉裹滿酸甜多汁嘅番茄醬，做法簡單卻無敵美味。",
  "cookTime": 20,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "西餐",
  "ingredients": [
    {
      "name": "意粉",
      "quantity": "150",
      "unit": "克",
      "category": "麵類"
    },
    {
      "name": "大蝦仁",
      "quantity": "8",
      "unit": "隻",
      "category": "海鮮"
    },
    {
      "name": "番茄",
      "quantity": "2",
      "unit": "個",
      "category": "蔬菜"
    },
    {
      "name": "蒜頭",
      "quantity": "3",
      "unit": "瓣",
      "category": "調味料"
    },
    {
      "name": "番茄醬",
      "quantity": "2",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "鹽",
      "quantity": "適量",
      "unit": "",
      "category": "調味料"
    },
    {
      "name": "橄欖油",
      "quantity": "1.5",
      "unit": "湯匙",
      "category": "調味料"
    }
  ],
  "steps": [
    {
      "instruction": "意粉大滾水加鹽煮8-10分鐘至八成熟；番茄切細丁；蒜頭剁成蒜蓉；蝦仁洗淨抹乾用少許鹽醃5分鐘。",
      "duration": 5
    },
    {
      "instruction": "平底鑊中落橄欖油，下蝦仁中火每面煎1-2分鐘至變紅熟透，盛起備用（保留鑊中香濃嘅蝦油！）。",
      "duration": 3
    },
    {
      "instruction": "同一個鑊中落蒜蓉爆香，下番茄丁大火炒3分鐘至出沙，下番茄醬同2湯匙煮意粉水調成汁，煮開。",
      "duration": 5
    },
    {
      "instruction": "倒入煮好嘅意粉，大火翻炒，加入蝦仁炒勻至醬汁緊裹意粉，加少許鹽調味即可上碟。",
      "duration": 7
    }
  ],
  "tags": [
    "30 分鐘內",
    "簡單",
    "快手",
    "西餐",
    "海鮮",
    "酸甜"
  ]
},
{
  "name": "正宗意式卡邦尼意粉",
  "description": "正宗意式做法，不加任何忌廉 (Cream)！只用新鮮蛋黃、帕馬臣芝士粉 (Parmesan) 攪拌成濃郁醬汁，與鹹香脆口嘅煙肉大火熱拌，15分鐘做出極致濃郁意麵。",
  "cookTime": 15,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "西餐",
  "ingredients": [
    {
      "name": "意粉",
      "quantity": "150",
      "unit": "克",
      "category": "麵類"
    },
    {
      "name": "煙肉碎",
      "quantity": "60",
      "unit": "克",
      "category": "肉類"
    },
    {
      "name": "雞蛋黃",
      "quantity": "2",
      "unit": "個",
      "category": "其他"
    },
    {
      "name": "全蛋",
      "quantity": "1",
      "unit": "隻",
      "category": "其他"
    },
    {
      "name": "帕馬臣芝士粉",
      "quantity": "25",
      "unit": "克",
      "category": "其他"
    },
    {
      "name": "黑胡椒",
      "quantity": "適量",
      "unit": "",
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
      "instruction": "意粉大滾水加鹽，中火煮8-10分鐘至八成熟；煙肉切碎段。將2個蛋黃、1個全蛋、大量芝士粉同大量黑胡椒在碗中攪勻成「蛋黃芝士糊」。",
      "duration": 5
    },
    {
      "instruction": "平底鑊不落油，直接下煙肉碎中火煎至香脆、逼出豬油，熄火，倒入煮好嘅熱意粉拌勻，加入2湯匙煮意粉嘅熱水，稍微攪動降溫至80°C左右（防止蛋液熟成蛋花）。",
      "duration": 5
    },
    {
      "instruction": "迅速倒入蛋黃芝士糊，快速搖動鑊身並不斷攪拌，利用意粉嘅餘熱將蛋液芝士糊乳化成滑亮、緊緊附在麵條上嘅濃稠黃金醬汁即可上碟（千萬不要開火煮蛋液！）。",
      "duration": 5
    }
  ],
  "tags": [
    "15 分鐘內",
    "簡單",
    "快手",
    "西餐"
  ]
},
{
  "name": "蒜香煙肉蘑菇意粉",
  "description": "15分鐘極速西式一人食！蒜片、橄欖油、鹹香煙肉同鮮蘑菇片一齊大火煸炒出油，拌入爽口意粉，香氣逼人，極速美味。",
  "cookTime": 15,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "西餐",
  "ingredients": [
    {
      "name": "意粉",
      "quantity": "150",
      "unit": "克",
      "category": "麵類"
    },
    {
      "name": "煙肉碎",
      "quantity": "50",
      "unit": "克",
      "category": "肉類"
    },
    {
      "name": "洋菇(蘑菇)",
      "quantity": "100",
      "unit": "克",
      "category": "蔬菜"
    },
    {
      "name": "蒜頭",
      "quantity": "4",
      "unit": "瓣",
      "category": "調味料"
    },
    {
      "name": "橄欖油",
      "quantity": "1.5",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "鹽",
      "quantity": "適量",
      "unit": "",
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
      "instruction": "意粉大滾水加鹽，中火煮8-10分鐘至八成熟；蘑菇切片；煙肉切碎段；蒜頭切成均勻薄片。",
      "duration": 5
    },
    {
      "instruction": "平底鑊中落少許油，下煙肉碎煎至微微焦黃出油，盛起備用。",
      "duration": 3
    },
    {
      "instruction": "同一個鑊中落橄欖油爆香蒜片同蘑菇片，下煮好嘅意粉、煙肉碎同2湯匙煮意粉水，大火翻炒1分鐘至湯汁乳化，加鹽、黑胡椒調味即可上碟。",
      "duration": 7
    }
  ],
  "tags": [
    "15 分鐘內",
    "簡單",
    "快手",
    "西餐"
  ]
},
{
  "name": "焗蜜汁金沙骨",
  "description": "蜜香多汁、外皮微焦金黃、肉質軟嫩嘅金沙骨（豬一字排）！利用焗爐或氣炸鍋20-25分鐘極速做出，乾淨無油煙，大人細路最愛。",
  "cookTime": 25,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "金沙骨",
      "quantity": "300",
      "unit": "克",
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
      "name": "生粉",
      "quantity": "1",
      "unit": "茶匙",
      "category": "調味料"
    }
  ],
  "steps": [
    {
      "instruction": "金沙骨切段洗淨抹乾，加入生抽、蠔油、蒜蓉、紹興酒同生粉醃15分鐘。",
      "duration": 10
    },
    {
      "instruction": "焗爐或氣炸鍋預熱至200°C，將金沙骨平鋪在烤網或錫紙上，烤15分鐘（中途翻面一次）。",
      "duration": 15
    },
    {
      "instruction": "最後2分鐘，取出金沙骨均勻刷上厚厚一層蜜糖，重回烤箱烤烤2-3分鐘至表面微焦、呈亮麗金黃即可出爐。",
      "duration": 0
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
  "name": "蒜香焗金沙骨",
  "description": "極致蒜香、酥脆金黃嘅烤排骨！排骨段拍上薄生粉，放入焗爐或氣炸鍋大火烤出金黃外皮，蒜香濃郁，極其惹味。",
  "cookTime": 20,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "排骨",
      "quantity": "300",
      "unit": "克",
      "category": "肉類"
    },
    {
      "name": "大蒜",
      "quantity": "6",
      "unit": "瓣",
      "category": "調味料"
    },
    {
      "name": "生抽",
      "quantity": "1.5",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "五香粉",
      "quantity": "0.5",
      "unit": "茶匙",
      "category": "調味料"
    },
    {
      "name": "砂糖",
      "quantity": "0.5",
      "unit": "茶匙",
      "category": "調味料"
    },
    {
      "name": "生粉",
      "quantity": "1",
      "unit": "湯匙",
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
      "instruction": "大蒜剁成極細嘅蒜泥（蒜蓉）；排骨段洗淨抹乾，加入蒜泥、生抽、五香粉同糖醃15分鐘。",
      "duration": 5
    },
    {
      "instruction": "加入生粉同少許油抓勻，使排骨表面拍上薄薄生粉。",
      "duration": 2
    },
    {
      "instruction": "氣炸鍋或焗爐預熱至195°C，將排骨鋪平，烤15-18分鐘（中途翻面），烤至外表呈酥脆金黃色即可。",
      "duration": 13
    }
  ],
  "tags": [
    "30 分鐘內",
    "簡單",
    "快手",
    "烤",
    "家常"
  ]
},
{
  "name": "肉碎豆腐煲",
  "description": "家常溫馨嘅砂鍋料理！玉子豆腐切厚片煎至表面微脆（不碎秘訣！），與免治豬肉碎一齊在鮮香嘅蠔油清湯中燜煮入味，大人細路最愛淋飯菜式。",
  "cookTime": 20,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "玉子豆腐",
      "quantity": "2",
      "unit": "條",
      "category": "其他"
    },
    {
      "name": "免治豬肉",
      "quantity": "100",
      "unit": "克",
      "category": "肉類"
    },
    {
      "name": "蒜蓉",
      "quantity": "1",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "薑末",
      "quantity": "1",
      "unit": "茶匙",
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
      "quantity": "1.5",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "糖",
      "quantity": "0.5",
      "unit": "茶匙",
      "category": "調味料"
    },
    {
      "name": "生粉",
      "quantity": "1.5",
      "unit": "茶匙",
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
      "instruction": "玉子豆腐切2厘米厚片，兩面拍上薄生粉；免治豬肉加少許生抽醃5分鐘。",
      "duration": 5
    },
    {
      "instruction": "熱鑊下油，下玉子豆腐中火煎至兩面微黃定型（約3分鐘），盛起備用。",
      "duration": 3
    },
    {
      "instruction": "同一個鑊中爆香蒜蓉、薑末，下肉碎炒散至變色，加入生抽、蠔油、糖同少許水煮滾，倒入豆腐片，轉中火蓋蓋燜煮5分鐘。",
      "duration": 10
    },
    {
      "instruction": "倒入預熱嘅砂鍋中，淋入生粉水勾芡煮至濃稠，撒上蔥花即成。",
      "duration": 2
    }
  ],
  "tags": [
    "30 分鐘內",
    "簡單",
    "快手",
    "家常",
    "下飯",
    "煲仔"
  ]
},
{
  "name": "台式紅燒牛肉麵",
  "description": "經典台灣之光！精選帶筋牛腱肉慢火燉煮，搭配香濃豆瓣醬、番茄和洋蔥燉出極其濃郁、微甜微辣嘅紅燒湯頭，牛肉軟爛、麵條吸汁。",
  "cookTime": 60,
  "servings": 4,
  "difficulty": "中等",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "牛腱肉",
      "quantity": "400",
      "unit": "克",
      "category": "肉類"
    },
    {
      "name": "手骨麵",
      "quantity": "300",
      "unit": "克",
      "category": "麵類"
    },
    {
      "name": "辣豆瓣醬",
      "quantity": "2",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "番茄",
      "quantity": "1",
      "unit": "個",
      "category": "蔬菜"
    },
    {
      "name": "洋蔥",
      "quantity": "0.5",
      "unit": "個",
      "category": "蔬菜"
    },
    {
      "name": "薑片",
      "quantity": "4",
      "unit": "片",
      "category": "調味料"
    },
    {
      "name": "八角",
      "quantity": "2",
      "unit": "粒",
      "category": "調味料"
    },
    {
      "name": "生抽",
      "quantity": "2",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "冰糖",
      "quantity": "15",
      "unit": "克",
      "category": "調味料"
    }
  ],
  "steps": [
    {
      "instruction": "牛腱切厚塊汆水撈出；番茄、洋蔥切塊；薑切片。",
      "duration": 10
    },
    {
      "instruction": "熱鑊下油爆香薑片、洋蔥同八角，加入豆瓣醬、生抽炒香，倒入牛腱大火翻炒上色。",
      "duration": 4
    },
    {
      "instruction": "加入番茄塊、冰糖同足量熱水，大火煮滾後蓋上蓋，轉小火慢火燉煮60-70分鐘至牛腱肉軟爛（中途注意水量）。",
      "duration": 60
    },
    {
      "instruction": "大碗中將手工麵煮熟撈出。將燉好嘅香濃紅燒牛肉和湯澆在麵條上，配以酸菜或蔥花即可享用。",
      "duration": 5
    }
  ],
  "tags": [
    "30 分鐘以上",
    "中等",
    "經典",
    "下飯",
    "麵飯"
  ]
},
{
  "name": "花雕醉大蝦",
  "description": "經典海鮮冷盤！鮮大蝦煮熟後迅速冰鎮（保持肉質脆爽彈牙），浸泡在由花雕酒、清雞湯、當歸和枸杞調配嘅冷藏醉汁中，肉質脆彈，酒香馥郁甜美。",
  "cookTime": 15,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "鮮大蝦",
      "quantity": "8",
      "unit": "隻",
      "category": "海鮮"
    },
    {
      "name": "花雕酒",
      "quantity": "150",
      "unit": "毫升",
      "category": "調味料"
    },
    {
      "name": "清雞湯",
      "quantity": "150",
      "unit": "毫升",
      "category": "調味料"
    },
    {
      "name": "當歸",
      "quantity": "1",
      "unit": "小片",
      "category": "其他"
    },
    {
      "name": "枸杞",
      "quantity": "1",
      "unit": "湯匙",
      "category": "其他"
    },
    {
      "name": "鹽",
      "quantity": "0.5",
      "unit": "茶匙",
      "category": "調味料"
    },
    {
      "name": "糖",
      "quantity": "1",
      "unit": "茶匙",
      "category": "調味料"
    }
  ],
  "steps": [
    {
      "instruction": "小鍋加清水、1片薑煮滾，下鮮大蝦汆水煮熟（約2-3分鐘），撈出立刻浸入冰水中冰鎮以保持Q彈。",
      "duration": 5
    },
    {
      "instruction": "調醉汁：將清雞湯、當歸片、枸杞、鹽和糖倒進鍋中煮沸，熄火，徹底放涼後，倒入花雕酒拌勻（熱雞湯會令酒精和酒香蒸發，故必須完全放涼才放酒）。",
      "duration": 5
    },
    {
      "instruction": "將冰鎮好嘅大蝦剝去蝦身中段嘅殼（保留頭尾便於吸汁），放入大玻璃盒，倒入調好嘅醉汁（沒過大蝦），蓋緊蓋放雪櫃冷藏浸泡12小時入味即可享用。",
      "duration": 5
    }
  ],
  "tags": [
    "15 分鐘內",
    "簡單",
    "快手",
    "冷盤",
    "鮮味",
    "海鮮",
    "送酒"
  ]
},
{
  "name": "花雕醉小鮑魚",
  "description": "極其省心奢華冷盤！新鮮小鮑魚隔水蒸 8 分鐘至熟（鎖住鮮味），浸入冰水去殼洗淨，浸泡在花雕中藥醉汁中冷藏12小時。鮑肉厚實彈牙、酒香透骨，高檔美味。",
  "cookTime": 15,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "新鮮小鮑魚",
      "quantity": "6",
      "unit": "隻",
      "category": "海鮮"
    },
    {
      "name": "花雕酒",
      "quantity": "150",
      "unit": "毫升",
      "category": "調味料"
    },
    {
      "name": "清雞湯",
      "quantity": "150",
      "unit": "毫升",
      "category": "調味料"
    },
    {
      "name": "當歸",
      "quantity": "1",
      "unit": "小片",
      "category": "其他"
    },
    {
      "name": "枸杞",
      "quantity": "1",
      "unit": "湯匙",
      "category": "其他"
    },
    {
      "name": "鹽",
      "quantity": "0.5",
      "unit": "茶匙",
      "category": "調味料"
    },
    {
      "name": "糖",
      "quantity": "1",
      "unit": "茶匙",
      "category": "調味料"
    }
  ],
  "steps": [
    {
      "instruction": "鮮活小鮑魚隔水蒸8分鐘至熟，撈出立即浸入冰水中降溫（使肉質更Q彈）。",
      "duration": 8
    },
    {
      "instruction": "鮑魚去殼、去內臟及嘴部，用牙刷輕輕刷洗邊緣粘液至潔白。",
      "duration": 3
    },
    {
      "instruction": "調醉汁：將清雞湯、當歸、枸杞、鹽和糖煮沸，放涼後拌入花雕酒。",
      "duration": 4
    },
    {
      "instruction": "將清洗乾淨嘅鮑魚放入玻璃盒中，倒入醉汁沒過鮑魚，蓋緊蓋放進雪櫃冷藏浸泡12-24小時後享用，風味絕佳。",
      "duration": 5
    }
  ],
  "tags": [
    "15 分鐘內",
    "簡單",
    "快手",
    "冷盤",
    "鮮味",
    "海鮮",
    "宴客"
  ]
},
{
  "name": "花雕醉溏心蛋",
  "description": "日式與中式嘅創意完美融合！精準水滾煮 6 分鐘嘅半熟溏心蛋去殼，浸入由花雕酒、生抽、冰糖和八角調成嘅香濃醉汁中。蛋黃呈半流沙狀，酒香與蛋香極致交融。",
  "cookTime": 15,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "雞蛋",
      "quantity": "4",
      "unit": "隻",
      "category": "其他"
    },
    {
      "name": "花雕酒",
      "quantity": "100",
      "unit": "毫升",
      "category": "調味料"
    },
    {
      "name": "生抽",
      "quantity": "80",
      "unit": "毫升",
      "category": "調味料"
    },
    {
      "name": "冰糖",
      "quantity": "20",
      "unit": "克",
      "category": "調味料"
    },
    {
      "name": "水",
      "quantity": "100",
      "unit": "毫升",
      "category": "其他"
    },
    {
      "name": "八角",
      "quantity": "1",
      "unit": "粒",
      "category": "調味料"
    },
    {
      "name": "枸杞",
      "quantity": "1",
      "unit": "茶匙",
      "category": "其他"
    }
  ],
  "steps": [
    {
      "instruction": "鍋中倒入水、生抽、冰糖、八角和枸杞，煮沸至冰糖融化，關火，徹底放涼後加入花雕酒，調成「花雕生抽醉汁」。",
      "duration": 5
    },
    {
      "instruction": "大火滾水，加入少許鹽同醋（防裂），放入室溫雞蛋，保持中火煮整整6分鐘，撈出立刻投入大盆冰水中，徹底浸冷（降溫可使蛋黃保持溏心，且外殼極易剝下）。",
      "duration": 7
    },
    {
      "instruction": "將去殼嘅溏心蛋放入玻璃盒，倒入調好嘅花雕生抽醉汁（必須完全沒過雞蛋，若不夠可補少許冷開水），蓋緊蓋在雪櫃冷藏浸泡24小時，取出切半即可享受軟糯流沙、酒香迷人嘅口感。",
      "duration": 3
    }
  ],
  "tags": [
    "15 分鐘內",
    "簡單",
    "快手",
    "冷盤",
    "特色"
  ]
},
{
  "name": "港式蔥油撈麵",
  "description": "10分鐘極速美味！炸至微焦、香脆嘅新鮮小蔥段釋放出極致嘅蔥油香氣，與生抽、老抽、白糖調成「特製蔥油醬」，淋在爽口嘅生麵或蝦子麵上拌勻，香氣撲鼻。",
  "cookTime": 10,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "中菜",
  "ingredients": [
    {
      "name": "生麵",
      "quantity": "2",
      "unit": "個",
      "category": "麵類"
    },
    {
      "name": "新鮮小蔥",
      "quantity": "100",
      "unit": "克",
      "category": "蔬菜"
    },
    {
      "name": "蒜頭",
      "quantity": "2",
      "unit": "瓣",
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
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "白糖",
      "quantity": "1.5",
      "unit": "湯匙",
      "category": "調味料"
    },
    {
      "name": "食油",
      "quantity": "4",
      "unit": "湯匙",
      "category": "調味料"
    }
  ],
  "steps": [
    {
      "instruction": "新鮮小蔥切去根部，洗淨切成大段（只用蔥白同蔥綠部分）；蒜頭切片；將生抽、老抽和白糖在碗中混合勻。",
      "duration": 3
    },
    {
      "instruction": "冷鑊落油（4湯匙），下蔥段同蒜片，開中火慢火煎炸，至蔥段水分收乾、變硬且轉為金黃微黑色（蔥油香氣釋放！），撈起香脆蔥段備用。",
      "duration": 5
    },
    {
      "instruction": "將碗中調好嘅醬汁倒入鑊中嘅蔥油裡，用小火煮至白糖完全融化且冒出微小泡泡，關火盛出，這就是「特製香濃蔥油醬」。",
      "duration": 2
    },
    {
      "instruction": "大滾水下生麵煮2分鐘至爽口，撈出徹底瀝乾水分放入大碗，淋上2-3湯匙特製蔥油醬，放上香脆蔥段拌勻，香氣逼人，極速美味！",
      "duration": 2
    }
  ],
  "tags": [
    "15 分鐘內",
    "簡單",
    "快手",
    "家常",
    "特色"
  ]
},
{
  "name": "西式香草檸檬焗雞",
  "description": "西餐廳經典大菜！選用整隻小春雞，採用「蝴蝶斬法」(Spatchcock) 剪開壓平（快熟關鍵！），塗抹上香濃嘅迷迭香、百里香、檸檬汁同牛油，放入焗爐大火快速焗烤。雞皮焦黃金黃香脆、肉質多汁滑嫩。",
  "cookTime": 30,
  "servings": 2,
  "difficulty": "簡單",
  "recipeCategory": "西餐",
  "ingredients": [
    {
      "name": "小春雞",
      "quantity": "1",
      "unit": "隻",
      "category": "肉類"
    },
    {
      "name": "檸檬",
      "quantity": "1",
      "unit": "個",
      "category": "蔬菜"
    },
    {
      "name": "牛油",
      "quantity": "20",
      "unit": "克",
      "category": "調味料"
    },
    {
      "name": "蒜頭",
      "quantity": "4",
      "unit": "瓣",
      "category": "調味料"
    },
    {
      "name": "乾迷迭香",
      "quantity": "1",
      "unit": "茶匙",
      "category": "調味料"
    },
    {
      "name": "乾百里香",
      "quantity": "1",
      "unit": "茶匙",
      "category": "調味料"
    },
    {
      "name": "黑胡椒",
      "quantity": "適量",
      "unit": "",
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
      "instruction": "小春雞洗淨抹乾，用廚房剪刀沿脊骨兩側剪開，將雞身翻開並用力壓平（蝴蝶斬法 Spatchcock，大火快熟關鍵！）。",
      "duration": 5
    },
    {
      "instruction": "融化牛油，加入蒜泥、迷迭香、百里香、鹽、黑胡椒同半個檸檬榨汁，調成「香草檸檬牛油汁」，均勻塗抹在春雞內外，醃製15分鐘。",
      "duration": 15
    },
    {
      "instruction": "焗爐或氣炸鍋預熱至220°C，將壓平嘅春雞皮朝上平鋪在放有錫紙嘅烤盤上，旁邊放上另半個切片嘅檸檬和整瓣大蒜。",
      "duration": 3
    },
    {
      "instruction": "放入焗爐以220°C大火烘烤25分鐘，至雞皮呈焦黃金黃香脆、用筷子插入雞腿無血水流出即可出爐，稍微放涼5分鐘後切大塊享用。",
      "duration": 25
    }
  ],
  "tags": [
    "30 分鐘內",
    "簡單",
    "快手",
    "烤",
    "西餐",
    "宴客"
  ]
}
];