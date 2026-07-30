import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  console.log('🔍 正在讀取所有啟用的官方食譜...');
  const recipes = await sql`SELECT id, name FROM official_recipes WHERE is_active = true`;
  console.log(`✅ 找到 ${recipes.length} 個食譜。`);

  let updatedCount = 0;
  let highPopCount = 0;
  let midPopCount = 0;
  let lowPopCount = 0;

  for (const recipe of recipes) {
    const name = recipe.name.toLowerCase();
    let popularity = 50; // 預設值

    // 🌟 第一檔：經典港式名菜 / 熱門搜尋關鍵字 (85 - 98 分)
    // 呢啲食譜會立刻登上推薦榜首，並自動亮起「🔥 熱門」徽章 (門檻 > 80)
    if (
      name.includes('排骨') ||
      name.includes('肉餅') ||
      name.includes('番茄炒蛋') ||
      name.includes('蒸蛋') ||
      name.includes('蒸水蛋') ||
      name.includes('火腩') ||
      name.includes('油雞') ||
      name.includes('牛柳') ||
      name.includes('斑腩') ||
      name.includes('薑蔥') ||
      name.includes('口水雞') ||
      name.includes('叉燒') ||
      name.includes('鹽焗') ||
      name.includes('老火湯') ||
      name.includes('例湯') ||
      name.includes('檸檬雞') ||
      name.includes('生炒骨') ||
      name.includes('咕嚕肉') ||
      name.includes('豉汁') ||
      name.includes('椒鹽') ||
      name.includes('紅燒') ||
      name.includes('清蒸') ||
      name.includes('白切雞') ||
      name.includes('脆皮雞') ||
      name.includes('羅漢齋') ||
      name.includes('魚香') ||
      name.includes('麻婆') ||
      name.includes('宮保') ||
      name.includes('糖醋')
    ) {
      popularity = Math.floor(Math.random() * (98 - 85 + 1)) + 85;
      highPopCount++;
    } 
    // 🥢 第二檔：標準家常小炒、蒸煮菜式 (70 - 84 分)
    else if (
      name.includes('炒') ||
      name.includes('煎') ||
      name.includes('蒸') ||
      name.includes('燜') ||
      name.includes('煲') ||
      name.includes('雞') ||
      name.includes('豬') ||
      name.includes('牛') ||
      name.includes('魚') ||
      name.includes('蝦') ||
      name.includes('豆腐') ||
      name.includes('菜') ||
      name.includes('瓜') ||
      name.includes('薯')
    ) {
      popularity = Math.floor(Math.random() * (84 - 70 + 1)) + 70;
      midPopCount++;
    } 
    // 🥗 第三檔：特色/異國菜式或輕食 (50 - 69 分)
    else {
      popularity = Math.floor(Math.random() * (69 - 50 + 1)) + 50;
      lowPopCount++;
    }

    await sql`UPDATE official_recipes SET popularity = ${popularity} WHERE id = ${recipe.id}`;
    updatedCount++;
  }

  console.log(`\n✅ 成功為 ${updatedCount} 個食譜初始化熱門度分布！`);
  console.log(`   🌟 經典名菜 (85-98 分): ${highPopCount} 個`);
  console.log(`   🥢 家常菜式 (70-84 分): ${midPopCount} 個`);
  console.log(`   🥗 特色輕食 (50-69 分): ${lowPopCount} 個`);
  
  await sql.end();
}

main().catch(console.error);
