import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SEEDS_DIR = __dirname;

// Tags to REMOVE - too specific, redundant, or English dish names
const TAGS_TO_REMOVE = new Set([
  // English dish names (too specific)
  'Lasagna', 'Paella', 'Risotto', 'Scone', 'Pizza',
  
  // Redundant with categories
  '中菜', '西餐', '日式', '韓式', '東南亞', '甜品', '飲品', '其他',
  
  // Specific ingredients (search can handle these)
  '豬肉', '雞肉', '牛肉', '魚', '蝦', '蟹', '生', '蜆', '帶子',
  '豆腐', '雞蛋', '南瓜', '茄子', '蘿蔔', '芋頭', '冬菇', '蕃茄',
  '五花肉', '排骨', '臘肉', '鹹魚', '鹹蛋', '皮蛋', '陳皮', '乾貨',
  '魷魚', '牛柳', '牛仔骨', '三文魚', '西冷', '雞翼', '豬頸肉',
  
  // Duplicate concepts
  '清淡健康', '健康低脂', '減肥', '減脂餐', '高蛋白低脂',
  '中華料理', '中式', '西式', '和風', '廣東',
  
  // Too niche
  '啫啫煲', '花膠', '汁', '節日大菜', '手撕', '豉油', '潮州',
  '大腸', '牛展', '酒香', '花雕', '青瓜', '莧菜', '魚湯', '粟米',
  '雜錦', '創意', '惹味', '菠蘿', '紅棗', '點心', '西芹', '堅果',
  '彩椒', '黑椒', '辛辣', '青椒', '苦瓜', '菜脯', '韭黃', '韭菜花',
  '蝦醬', '芥蘭', '通菜', '大蔥', '蔥香', '鹹蛋黃', '炸蒜', '蓋飯',
  '照燒', '豬扒', '海帶', '大根', '生薑燒', '壽喜燒', '鮮甜', '天婦羅',
  '章魚燒', '章魚', '玉子燒', '洋食', '漢堡排', '拌飯', '色彩繽紛',
  '泡菜湯', '炸雞', '海鮮煎餅', '泡菜', '人參雞', '糯米', '大醬湯',
  '魚糕', '部隊鍋', '午餐肉', '烤牛肉', '寬冬粉', '豆腐湯', '鮮辣',
  '青咖喱', '冬蔭功', '鮮美', '金邊粉', '炒粉', '印尼', '太陽蛋',
  '海南雞飯', '雞油飯', '打拋豬', '九層塔', '肉骨茶', '白胡椒',
  '春卷', '叻沙', '烤串', '沙嗲', '糯米飯', '家庭料理', '輕食',
  '牛排', '橄欖油', '大蝦', '蒜香', '蘑菇', '漢堡', '烤肉',
  '豬排', 'BBQ', '菠菜', '薯蓉', '楊枝甘露', '西米',
  '紅豆沙', '芝麻糊', '養顏', '雙皮奶', '西米露', '雞蛋仔', '焦糖燉蛋',
  '蛋黃', '心太軟', '朱古力', '流沙', '提拉米蘇', '咖啡', '班戟',
  '薑汁撞奶', '驅寒', '大良鮮奶', '蛋白', '洋蔥湯', '焦糖化', '南瓜湯',
  '羅宋湯', '紅菜頭', '蘑菇湯', '蔬菜湯', '通心粉', '蜆湯', '周打湯',
  '番茄湯', '牛肉湯', '匈牙利', '紅椒粉', '辛香', '希臘', '雞湯',
  '檸檬', '波蘭', '酸湯', '黑麥', '微酸', '燉飯', '牛肝菌', '冷麵',
  '蕎麥麵', '冰爽', '豬骨湯', '溏心蛋', '米粉', '西班牙', '海鮮飯',
  '青口', '鍋巴', '炸醬麵', '黑春醬', '落飯', '炒烏冬', '烏冬',
  '千層麵', '鬆餅', '牛油', '小炒', '主菜', '小朋友啱食', '5 分鐘',
  '丼飯', '香葉', '肉碎', '糖水', '清熱', '家庭', '色彩豐富', '順滑',
  '傳統', '香甜', '午餐', '栗子', '秋天', '粉絲', '大白菜', '羊肉',
  '支竹', '四季豆', '橄欖菜', '鴨肉', '南乳', '沙薑', '白切', '滷水',
  '絲瓜', '避風塘', '彈牙', '年糕', '拉麵', '香腸', '洋蔥', '燉雞',
  '越式', '河粉', '沙律', '美式', '拉絲', '英式', '免焗', '叉燒',
  '辣', '嫩滑', '烤', '海參', '鹹甜', '味噌湯', '火鍋', '甜辣', '醬香',
  
  // Too specific
  '滾', '鑊氣', '高級', '精緻', '街頭小食', '乾香', '乾貨',
  
  // Meal times (redundant)
  '晚餐', '早餐', '午餐', '下午茶', '宵夜', '便當',
  
  // Other niche
  '豐富', '麵飯', '老火湯', '魚香', '養生', '帶子', '肉醬', '白汁',
  '牛奶', '夏天', '濃郁', '飽肚', '芝士', '微辣', '茶餐廳', '營養',
  '煲仔', '廚神挑戰', '長者', '酸辣', '消暑', '一家大細', '困難',
  '冷盤', '爽脆', '豉汁', '清爽', '泰式', '忌廉', '冬天', '咖喱',
  '意式', '麻辣', '排骨', '暖身', '湯水', '湯粉', '薯仔', '甜香',
  '小食', '多汁', '一人食', '高纖', '意粉', '焗', '椰奶', '星馬',
  '芒果', '高蛋白', '蓋飯', '洋食', '鮮甜', '家庭料理',
]);

function cleanupTags(content: string): string {
  return content.replace(/tags:\s*\[([^\]]+)\]/g, (match, tagsStr) => {
    const tags = tagsStr
      .split(',')
      .map(t => t.trim().replace(/['"]/g, ''))
      .filter(t => t.length > 0);
    
    const filteredTags = tags.filter(tag => !TAGS_TO_REMOVE.has(tag));
    
    if (filteredTags.length === 0) {
      filteredTags.push('家常', '簡單');
    }
    
    const newTagsStr = filteredTags.map(t => `"${t}"`).join(', ');
    return `tags: [${newTagsStr}]`;
  });
}

function main() {
  const files = fs.readdirSync(SEEDS_DIR)
    .filter(f => f.endsWith('.ts') && f !== 'cleanup-tags.ts');
  
  files.forEach(file => {
    const filePath = path.join(SEEDS_DIR, file);
    let content = fs.readFileSync(filePath, 'utf-8');
    const original = content;
    
    content = cleanupTags(content);
    
    if (content !== original) {
      fs.writeFileSync(filePath, content, 'utf-8');
      console.log(`✅ Cleaned: ${file}`);
    } else {
      console.log(`⏭️  Skipped: ${file}`);
    }
  });
  
  console.log('\n🎉 Tag cleanup complete!');
}

main();
