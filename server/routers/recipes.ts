/**
 * recipes router
 * - parseUrl: AI 解析 IG Reel / YouTube / 小紅書 URL，提取食譜資訊
 * - checkDuplicate: 檢查 URL 或菜名是否已存在
 * - importOfficial: Admin 批量匯入官方食譜
 * - listOfficial: 列出官方食譜（所有用戶可見）
 * - importUser: 用戶匯入食譜（private/pending_public）
 * - listUser: 列出用戶自己的食譜
 * - listPublic: 列出所有公開食譜（含官方 + 已 approve 的用戶食譜）
 * - requestPublic: 用戶申請公開食譜
 * - adminApprove / adminReject: Admin 審核公開申請
 * - adminListPending: Admin 列出待審核食譜
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { invokeLLM, extractJSON, MessageContent, TextContent, ImageContent } from "../_core/llm";
import { classifyRecipeDishTypeLLM, guardDishTypeByName, type DishKind } from "../utils/dishType";
import { computeScenarioTags } from "../utils/scenario";
import { generateRecipeImage } from "../utils/imageGen";
import { translateRecipeContent, translateToChinese } from "../utils/translateContent";
import { buildTranslationPatch, withIngredientTranslations, localizeIngredientNames } from "../utils/recipeTranslations";
import { extractRecipeJsonLd, findOutboundRecipeUrl } from "../utils/recipeJsonLd";
import { normalizeDifficulty } from "../utils/difficulty";
import { getDb, getCommonIngredients, getFamilySubscription } from "../db";
import { assertProFeature, getFamilyEntitlements } from "../services/entitlements";
import { assertUsageAvailable, commitUsage, refundUsage, reserveUsage, usageLimitToTRPC } from "../services/usage";
import { customRecipes, officialRecipes, userRecipeCollections, kolCreators, users } from "../../drizzle/schema";
import { eq, and, or, desc, like, ilike, lte, count, not, gte, sql } from "drizzle-orm";
import crypto from "crypto";
import { storagePut } from "../storage";
import { ENV } from "../_core/env";
import { assertSafeUrl, safeFetch } from "../utils/safeUrl";

// ─── 智能搜尋：分詞詞典、同義詞歸一化、多語言、模糊匹配、關鍵字分割 ──────────────

// Canonical tag whitelist — AI 只准出呢啲 tag（繁體中文），保證跨語言都有字典對照顯示。
const CANONICAL_TAGS = [
  "蒸", "炒", "炆", "焗", "煎", "炸", "燉", "涼拌", "烤", "紅燒",
  "清淡", "鹹香", "酸甜", "辛辣", "鮮味", "海鮮", "蔬菜",
  "家常菜", "快手菜", "宴客菜", "高蛋白", "低卡", "素食", "減脂餐", "小朋友", "30 分鐘內",
  "湯水", "甜品", "飲品", "豬肉", "牛肉", "雞肉", "羊肉", "魚", "蝦", "蛋", "豆腐",
  "主食", "麵", "飯", "日式", "韓式", "中式", "西式", "港式", "台式", "泰式", "印度", "粵菜",
];
const TAGS_RULE = `標籤規則（務必跟隨）：tags 只可以從以下清單揀（可多選，一律用繁體中文），唔准自創清單以外嘅 tag：${CANONICAL_TAGS.join("、")}。`;

// URL 解析快取（private，唔會重新發布做官方食譜）：同 URL 短時間內重用結果 → 省 LLM 成本 + 加快。
const PARSE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 小時
const PARSE_CACHE_MAX = 500;
const parseUrlCache = new Map<string, { at: number; result: any }>();
function cacheParseUrl(key: string, result: any) {
  if (!key || !result || result.parseReason !== "ok") return; // 只快取成功，避免快取 transient 失敗
  parseUrlCache.set(key, { at: Date.now(), result });
  if (parseUrlCache.size > PARSE_CACHE_MAX) parseUrlCache.clear();
}

// 清走來源/AI decode 殘渣（例如 `&#x4e0a;` 被剝成 `x4e0a`）同垃圾 tag。
const TAG_JUNK_RE = /^x[0-9a-fA-F]{2,6}$/;
function cleanTags(tags: any): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tags) {
    const s = String(t ?? "").replace(/^#/, "").trim();
    if (!s) continue;
    if (TAG_JUNK_RE.test(s)) continue;                 // xXXXX escape 殘渣
    if (/^[\d\s.,;:()（）]+$/.test(s)) continue;         // 純數字/標點
    if (s.length > 24) continue;                        // 過長（多數係句子碎片）
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out.slice(0, 20);
}

const CULINARY_KEYWORDS = [
  // 蔬菜 / 水果
  "番茄", "蕃茄", "番薯", "蕃薯", "薯仔", "土豆", "洋蔥", "西蘭花", "菜心", "白菜", "生菜", "菠菜", "椰菜", "芹菜", "韭菜", "青瓜", "南瓜", "茄子", "苦瓜", "冬瓜", "節瓜", "絲瓜", "粟米", "玉米", "蘆筍", "豆角", "荷蘭豆", "四季豆",
  // 肉類
  "雞肉", "豬肉", "牛肉", "羊肉", "鴨肉", "排骨", "雞翼", "雞腿", "豬扒", "雞胸", "肉丸", "肥牛", "牛柳", "牛仔骨", "牛腩", "牛腱", "五花肉", "肉碎", "肉醬", "燒腩", "火腩", "叉燒", "臘腸", "午餐肉", "煙肉", "培根", "火腿", "雞扒", "雞件", "牛尾", "牛展",
  // 海鮮
  "三文魚", "魚柳", "魚肉", "魚片", "蝦仁", "蝦肉", "蝦米", "蟹肉", "蟹柳", "帶子", "蜆肉", "蠔", "生蠔", "魷魚", "章魚", "海參", "鮑魚", "吞拿魚", "鯖魚", "秋刀魚", "龍脷", "鱸魚", "鯇魚", "白鱔", "花甲", "鮑魚",
  // 豆製品 / 蛋類
  "豆腐", "豆乾", "豆皮", "腐竹", "油豆腐", "雞蛋", "鴨蛋", "皮蛋", "鹹蛋", "鵪鶉蛋", "茶葉蛋",
  // 菌菇
  "香菇", "蘑菇", "金針菇", "杏鮑菇", "木耳", "草菇", "雞髀菇", "靈芝",
  // 主食
  "煲仔飯", "燉飯", "炒飯", "燴飯", "蓋飯", "丼", "撈麵", "炒麵", "湯麵", "涼麵", "米粉", "河粉", "烏冬", "意粉", "意大利粉", "拉麵", "餃子", "雲吞", "粉絲", "通粉", "腸粉", "麵包", "吐司", "饅頭", "包子", "薄餅", "壽司", "飯糰", "糯米雞",
  // 調味 / 風味 / 手法
  "豉油", "蒜蓉", "薑蔥", "咖哩", "咖喱", "芝士", "起司", "照燒", "蜜汁", "黑椒", "紅燒", "糖醋", "麻婆", "宮保", "魚香", "避風塘", "沙嗲", "沙茶", "檸檬", "香茅", "南乳", "柱侯", "啫啫",
];

const ENGLISH_TO_CHINESE: Record<string, string> = {
  // 分類
  chinese: "中菜", western: "西餐", japanese: "日式", korean: "韓式",
  dessert: "甜品", desserts: "甜品", drink: "飲品", drinks: "飲品", beverage: "飲品",
  // 手法
  roasted: "焗", baked: "焗", roast: "焗", bake: "焗", fried: "炒", "stir-fry": "炒", "stir-fried": "炒",
  steamed: "蒸", steam: "蒸", braised: "炆", braise: "炆", boiled: "煮", boil: "煮", soup: "湯",
  // 肉 / 海鮮
  chicken: "雞", beef: "牛", pork: "豬", lamb: "羊", mutton: "羊", duck: "鴨",
  wings: "雞翼", wing: "雞翼", drumstick: "雞腿", drumsticks: "雞腿", ribs: "排骨", rib: "排骨",
  steak: "牛柳", fish: "魚", salmon: "三文魚", shrimp: "蝦", prawn: "蝦", prawns: "蝦",
  crab: "蟹", clams: "蜆", clam: "蜆", scallop: "帶子", scallops: "帶子", squid: "魷魚",
  oyster: "蠔", oysters: "蠔", abalone: "鮑魚",
  // 蔬果 / 其他食材
  eggplant: "茄子", onion: "洋蔥", onions: "洋蔥", garlic: "蒜", scallion: "蔥", scallions: "蔥",
  tofu: "豆腐", mushroom: "菇", mushrooms: "菇", cabbage: "椰菜", broccoli: "西蘭花",
  carrot: "紅蘿蔔", carrots: "紅蘿蔔", spinach: "菠菜", potato: "薯仔", potatoes: "薯仔",
  egg: "蛋", eggs: "蛋", curry: "咖哩", cheese: "芝士", tomato: "番茄", tomatoes: "番茄",
  // 主食
  udon: "烏冬", spaghetti: "意粉", pasta: "意粉", ramen: "拉麵", noodle: "麵", noodles: "麵",
  rice: "飯",
  // 常見菜式 / 燒烤
  bbq: "烤", barbecue: "烤", barbeque: "烤", grill: "烤", grilled: "烤",
  "fried rice": "炒飯", "char siu": "叉燒", "fried chicken": "炸雞",
  burger: "漢堡", hamburger: "漢堡", "spring roll": "春卷", pizza: "薄餅", salad: "沙律",
  "milk tea": "奶茶", congee: "粥", porridge: "粥", sushi: "壽司", dumpling: "餃子",
  wonton: "雲吞", hotpot: "火鍋", "hot pot": "火鍋",
};

export function normalizeQuery(query: string): string {
  let q = query.trim().toLowerCase();

  // 簡體 → 繁體（食譜常用字）
  q = toTraditional(q);

  // 中文字元 / 詞彙歸一化（慣用變體）
  q = q.replace(/蕃/g, "番");
  q = q.replace(/咖喱/g, "咖哩");
  q = q.replace(/起司/g, "芝士");
  q = q.replace(/意大利麵/g, "意粉");
  q = q.replace(/意大麵/g, "意粉");

  return q.trim();
}

export function segmentQuery(q: string): string[] {
  const dict = [...CULINARY_KEYWORDS].sort((a, b) => b.length - a.length);
  const keywords: string[] = [];
  let tempQ = q;

  for (const word of dict) {
    if (tempQ.includes(word)) {
      keywords.push(word);
      tempQ = tempQ.split(word).join(" ");
    }
  }

  // 剩餘未被詞典覆蓋的部分（長度 >= 2）也當作關鍵字，強化關聯搜尋
  const remaining = tempQ.split(/\s+/).filter(w => w.length >= 2);
  for (const word of remaining) {
    if (!keywords.includes(word)) keywords.push(word);
  }

  if (keywords.length === 0) {
    const simpleParts = q.split(/\s+/).filter(Boolean);
    if (simpleParts.length > 0) return simpleParts;
  }
  return keywords;
}

// ─── 繁簡字對應（食譜常用字）────────────────────────────────────────────────────
const SIMPLIFIED_TO_TRADITIONAL: Record<string, string> = {
  "意大利面": "意大利麵", "西兰花": "西蘭花", "胡萝卜": "胡蘿蔔", "萝卜": "蘿蔔", "马铃薯": "馬鈴薯", "海鲜": "海鮮",
  "面": "麵", "鸡": "雞", "鱼": "魚", "虾": "蝦", "饭": "飯", "猪": "豬", "鸭": "鴨", "鹅": "鵝",
  "汤": "湯", "锅": "鍋", "酱": "醬", "盐": "鹽", "葱": "蔥", "姜": "薑", "蚝": "蠔", "贝": "貝",
  "参": "參", "鲍": "鮑", "炖": "燉", "焖": "燜", "卤": "滷", "腌": "醃", "丝": "絲", "兰": "蘭",
  "节": "節", "肠": "腸", "饺": "餃", "云": "雲", "馄": "餛", "饨": "飩", "苋": "莧", "丽": "麗",
  "龙": "龍", "凤": "鳳", "凉": "涼", "冻": "凍", "热": "熱", "饮": "飲", "莴": "萵", "笋": "筍",
  "黄": "黃", "麪": "麵",
};

const TRADITIONAL_TO_SIMPLIFIED: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [simp, trad] of Object.entries(SIMPLIFIED_TO_TRADITIONAL)) {
    if (!(trad in map)) map[trad] = simp;
  }
  return map;
})();

function applyCharMap(q: string, map: Record<string, string>): string {
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (q.includes(k)) q = q.split(k).join(map[k]);
  }
  return q;
}

const toTraditional = (q: string) => applyCharMap(q, SIMPLIFIED_TO_TRADITIONAL);
const toSimplified = (q: string) => applyCharMap(q, TRADITIONAL_TO_SIMPLIFIED);

// ─── 同義詞 / 地區變體（雙向擴充用）──────────────────────────────────────────────
const SYNONYM_VARIANTS: Record<string, string[]> = {
  "薯仔": ["土豆", "馬鈴薯"],
  "番薯": ["地瓜", "甘薯"],
  "番茄": ["西紅柿"],
  "三文魚": ["鮭魚"],
  "吞拿魚": ["金槍魚", "鮪魚"],
  "雞翼": ["雞翅"],
  "雲吞": ["餛飩", "抄手"],
  "芝士": ["奶酪"],
  "通菜": ["空心菜", "蕹菜"],
  "節瓜": ["毛瓜"],
  "絲瓜": ["勝瓜"],
  "粟米": ["玉米"],
  "豬扒": ["豬排"],
  "雞扒": ["雞排"],
  "排骨": ["肋骨"],
};

// ─── 多語言字典（英 / 菲 / 印）→ 中文 ───────────────────────────────────────────
const FILIPINO_TO_CHINESE: Record<string, string> = {
  // 主食 / 菜式
  "nasi goreng": "炒飯", "sinigang": "酸湯", "lugaw": "粥", "pansit": "粉", "pancit": "粉",
  "bihon": "米粉", "misua": "麵線", "adobo": "炆", "lechon": "燒肉", "litson": "燒肉",
  // 肉 / 海鮮
  "manok": "雞", "baboy": "豬", "baka": "牛", "kambing": "羊", "isda": "魚", "hipon": "蝦",
  "alimango": "蟹", "pusit": "魷魚", "tahong": "蜆", "talaba": "蠔",
  // 蔬菜 / 其他食材
  "kanin": "飯", "bigas": "米", "itlog": "蛋", "gatas": "奶", "keso": "芝士",
  "bawang": "蒜", "sibuyas": "洋蔥", "kamatis": "番茄", "patatas": "薯仔", "karot": "紅蘿蔔",
  "repolyo": "椰菜", "kangkong": "通菜", "talong": "茄子", "tokwa": "豆腐",
  // 調味 / 手法
  "toyo": "豉油", "patis": "魚露", "suka": "醋", "asin": "鹽", "asukal": "糖", "mantika": "油",
  "prito": "炸", "nilaga": "煮", "gulay": "蔬菜", "mangga": "芒果", "saging": "香蕉",
};

const INDONESIAN_TO_CHINESE: Record<string, string> = {
  // 主食 / 菜式
  "nasi goreng": "炒飯", "mie goreng": "炒麵", "ayam goreng": "炸雞", "nasi lemak": "椰漿飯",
  "rendang": "仁當", "sate": "沙嗲", "satay": "沙嗲", "bubur": "粥", "sup": "湯",
  // 肉 / 海鮮
  "ayam": "雞", "babi": "豬", "sapi": "牛", "kambing": "羊", "ikan": "魚", "udang": "蝦",
  "kepiting": "蟹", "cumi": "魷魚", "kerang": "蜆", "tiram": "蠔",
  // 蔬菜 / 其他食材
  "nasi": "飯", "beras": "米", "mie": "麵", "telur": "蛋", "susu": "奶", "keju": "芝士",
  "bawang putih": "蒜", "bawang merah": "洋蔥", "tomat": "番茄", "kentang": "薯仔",
  "wortel": "紅蘿蔔", "kubis": "椰菜", "kangkung": "通菜", "terong": "茄子", "bayam": "菠菜",
  "tahu": "豆腐", "tempe": "天貝",
  // 調味 / 手法
  "kecap": "豉油", "garam": "鹽", "gula": "糖", "cuka": "醋", "minyak": "油", "merica": "胡椒",
  "goreng": "炸", "rebus": "煮", "kukus": "蒸", "panggang": "烤", "sayur": "蔬菜",
  "mangga": "芒果", "pisang": "香蕉", "kelapa": "椰",
};

const LANG_DICTS: Record<string, string>[] = [ENGLISH_TO_CHINESE, FILIPINO_TO_CHINESE, INDONESIAN_TO_CHINESE];

// ─── 智能主題後備封面（Unsplash 免費高質食物攝影）───────────────────────────────
const FALLBACK_COVERS: Record<string, string[]> = {
  "中菜": [
    "https://images.unsplash.com/photo-1563245372-f21724e3856d?w=800&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1525351484163-7529414344d8?w=800&auto=format&fit=crop",
  ],
  "甜品": [
    "https://images.unsplash.com/photo-1563729784474-d77dbb933a9e?w=800&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=800&auto=format&fit=crop",
  ],
  "港式": [
    "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1559314809-0d155014e79e?w=800&auto=format&fit=crop",
  ],
  "日式": [
    "https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=800&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1553621042-f6e144c71316?w=800&auto=format&fit=crop",
  ],
  "韓式": [
    "https://images.unsplash.com/photo-1583623025817-d180a2221d0a?w=800&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1590301157890-4810ed356917?w=800&auto=format&fit=crop",
  ],
  "西式": [
    "https://images.unsplash.com/photo-1544025162-d76694265947?w=800&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1467003909585-2f8a7270028d?w=800&auto=format&fit=crop",
  ],
  "湯水": [
    "https://images.unsplash.com/photo-1547592166-23acbe346499?w=800&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1543826173-70651706c8f5?w=800&auto=format&fit=crop",
  ],
  "素食": [
    "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1540420773420-336602813358?w=800&auto=format&fit=crop",
  ],
};

const DEFAULT_FALLBACK = "https://images.unsplash.com/photo-1495521821758-02d0571591f8?w=800&auto=format&fit=crop"; // 通用美食封面

// ─── 關鍵字變體擴充（繁 / 簡 / 同義詞）───────────────────────────────────────────
export function getKeywordVariants(kw: string): string[] {
  const set = new Set<string>();
  set.add(kw);
  const simp = toSimplified(kw);
  if (simp !== kw) set.add(simp);
  for (const v of SYNONYM_VARIANTS[kw] ?? []) {
    set.add(v);
    const vs = toSimplified(v);
    if (vs !== v) set.add(vs);
  }
  return Array.from(set);
}

// ─── 英文錯字容忍（Levenshtein 編輯距離）─────────────────────────────────────────
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[n];
}

// ─── common_ingredients 動態查表（外文食材名 → 中文，附 5 分鐘快取）───────────────
type IngredientRow = Awaited<ReturnType<typeof getCommonIngredients>>[number];

let ingredientCache: { items: IngredientRow[]; at: number } | null = null;

async function getIngredientTranslationMap(): Promise<Map<string, string>> {
  if (!ingredientCache || Date.now() - ingredientCache.at > 5 * 60 * 1000) {
    ingredientCache = { items: await getCommonIngredients(), at: Date.now() };
  }
  const map = new Map<string, string>();
  for (const ing of ingredientCache.items) {
    const chinese = ing.nameZh || ing.nameYue || "";
    if (!chinese) continue;
    for (const name of [ing.nameEn, ing.nameFil, ing.nameId]) {
      if (name && name.trim()) map.set(name.trim().toLowerCase(), chinese);
    }
  }
  return map;
}

// ─── 全局翻譯快取（避免每次搜尋都重新構建和排序）────────────────────────────────
let globalTranslationCache: {
  combinedMap: Map<string, string>;
  sortedKeys: string[];
  vocab: { word: string; chinese: string }[];
  at: number;
} | null = null;

async function getTranslationCache() {
  if (globalTranslationCache && Date.now() - globalTranslationCache.at < 5 * 60 * 1000) {
    return globalTranslationCache;
  }
  
  const combined = new Map<string, string>();
  for (const dict of LANG_DICTS) {
    for (const [w, chinese] of Object.entries(dict)) {
      combined.set(w.toLowerCase(), chinese);
    }
  }
  const ingredientMap = await getIngredientTranslationMap();
  for (const [w, chinese] of ingredientMap) {
    combined.set(w, chinese);
  }
  
  const sortedKeys = Array.from(combined.keys()).sort((a, b) => b.length - a.length);
  const vocab = Array.from(combined.entries()).map(([word, chinese]) => ({ word, chinese }));
  
  globalTranslationCache = {
    combinedMap: combined,
    sortedKeys,
    vocab,
    at: Date.now()
  };
  return globalTranslationCache;
}

function fuzzyToChinese(token: string, vocab: { word: string; chinese: string }[]): string | null {
  if (token.length < 3) return null;
  const threshold = token.length >= 8 ? 2 : 1;
  let best: { word: string; chinese: string } | null = null;
  let bestDist = Infinity;
  for (const entry of vocab) {
    if (Math.abs(entry.word.length - token.length) > 2) continue;
    const dist = levenshtein(token, entry.word);
    if (dist <= threshold && dist < bestDist) {
      bestDist = dist;
      best = entry;
    }
  }
  return best ? best.chinese : null;
}

/**
 * 將查詢中的外文（英 / 菲 / 印）轉換為中文。
 * 結合「分語言字典」與「common_ingredients 查表」為單一詞彙表，
 * 以「最長優先」一次替換（確保 fried rice / Spring Onion 等複合詞優先於單詞），
 * 剩餘外文 token 再以編輯距離容錯（chiken → chicken → 雞）。
 */
export async function resolveForeignToChinese(rawQuery: string): Promise<string> {
  let q = " " + rawQuery.trim().toLowerCase() + " ";

  // 使用快取避免每次重新構建和排序
  const cache = await getTranslationCache();
  const { combinedMap, sortedKeys, vocab } = cache;

  // 1) 最長優先替換（使用快取的 sortedKeys）
  for (const w of sortedKeys) {
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "gi");
    if (re.test(q)) {
      q = q.replace(re, ` ${combinedMap.get(w)} `);
    }
  }

  // 2) 剩餘外文 token 模糊容錯（使用快取的 vocab）
  q = q.replace(/[a-z]+/gi, (token) => {
    const t = token.toLowerCase();
    const fixed = fuzzyToChinese(t, vocab);
    return fixed ? ` ${fixed} ` : token;
  });

  return q.replace(/\s+/g, " ").trim();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normaliseUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.includes("instagram.com")) {
      return `https://www.instagram.com${u.pathname.replace(/\/$/, "")}`;
    }
    if (u.hostname.includes("youtu.be")) {
      return `https://www.youtube.com/watch?v=${u.pathname.replace("/", "")}`;
    }
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return `https://www.youtube.com/watch?v=${v}`;
    }
    return url.split("?")[0];
  } catch {
    return url;
  }
}

function hashUrl(url: string): string {
  return crypto.createHash("md5").update(normaliseUrl(url)).digest("hex");
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}

function detectSourceType(url: string): "instagram" | "youtube" | "xiaohongshu" | "threads" | "tiktok" | "facebook" | "import" | "manual" {
  if (url.includes("instagram.com")) return "instagram";
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  if (url.includes("xiaohongshu.com") || url.includes("xhslink.com") || url.includes("xhslink.cn")) return "xiaohongshu";
  // Threads：Meta 已由 threads.net 改為 threads.com，兩個 domain 都要認（hostname 比對，避免子字串誤中）
  if (/^(.*\.)?threads\.(net|com)$/i.test(hostnameOf(url))) return "threads";
  if (url.includes("tiktok.com")) return "tiktok";
  // Facebook（含 Reels / Watch / 貼文 / fb.watch / mbasic）→ 獨立分類
  if (isFacebookUrl(url)) return "facebook";
  // 其他 http(s) 連結（網頁匯入）→ "import"（唔再當係手動自建）
  if (/^https?:\/\//i.test(url)) return "import";
  return "manual";
}

/** Facebook（含 Reels / Watch / 貼文 / fb.watch / mbasic）連結判斷 */function isFacebookUrl(url: string): boolean {
  return /(?:^|\.)facebook\.com|(?:^|\.)fb\.watch|(?:^|\.)fb\.me|(?:^|\.)m\.facebook\.com/i.test(
    (() => {
      try { return new URL(url).hostname; } catch { return url; }
    })(),
  );
}

export const FACEBOOK_USER_AGENTS = [
  { label: "iphone", value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" },
  { label: "chrome", value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" },
  { label: "facebookexternalhit", value: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)" },
] as const;

function decodeFacebookEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

function facebookOgMatch(html: string, prop: string): string {
  return html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']*)["']`, "i"))?.[1]
    ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:${prop}["']`, "i"))?.[1]
    ?? "";
}

export type FacebookMeta = {
  title: string;
  description: string;
  image: string;
  siteName: string;
  url: string;
};

export function parseFacebookMeta(html: string): FacebookMeta {
  return {
    title: decodeFacebookEntities(facebookOgMatch(html, "title")),
    description: decodeFacebookEntities(facebookOgMatch(html, "description")),
    image: decodeFacebookEntities(facebookOgMatch(html, "image")),
    siteName: decodeFacebookEntities(facebookOgMatch(html, "site_name")),
    url: decodeFacebookEntities(facebookOgMatch(html, "url")),
  };
}

export function resolveFacebookCanonicalUrl(raw: string, base: string): string {
  try {
    const u = new URL(raw, base);
    if (!isFacebookUrl(u.toString())) return "";
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.toString();
  } catch {
    return "";
  }
}

function facebookCaption(meta: FacebookMeta): { caption: string; cleanTitle: string; titleSegments: string[] } {
  const titleSegments = meta.title.split("|").map((s) => s.trim()).filter(Boolean);
  const cleanTitle = titleSegments.length > 2
    ? titleSegments.slice(1, -1).join(" | ").trim()
    : meta.title.replace(/^[^|]*\|\s*/, "").trim();
  const captionParts = [meta.description, cleanTitle || meta.title]
    .map((s) => (s || "").trim())
    .filter((s, i, a) => s && a.indexOf(s) === i);
  return { caption: captionParts.join("\n").trim(), cleanTitle, titleSegments };
}

function facebookAuthor(html: string, meta: FacebookMeta, originalUrl: string, titleSegments: string[]): string {
  const unescapeJson = (s: string) =>
    s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\\//g, "/")
      .replace(/\\"/g, '"');
  const ownerM = html.match(/"(?:owner|actor|page|uploader)"\s*:\s*\{[^{}]{0,200}?"name"\s*:\s*"([^"]{1,80})"/i);
  const jsonAuthor = ownerM ? unescapeJson(ownerM[1]).trim() : "";
  const handleM = (meta.url || originalUrl).match(/facebook\.com\/([A-Za-z0-9._-]{2,50})\/(?:videos|posts|photos|reels)\//i);
  const urlAuthor = handleM && !/^\d+$/.test(handleM[1]) && !["reel", "watch", "share"].includes(handleM[1].toLowerCase())
    ? handleM[1]
    : "";
  const titleAuthor = titleSegments.length >= 2 ? titleSegments[titleSegments.length - 1] : "";
  const siteIsGeneric = !meta.siteName || /^facebook$/i.test(meta.siteName);
  return jsonAuthor || urlAuthor || titleAuthor || (siteIsGeneric ? "" : meta.siteName);
}

// ─── parseText helper ───────────────────────────────────────────────────────

/** IG 會對伺服器 IP 回傳「毒 host」（*.cdn.instagram.com / cdn-instagram.com，DNS 唔存在）。
 *  呢度將佢正規化返做可解析嘅 scontent-*.cdninstagram.com，保留 path + query（簽名一般可跨 host）。 */
function normalizeInstagramCdnUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    const h = u.hostname;
    let newHost: string | null = null;
    const regional = h.match(/^(scontent-[a-z0-9-]+)\.cdn\.instagram\.com$/);
    if (regional) newHost = `${regional[1]}.cdninstagram.com`;
    else if (h === "scontent.cdn.instagram.com") newHost = "scontent.cdninstagram.com";
    else if (h.endsWith(".cdn-instagram.com")) newHost = h.replace(/\.cdn-instagram\.com$/, ".cdninstagram.com");
    else if (h === "cdn-instagram.com") newHost = "cdninstagram.com";
    if (!newHost || newHost === h) return null;
    u.hostname = newHost;
    if (u.searchParams.has("_nc_ht")) u.searchParams.set("_nc_ht", newHost);
    return u.toString();
  } catch {
    return null;
  }
}

/** 逐個候選 URL 試 rehost，第一個成功就用（唔用隨機 fallback）。 */
async function rehostFirstAvailable(urls: string[], category?: string): Promise<string> {
  const seen = new Set<string>();
  for (const u of urls) {
    if (!u || seen.has(u)) continue;
    seen.add(u);
    const out = await rehostExternalImage(u, category, { fallback: false });
    if (out) {
      console.log("[rehostFirstAvailable] succeeded with candidate:", u.substring(0, 90));
      return out;
    }
  }
  console.log("[rehostFirstAvailable] all candidates failed");
  return "";
}

/** 收集 IG 縮圖候選（官方 oEmbed + embed 頁），host 通常可正常下載。 */
async function collectInstagramThumbnailCandidates(url: string): Promise<string[]> {
  const out: string[] = [];
  const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

  // 1) 官方 oEmbed（實測 200，回傳可用 fbcdn host）
  try {
    const resp = await fetch(
      `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(url)}`,
      { headers: { "User-Agent": ua, Accept: "application/json" }, signal: AbortSignal.timeout(6000) },
    );
    if (resp.ok) {
      const data = (await resp.json()) as { thumbnail_url?: string };
      if (data?.thumbnail_url) out.push(data.thumbnail_url.replace(/&amp;/g, "&"));
    }
  } catch { /* ignore */ }

  // 2) /embed/captioned/ 頁面（EmbeddedMediaImage 或 og:image）
  try {
    const clean = url.split("?")[0].replace(/\/+$/, "");
    const resp = await fetch(`${clean}/embed/captioned/`, {
      headers: { "User-Agent": ua, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(8000),
    });
    if (resp.ok) {
      const html = await resp.text();
      const m =
        html.match(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/) ||
        html.match(/property="og:image" content="([^"]+)"/) ||
        html.match(/content="([^"]+)" property="og:image"/);
      if (m?.[1]) out.push(m[1].replace(/&amp;/g, "&"));
    }
  } catch { /* ignore */ }

  return out;
}

/** 過濾 AI 解析出嘅「偽食材」：小標題（如「蔥油醬汁材料：」）唔應該當食材。
 *  規則：名稱以「：或:」結尾，或屬「…材料」類標題且冇數量 → 丢弃。 */
function sanitizeParsedIngredients(list: any[]): any[] {
  if (!Array.isArray(list)) return [];
  const kept = list.filter((ing) => {
    const name = String(ing?.name ?? "").trim();
    if (!name) return false;
    const hasQty = !!String(ing?.quantity ?? "").trim() || !!String(ing?.unit ?? "").trim();
    if (/[：:]$/.test(name)) return false;
    if (!hasQty && /(材料|醬汁|調味料|醃料|配料)$/.test(name)) return false;
    if (!hasQty && /^(醬汁|調味|醃料|配料|材料|主料|輔料)/.test(name)) return false;
    // 英文 section header（Marinade/Sauce/…）唔好當食材
    if (!hasQty && /^(marinade|sauce|seasoning|garnish|topping|for the|ingredients)\b/i.test(name)) return false;
    if (!hasQty && /\b(marinade|sauce|seasoning|garnish|topping)\s*:?\s*$/i.test(name)) return false;
    return true;
  });
  // 把描述型量詞（適量/少許…）由 quantity/name 移入 unit，避免非中文介面漏中文。
  return kept.map((ing) => {
    const name = String(ing?.name ?? "").trim();
    const q = String(ing?.quantity ?? "").trim();
    const u = String(ing?.unit ?? "").trim();
    const out: any = { ...ing };
    if (!u && DESCRIPTOR_SET.has(q)) { out.quantity = ""; out.unit = q; }
    const desc = extractDescriptor(name);
    if (desc.descriptor) {
      out.name = desc.name || name;
      if (!String(out.unit ?? "").trim()) { out.unit = desc.descriptor; out.quantity = ""; }
    }
    return out;
  });
}

/**
 * Grounding 驗證（防「AI 老作」）：只保留喺來源文字搵到嘅食材。
 * 保守設計：來源太短（<60 字）或 vision（圖為主）→ 唔做（避免誤刪）。
 * 食材 4 種語言名任一對得上來源（CJK 2+ 字子串 / 拉丁 3+ 字母 token）→ 保留。
 */
function groundIngredients(ingredients: any[], sourceText: string): any[] {
  if (!Array.isArray(ingredients) || ingredients.length === 0) return ingredients;
  const src = String(sourceText ?? "").toLowerCase();
  if (src.length < 80) return ingredients; // 太短無法判斷 → 唔動
  const srcTokens = new Set(src.match(/[a-z0-9]+/g) || []);
  const cjkOverlap = (n: string): boolean => {
    const runs = n.match(/[\u4e00-\u9fff]+/g) || [];
    for (const run of runs) {
      if (src.includes(run)) return true;
      // 滑動 2 字窗（處理「中筋麵粉」vs 來源「麵粉」）
      for (let i = 0; i + 2 <= run.length; i++) if (src.includes(run.slice(i, i + 2))) return true;
    }
    return false;
  };
  const overlap = (name: string): boolean => {
    const n = String(name ?? "").toLowerCase().trim();
    if (!n) return false;
    if (cjkOverlap(n)) return true;
    for (const tk of (n.match(/[a-z0-9]+/g) || [])) if (tk.length >= 3 && srcTokens.has(tk)) return true;
    return false;
  };
  const kept = ingredients.filter((ing) => {
    const variants = [ing?.name, ing?.nameEn, ing?.nameFil, ing?.nameId]
      .map((v) => String(v ?? "").trim()).filter(Boolean);
    if (variants.length === 0) return false;
    return variants.some(overlap);
  });
  if (kept.length !== ingredients.length) {
    console.log(`[parseUrl] grounding dropped ${ingredients.length - kept.length} ingredient(s) not found in source`);
  }
  return kept;
}

async function rehostExternalImage(imageUrl: string, category?: string, opts?: { fallback?: boolean }): Promise<string> {  const useFallback = opts?.fallback !== false;
  if (!imageUrl) return useFallback ? "" : "";
  // Decode HTML entities that break fetch (especially Instagram's &amp;)
  imageUrl = imageUrl.replace(/&amp;/g, "&");
  
  const isR2 = imageUrl.includes(".r2.cloudflarestorage.com/") ||
    (process.env.R2_PUBLIC_URL && imageUrl.startsWith(process.env.R2_PUBLIC_URL)) ||
    imageUrl.startsWith("/r2-storage/");
  if (isR2) return imageUrl;

  // SSRF 防護：喺「每次 fetch 之前」驗證（唔可以喺最前面硬擋，否則會阻擋下面嘅 host 正規化救援）
  const safeFetchImage = async (u: string, headers: Record<string, string>) => {
    await assertSafeUrl(u);
    return fetch(u, { headers, signal: AbortSignal.timeout(10000) });
  };
  
  // If R2 is not configured (local dev), keep the original URL instead of falling back to Unsplash
  if (!process.env.R2_ACCOUNT_ID) {
    console.log("[rehostExternalImage] R2 not configured, keeping original URL");
    return imageUrl;
  }

  console.log("[rehostExternalImage] Attempting to rehost:", imageUrl.substring(0, 100));
  
  // Try primary fetch with Instagram referer
  try {
    const resp = await safeFetchImage(imageUrl, {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "Referer": "https://www.instagram.com/",
      "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "Sec-Fetch-Site": "cross-site",
      "Sec-Fetch-Mode": "no-cors",
    });
    console.log("[rehostExternalImage] Primary fetch response:", resp.status, resp.headers.get("content-type"));
    if (resp.ok) {
      const contentType = resp.headers.get("content-type") || "image/jpeg";
      const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
      const arrayBuf = await resp.arrayBuffer();
      const buf = Buffer.from(arrayBuf);
      const key = `recipe-thumbnails/external-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { url } = await storagePut(key, buf, contentType);
      const backendHost = process.env.RAILWAY_PUBLIC_DOMAIN;
      const fullUrl = url.startsWith("/") && backendHost ? `https://${backendHost}${url}` : url;
      console.log("[rehostExternalImage] Successfully rehosted to:", fullUrl.substring(0, 100));
      return fullUrl;
    }
  } catch (primaryErr) {
    console.log("[rehostExternalImage] Primary fetch failed:", (primaryErr as Error).message);
  }
  
  // Retry with clean headers (no referer) - bypasses some CDN blocks
  try {
    const retryResp = await safeFetchImage(imageUrl, {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    });
    console.log("[rehostExternalImage] Retry fetch response:", retryResp.status);
    if (retryResp.ok) {
      const contentType = retryResp.headers.get("content-type") || "image/jpeg";
      const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
      const arrayBuf = await retryResp.arrayBuffer();
      const buf = Buffer.from(arrayBuf);
      const key = `recipe-thumbnails/external-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { url } = await storagePut(key, buf, contentType);
      const backendHost = process.env.RAILWAY_PUBLIC_DOMAIN;
      const fullUrl = url.startsWith("/") && backendHost ? `https://${backendHost}${url}` : url;
      console.log("[rehostExternalImage] Successfully rehosted (retry):", fullUrl.substring(0, 100));
      return fullUrl;
    }
  } catch (retryErr) {
    console.log("[rehostExternalImage] Retry fetch also failed:", (retryErr as Error).message);
  }

  // Attempt 3: 正規化被 IG 落毒嘅 host 再試（*.cdn.instagram.com → *.cdninstagram.com）
  const normalizedUrl = normalizeInstagramCdnUrl(imageUrl);
  if (normalizedUrl) {
    try {
      const normResp = await safeFetchImage(normalizedUrl, {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://www.instagram.com/",
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      });
      console.log("[rehostExternalImage] Normalized fetch response:", normResp.status);
      if (normResp.ok) {
        const contentType = normResp.headers.get("content-type") || "image/jpeg";
        const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
        const buf = Buffer.from(await normResp.arrayBuffer());
        const key = `recipe-thumbnails/external-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { url } = await storagePut(key, buf, contentType);
        const backendHost = process.env.RAILWAY_PUBLIC_DOMAIN;
        const fullUrl = url.startsWith("/") && backendHost ? `https://${backendHost}${url}` : url;
        console.log("[rehostExternalImage] Successfully rehosted (normalized):", fullUrl.substring(0, 100));
        return fullUrl;
      }
    } catch (normErr) {
      console.log("[rehostExternalImage] Normalized fetch failed:", (normErr as Error).message);
    }
  }
  
  // Final fallback: return category-based Unsplash cover（除非要求唔用 fallback）
  if (!useFallback) {
    console.log("[rehostExternalImage] All fetches failed, fallback disabled -> \"\"");
    return "";
  }
  console.log("[rehostExternalImage] All fetches failed, using category fallback");
  const categoryCovers = FALLBACK_COVERS[category || "其他"] || FALLBACK_COVERS["中菜"] || [DEFAULT_FALLBACK];
  const randomCover = categoryCovers[Math.floor(Math.random() * categoryCovers.length)];
  console.log("[rehostExternalImage] Using fallback:", randomCover.substring(0, 100));
  return randomCover;
}

async function parseTextToRecipe(text: string, userLanguage?: string): Promise<{
  name: string;
  description: string;
  cookTime: number;
  servings: number;
  difficulty: string;
  recipeCategory: string;
  ingredients: { name: string; quantity: string; unit: string; category: string }[];
  steps: { instruction: string; duration?: number; tip?: string }[];
  tags: string[];
  sourceAuthor: string;
  thumbnailUrl: string;
  parseReason?: "ok" | "no_recipe_content";
}> {
  const systemPrompt = `你是一個專業的食譜解析助手。從用戶貼上的文字（可能來自小紅書、WhatsApp、網站等）中提取完整的食譜資訊並以 JSON 格式回傳。
  
  重要規則：
  - 只提取內容中實際存在的食譜資訊，不要虛構或猜測
  - 如果內容中沒有食譜資訊（例如純聊天、問候、食評、無食材和步驟的文字），請在 name 回傳"無法解析"，並在 description 說明原因
  - 食材分類規則：肉類、海鮮/蔬菜/調味料/乾貨/其他
  - 主要文字使用繁體中文；並同時提供英(En)/菲(Fil)/印尼(Id)譯文`;

  const userPrompt = `請從以下食譜文字中提取食譜資訊：

---
${text}
---

請回傳以下 JSON 格式（主要文字一律用**繁體中文**；**同時**提供英/菲/印尼譯文）：
{
  "name": "食譜名稱（繁中）",
  "nameEn": "English name",
  "nameFil": "Filipino name",
  "nameId": "Indonesian name",
  "description": "簡短描述（1-2句，繁中）",
  "descriptionEn": "English description",
  "descriptionFil": "Filipino description",
  "descriptionId": "Indonesian description",
  "cookTime": 烹飪時間（分鐘，整數）,
  "servings": 份量（人數，整數）,
  "difficulty": "簡單" | "中等" | "困難",
  "recipeCategory": "中菜" | "西餐" | "日式" | "韓式" | "東南亞" | "港式" | "台式" | "泰式" | "印度" | "甜品" | "飲品" | "其他",
  "ingredients": [
    { "name": "食材名稱（繁中）", "nameEn": "English", "nameFil": "Filipino", "nameId": "Indonesian", "quantity": "數量", "unit": "單位", "category": "分類" }
  ],
  "steps": [
    { "instruction": "步驟說明（繁中）", "duration": 分鐘（可選）, "tip": "小貼士（可選）" }
  ],
  "stepsEn": ["English step 1"],
  "stepsFil": ["Filipino step 1"],
  "stepsId": ["Indonesian step 1"],
  "tags": ["標籤1", "標籤2"],
  "sourceAuthor": "創作者名稱（如文字中有提及）",
  "thumbnailUrl": ""
}

翻譯規則：主要文字用繁體中文；nameEn/Fil/Id、descriptionEn/Fil/Id、stepsEn/Fil/Id、每個 ingredient 的 nameEn/Fil/Id 係對應譯文；stepsEn/Fil/Id 同 steps 同數目同次序。
${TAGS_RULE}`;

  const response = await invokeLLM({
    // Parse/vision + long 4-language JSON can exceed the 15s default; give it room.
    timeoutMs: 45000,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "recipe_parse_text",
        strict: false,
        schema: {
          type: "object",
          properties: {
            name: { type: "string" },
            nameEn: { type: "string" },
            nameFil: { type: "string" },
            nameId: { type: "string" },
            description: { type: "string" },
            descriptionEn: { type: "string" },
            descriptionFil: { type: "string" },
            descriptionId: { type: "string" },
            cookTime: { type: "integer" },
            servings: { type: "integer" },
            difficulty: { type: "string" },
            recipeCategory: { type: "string" },
            ingredients: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  nameEn: { type: "string" },
                  nameFil: { type: "string" },
                  nameId: { type: "string" },
                  quantity: { type: "string" },
                  unit: { type: "string" },
                  category: { type: "string" },
                },
                required: ["name", "nameEn", "nameFil", "nameId", "quantity", "unit", "category"],
              },
            },
            steps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  instruction: { type: "string" },
                  duration: { type: "integer" },
                  tip: { type: "string" },
                },
                required: ["instruction"],
              },
            },
            stepsEn: { type: "array", items: { type: "string" } },
            stepsFil: { type: "array", items: { type: "string" } },
            stepsId: { type: "array", items: { type: "string" } },
            tags: { type: "array", items: { type: "string" } },
            sourceAuthor: { type: "string" },
            thumbnailUrl: { type: "string" },
          },
          required: ["name", "nameEn", "nameFil", "nameId", "description", "descriptionEn", "descriptionFil", "descriptionId", "cookTime", "servings", "difficulty", "recipeCategory", "ingredients", "steps", "stepsEn", "stepsFil", "stepsId", "tags", "sourceAuthor", "thumbnailUrl"],
        },
      },
    },
  });

  const rawContent = response.choices[0]?.message?.content;
  const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
  if (!content) throw new Error("AI returned empty response");
  const result: any = extractJSON(content);
  const hasContent = (result.ingredients && result.ingredients.length > 0) ||
    (result.steps && result.steps.length > 0);
  if (Array.isArray(result?.ingredients)) result.ingredients = sanitizeParsedIngredients(result.ingredients);
  result.difficulty = normalizeDifficulty(result.difficulty);
  result.parseReason = (result.name === "無法解析" || result.name === "需要手動輸入" || !hasContent)
    ? "no_recipe_content"
    : "ok";
  return await ensureParseTranslations(result);
}

// ─── Ingredient / Step schemas ────────────────────────────────────────────────

const ingredientSchema = z.object({
  name: z.string(),
  nameEn: z.string().optional(),
  nameFil: z.string().optional(),
  nameId: z.string().optional(),
  quantity: z.string().optional(),
  unit: z.string().optional(),
  category: z.string().optional(),
  price: z.number().optional(),
});

const stepSchema = z.object({
  instruction: z.string(),
  duration: z.number().optional(),
  tip: z.string().optional(),
});

const recipeInputSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().optional(),
  image: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  cookTime: z.number().int().optional(),
  servings: z.number().int().optional(),
  difficulty: z.string().optional(),
  recipeCategory: z.string().optional(),
  dishType: z.string().optional(),
  ingredients: z.array(ingredientSchema),
  steps: z.array(stepSchema),
  tags: z.array(z.string()).optional(),
  sourceUrl: z.string().optional(),
  sourceAuthor: z.string().optional(),
  // Optional pre-provided translations — skip LLM translate when present (huge speed win for AI-saved recipes)
  nameEn: z.string().optional(),
  nameFil: z.string().optional(),
  nameId: z.string().optional(),
  descriptionEn: z.string().optional(),
  descriptionFil: z.string().optional(),
  descriptionId: z.string().optional(),
  stepsEn: z.array(z.string()).optional(),
  stepsFil: z.array(z.string()).optional(),
  stepsId: z.array(z.string()).optional(),
});

// ─── Fetch webpage content helper ────────────────────────────────────────────

/** 完整 decode HTML entities（含 `&#x…;` 用 fromCodePoint，正確處理 emoji/地區旗）。 */
function decodeHtmlEntities(s: string): string {
  return String(s ?? "")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ""; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return ""; } })
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

export async function fetchPageContent(url: string): Promise<{ text: string; thumbnail: string }> {
  try {
  const sourceType = detectSourceType(url);
  // SSRF 防護：用戶提供嘅 URL 一律先驗證（擋私網/loopback/非 http(s)）
  await assertSafeUrl(url);

    if (sourceType === "youtube") {
      let title = "";
      let author = "";
      let thumbnail = "";
      let desc = "";

      const videoIdMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)([-\w]+)/);
      const videoId = videoIdMatch?.[1] ?? "";

      // Step 1: YouTube Data API v3 (primary method — gets full description)
      const ytApiKey = ENV.youtubeApiKey;
      if (videoId && ytApiKey) {
        try {
          const ytResp = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${ytApiKey}`,
            { signal: AbortSignal.timeout(8000) }
          );
          if (ytResp.ok) {
            const ytData = await ytResp.json() as {
              items?: {
                snippet?: {
                  title?: string;
                  channelTitle?: string;
                  description?: string;
                  thumbnails?: { high?: { url?: string }; medium?: { url?: string } };
                };
              }[];
            };
            const snippet = ytData?.items?.[0]?.snippet;
            if (snippet) {
              title = snippet.title ?? "";
              author = snippet.channelTitle ?? "";
              desc = snippet.description ?? "";
              thumbnail = snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || "";
            }
          }
        } catch { /* continue to fallback */ }
      }

      // Step 2: Fallback — oEmbed for title/author/thumbnail
      if (!title && videoId) {
        try {
          const oResp = await fetch(
            `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
            { signal: AbortSignal.timeout(5000) }
          );
          if (oResp.ok) {
            const oData = await oResp.json() as { title?: string; author_name?: string; thumbnail_url?: string };
            title = oData.title ?? "";
            author = oData.author_name ?? "";
            thumbnail = oData.thumbnail_url ?? "";
          }
        } catch { /* continue */ }
      }

      // Step 3: Fallback — scrape HTML for description
      if (!desc && videoId) {
        try {
          const resp = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
            },
            signal: AbortSignal.timeout(10000),
          });
          if (resp.ok) {
            const html = await resp.text();
            const descIdx = html.indexOf('"attributedDescription"');
            if (descIdx > -1) {
              const contentStart = html.indexOf('"content":"', descIdx);
              if (contentStart > -1) {
                const valueStart = contentStart + '"content":"'.length;
                let end = valueStart;
                while (end < html.length) {
                  if (html[end] === '"' && html[end - 1] !== '\\') break;
                  end++;
                }
                desc = html.slice(valueStart, end)
                  .replace(/\\n/g, "\n")
                  .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
                  .replace(/\\\\/g, "\\")
                  .replace(/\\"/g, '"');
              }
            }
          }
        } catch { /* continue */ }
      }

      const parts: string[] = [];
      if (title) parts.push(`Title: ${title}`);
      if (author) parts.push(`Channel: ${author}`);
      if (desc) parts.push(`Description:\n${desc}`);
      return { text: parts.join("\n\n").slice(0, 4000), thumbnail };
    }

    if (sourceType === "instagram") {
      let igCaption = "";
      let igAuthor = "";
      let igThumbnail = "";

      // Extract shortcode from URL (e.g. /reel/DYtC5HfIEEU/ → DYtC5HfIEEU)
      const shortcodeMatch = url.match(/\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/);
      const shortcode = shortcodeMatch?.[1] ?? "";

      // Step 1: RapidAPI Instagram Scraper (primary method)
      const rapidApiKey = ENV.rapidApiKey;
      if (rapidApiKey) {
        try {
          if (shortcode) {
            const rapidResp = await fetch(
              "https://instagram120.p.rapidapi.com/api/instagram/mediaByShortcode",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-rapidapi-host": "instagram120.p.rapidapi.com",
                  "x-rapidapi-key": rapidApiKey,
                },
                body: JSON.stringify({ shortcode }),
                signal: AbortSignal.timeout(10000),
              }
            );
            if (rapidResp.ok) {
              const data = await rapidResp.json() as {
                data?: {
                  xdt_shortcode_media?: {
                    edge_media_to_caption?: { edges?: { node?: { text?: string } }[] };
                    owner?: { username?: string; full_name?: string };
                    thumbnail_src?: string;
                    display_url?: string;
                    is_video?: boolean;
                    video_url?: string;
                  };
                };
              };
              const media = data?.data?.xdt_shortcode_media;
              if (media) {
                igCaption = media.edge_media_to_caption?.edges?.[0]?.node?.text ?? "";
                igAuthor = media.owner?.username || media.owner?.full_name || "";
                igThumbnail = media.thumbnail_src || media.display_url || "";
              }
            }
          }
        } catch { /* continue to fallback */ }
      }

      // Step 2: Fallback — Instagram oEmbed API (free, no key)
      if (!igCaption) {
        try {
          const oResp = await fetch(
            `https://api.instagram.com/oembed?url=${encodeURIComponent(url)}`,
            { signal: AbortSignal.timeout(5000) }
          );
          if (oResp.ok) {
            const oData = await oResp.json() as { title?: string; author_name?: string; thumbnail_url?: string };
            igCaption = oData.title ?? "";
            igAuthor = oData.author_name ?? "";
            if (!igThumbnail) igThumbnail = oData.thumbnail_url ?? "";
          }
        } catch { /* continue to page scrape */ }
      }

      // Step 3: Fallback — fetch page meta (og/twitter) for caption **同** 縮圖（解耦：只要缺任何一樣就試）
      if (!igCaption || !igThumbnail) {
        try {
          const resp = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
              "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
            },
            signal: AbortSignal.timeout(8000),
          });
          if (resp.ok) {
            const html = await resp.text();
            if (!igCaption) {
              const ogDesc = html.match(/property="og:description" content="([\s\S]*?)"/) ||
                             html.match(/content="([\s\S]*?)" property="og:description"/);
              if (ogDesc) {
                igCaption = ogDesc[1]
                  .replace(/&#x([0-9a-fA-F]+);/g, (_: string, hex: string) => String.fromCharCode(parseInt(hex, 16)))
                  .replace(/&quot;/g, '"')
                  .replace(/&amp;/g, "&")
                  .replace(/&lt;/g, "<")
                  .replace(/&gt;/g, ">")
                  .replace(/^[\d.KM]+ likes[^:]*:\s*"?/i, "")
                  .replace(/"?\s*$/, "")
                  .trim();
              }
            }
            if (!igThumbnail) {
              const thumbMatch =
                html.match(/property="og:image" content="([^"]+)"/) ||
                html.match(/content="([^"]+)" property="og:image"/) ||
                html.match(/name="twitter:image" content="([^"]+)"/) ||
                html.match(/content="([^"]+)" name="twitter:image"/);
              if (thumbMatch) igThumbnail = thumbMatch[1].replace(/&amp;/g, "&");
              // 最後掃 HTML 內任何 Instagram CDN 圖
              if (!igThumbnail) {
                const cdnMatch = html.match(/https:\/\/[^"'\s]*?cdninstagram\.com\/[^"'\s]+\.jpg[^"'\s]*/);
                if (cdnMatch) igThumbnail = cdnMatch[0].replace(/&amp;/g, "&");
              }
            }
          }
        } catch { /* continue */ }
      }

      // Fallback: use Instagram's direct image URL pattern (works for most posts)
      if (shortcode && !igThumbnail) {
        try {
          const directResp = await fetch(
            `https://www.instagram.com/${shortcode}/?__a=1&__d=dis`,
            {
              headers: {
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
                "Accept": "application/json",
              },
              signal: AbortSignal.timeout(8000),
            }
          );
          if (directResp.ok) {
            const directData = await directResp.json() as {
              graphql?: { shortcode_media?: { display_url?: string; thumbnail_src?: string; video_thumbnail?: string } };
            };
            igThumbnail = directData?.graphql?.shortcode_media?.display_url
              || directData?.graphql?.shortcode_media?.video_thumbnail
              || directData?.graphql?.shortcode_media?.thumbnail_src
              || "";
          }
        } catch { /* no thumbnail from direct API */ }
      }

      const parts: string[] = [];
      if (igAuthor) parts.push(`Author: @${igAuthor}`);
      if (igCaption) parts.push(`Caption:\n${igCaption}`);
      return { text: parts.join("\n\n").slice(0, 4000), thumbnail: igThumbnail };
    }

    if (sourceType === "xiaohongshu") {
      let noteUrl = url;
      let xhsTitle = "";
      let xhsDesc = "";
      let xhsAuthor = "";
      let xhsThumbnail = "";

      // Step 1: Resolve xhslink.com short URL → full xiaohongshu.com URL
      // 小紅書短連結：xhslink.com 同 xhslink.cn 都要解
      if (/xhslink\.(com|cn)/.test(noteUrl)) {
        try {
          await assertSafeUrl(noteUrl);
          const followResp = await fetch(noteUrl, {
            method: "HEAD",
            headers: {
              "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
            },
            redirect: "manual",
            signal: AbortSignal.timeout(10000),
          });
          const location = followResp.headers.get("location");
          if (location) {
            const resolved = new URL(location, noteUrl).toString();
            await assertSafeUrl(resolved); // 防 redirect SSRF
            noteUrl = resolved;
          }
        } catch { /* use original URL */ }
      }

      // Step 2: Fetch page HTML and extract meta tags
      try {
        const resp = await fetch(noteUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
            "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Cache-Control": "no-cache",
          },
          signal: AbortSignal.timeout(15000),
        });
        if (resp.ok) {
          const html = await resp.text();

          // og:title
          const titleMatch = html.match(/property="og:title"\s*content="([^"]+)"/) ||
                             html.match(/property="twitter:title"\s*content="([^"]+)"/) ||
                             html.match(/"title":"([^"]+)"/);
          if (titleMatch) xhsTitle = titleMatch[1].replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

          // og:description
          const descMatch = html.match(/property="og:description"\s*content="([\s\S]*?)"/) ||
                            html.match(/name="description"\s*content="([^"]+)"/);
          if (descMatch) {
            xhsDesc = descMatch[1]
              .replace(/&#x([0-9a-fA-F]+);/g, (_: string, hex: string) => String.fromCharCode(parseInt(hex, 16)))
              .replace(/&quot;/g, '"')
              .replace(/&amp;/g, "&")
              .replace(/&#x27;/g, "'")
              .trim();
          }

          // og:image
          const imgMatch = html.match(/property="og:image"\s*content="([^"]+)"/);
          if (imgMatch) xhsThumbnail = imgMatch[1];

          // Try to extract author from URL or page content
          const authorMatch = html.match(/"nickname":"([^"]+)"/) ||
                              html.match(/"user_name":"([^"]+)"/);
          if (authorMatch) xhsAuthor = authorMatch[1];

          // Try to extract note text content (from JSON-LD or script data)
          const noteTextMatch = html.match(/"desc":"([^"]+)"/) ||
                                html.match(/"content":"([^"]+)"/);
          if (noteTextMatch) {
            const extraText = noteTextMatch[1]
              .replace(/\\n/g, "\n")
              .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
              .replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">");
            if (extraText.length > xhsDesc.length) xhsDesc = extraText;
          }
        }
      } catch { /* use whatever we got */ }

      const parts: string[] = [];
      if (xhsTitle) parts.push(`Title: ${xhsTitle}`);
      if (xhsAuthor) parts.push(`Author: ${xhsAuthor}`);
      if (xhsDesc) parts.push(`Description:\n${xhsDesc}`);
      return { text: parts.join("\n\n").slice(0, 4000), thumbnail: xhsThumbnail };
    }

    if (sourceType === "threads") {
      let threadText = "";
      let threadAuthor = "";
      let threadThumbnail = "";

      // Step 1: Threads oEmbed API (free, no key)
      try {
        const oResp = await fetch(
          `https://www.threads.net/oembed?url=${encodeURIComponent(url)}`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (oResp.ok) {
          const oData = await oResp.json() as { title?: string; author_name?: string; thumbnail_url?: string };
          threadText = oData.title ?? "";
          threadAuthor = oData.author_name ?? "";
          threadThumbnail = oData.thumbnail_url ?? "";
        }
      } catch { /* continue to page scrape */ }

      // Step 2: Fallback — page scrape og:description（用 safeFetch：逐跳 SSRF 驗證 + 大小上限）
      if (!threadText) {
      try {
        const resp = await safeFetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
            "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          maxBytes: 3_000_000,
          signal: AbortSignal.timeout(12000),
        });
        if (resp.ok) {
          const html = await resp.text();

          // og:title
          const titleMatch = html.match(/property="og:title"\s*content="([^"]+)"/) ||
                             html.match(/name="twitter:title"\s*content="([^"]+)"/);
          if (titleMatch) threadText = `Title: ${decodeHtmlEntities(titleMatch[1])}`;

          // og:description (usually contains the post text)
          const descMatch = html.match(/property="og:description"\s*content="([\s\S]*?)"/) ||
                            html.match(/name="description"\s*content="([^"]+)"/);
          if (descMatch) {
            const desc = decodeHtmlEntities(descMatch[1]);
            threadText += threadText ? `\n\nDescription:\n${desc}` : `Description: ${desc}`;
          }

          // og:image
          const imgMatch = html.match(/property="og:image"\s*content="([^"]+)"/);
          if (imgMatch) threadThumbnail = imgMatch[1];

          // Author from og:title (format "username on Threads")
          if (url.includes("/@")) {
            const userMatch = url.match(/threads\.(?:net|com)\/@?([^/\?]+)/);
            if (userMatch) threadAuthor = userMatch[1];
          }
        }
      } catch { /* use whatever we got */ }
      }

      const parts: string[] = [];
      if (threadAuthor) parts.push(`Author: @${threadAuthor}`);
      parts.push(threadText);
      return { text: parts.join("\n\n").slice(0, 4000), thumbnail: threadThumbnail };
    }

    if (sourceType === "tiktok") {
      let ttCaption = "";
      let ttAuthor = "";
      let ttThumbnail = "";

      // Step 1: TikTok oEmbed API (free, no key)
      try {
        const oResp = await fetch(
          `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (oResp.ok) {
          const oData = await oResp.json() as { title?: string; author_name?: string; thumbnail_url?: string };
          ttCaption = oData.title ?? "";
          ttAuthor = oData.author_name ?? "";
          ttThumbnail = oData.thumbnail_url ?? "";
        }
      } catch { /* continue */ }

      const parts: string[] = [];
      if (ttAuthor) parts.push(`Author: @${ttAuthor}`);
      if (ttCaption) parts.push(`Caption:\n${ttCaption}`);
      return { text: parts.join("\n\n").slice(0, 4000), thumbnail: ttThumbnail };
    }

    if (isFacebookUrl(url)) {
      let fbCaption = "";
      let fbAuthor = "";
      let fbThumbnail = "";
      let canonicalUrl = resolveFacebookCanonicalUrl(url, url) || url;
      let chosenHtml = "";
      let chosenMeta: FacebookMeta | null = null;

      // Try browser UAs first; keep facebookexternalhit as the final fallback.
      for (const ua of FACEBOOK_USER_AGENTS) {
        let status = "error";
        let finalUrl = canonicalUrl;
        try {
          const htmlResp = await fetch(canonicalUrl, {
            redirect: "follow",
            headers: {
              "User-Agent": ua.value,
              "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
            },
            signal: AbortSignal.timeout(12000),
          });
          status = String(htmlResp.status);
          finalUrl = htmlResp.url || canonicalUrl;
          const html = htmlResp.ok ? await htmlResp.text() : "";
          const meta = parseFacebookMeta(html);
          const nextCanonical = resolveFacebookCanonicalUrl(meta.url, finalUrl)
            || resolveFacebookCanonicalUrl(finalUrl, finalUrl)
            || canonicalUrl;
          const { caption } = facebookCaption(meta);
          console.log(`[parseUrl][facebook] status=${status} finalUrl=${nextCanonical || finalUrl} pageContentLen=${caption.length} ogDescriptionLen=${meta.description.length} ua=${ua.label}`);
          if (caption.length > 0 || meta.description.length > 0) {
            chosenHtml = html;
            chosenMeta = meta;
            canonicalUrl = nextCanonical;
            break;
          }
          if (nextCanonical && nextCanonical !== canonicalUrl) canonicalUrl = nextCanonical;
        } catch {
          console.log(`[parseUrl][facebook] status=error finalUrl=${finalUrl} pageContentLen=0 ogDescriptionLen=0 ua=${ua.label}`);
        }
      }

      if (chosenMeta) {
        const { caption, titleSegments } = facebookCaption(chosenMeta);
        fbCaption = caption;
        fbThumbnail = chosenMeta.image;
        fbAuthor = facebookAuthor(chosenHtml, chosenMeta, url, titleSegments);
      }

      const parts: string[] = [];
      if (fbAuthor) parts.push(`Author: ${fbAuthor}`);
      if (fbCaption) parts.push(`Caption:\n${fbCaption}`);
      return { text: parts.join("\n\n").slice(0, 4000), thumbnail: fbThumbnail };
    }

    return { text: "", thumbnail: "" };
  } catch {
    return { text: "", thumbnail: "" };
  }
}

// ─── AI Parse URL ─────────────────────────────────────────────────────────────

/**
 * Guarantee a parsed recipe result carries en/fil/id (name/description/steps/
 * ingredients) before returning — so an English user's editor never shows a
 * blank base name (which would fail save). Never throws.
 */
async function ensureParseTranslations(result: any): Promise<any> {
  if (!result || !result.name || result.name === "無法解析" || result.name === "需要手動輸入") return result;
  try {
    const stepTexts = (Array.isArray(result.steps) ? result.steps : [])
      .map((s: any) => (typeof s === "string" ? s : String(s?.instruction ?? ""))).filter(Boolean);
    const needName = !result.nameEn || !result.nameFil || !result.nameId;
    const needDesc = !!result.description && (!result.descriptionEn || !result.descriptionFil || !result.descriptionId);
    const needSteps = stepTexts.length > 0 && (!result.stepsEn?.length || !result.stepsFil?.length || !result.stepsId?.length);
    if (needName || needDesc || needSteps) {
      const tr = await translateRecipeContent(result.name, stepTexts, result.description ?? "");
      if (needName) { result.nameEn = result.nameEn || tr.nameEn; result.nameFil = result.nameFil || tr.nameFil; result.nameId = result.nameId || tr.nameId; }
      if (needDesc) { result.descriptionEn = result.descriptionEn || tr.descriptionEn; result.descriptionFil = result.descriptionFil || tr.descriptionFil; result.descriptionId = result.descriptionId || tr.descriptionId; }
      if (needSteps) {
        result.stepsEn = result.stepsEn?.length ? result.stepsEn : tr.stepsEn;
        result.stepsFil = result.stepsFil?.length ? result.stepsFil : tr.stepsFil;
        result.stepsId = result.stepsId?.length ? result.stepsId : tr.stepsId;
      }
    }
    const ings = Array.isArray(result.ingredients) ? result.ingredients : [];
    if (ings.some((i: any) => i?.name && (!i.nameEn || !i.nameFil || !i.nameId))) {
      const merged = await localizeIngredientNames(ings);
      if (merged) result.ingredients = merged;
    }
  } catch (e) {
    console.warn("[ensureParseTranslations] failed:", (e as Error)?.message);
  }
  return result;
}

/** Fetch raw HTML (for JSON-LD extraction), SSRF-guarded + size-capped. */
async function fetchRawHtml(url: string): Promise<string> {
  try {
    await assertSafeUrl(url);
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return "";
    const ct = resp.headers.get("content-type") ?? "";
    if (!/html|json/i.test(ct)) return "";
    const text = await resp.text();
    return text.slice(0, 1_500_000);
  } catch {
    return "";
  }
}

const REAL_UNIT_RE = /^(g|kg|mg|ml|l|cc|cup|cups|tbsp|tsp|tablespoon|teaspoon|oz|lb|gram|grams|克|公斤|毫升|杯|湯匙|茶匙|大匙|小匙|匙|個|隻|條|片|塊|包|粒|顆|把|支|扎|碗|碟|份|斤|兩)$/i;

// 描述型「量」→ 應歸入 unit（前端會本地化），唔好留喺 quantity/name 度漏中文。
const DESCRIPTOR_UNIT_RE = /^(適量|适量|少許|少许|少量|酌量|隨意|随意|適量調味|适量调味|少許調味|少许调味|適量即可)\s*(.*)$/;
const DESCRIPTOR_TRAIL_RE = /\s*(適量|适量|少許|少许|少量|酌量)\s*$/;
const DESCRIPTOR_SET = new Set(["適量", "适量", "少許", "少许", "少量", "酌量", "隨意", "随意", "適量調味", "适量调味", "少許調味", "少许调味", "適量即可", "to taste", "pinch"]);

/** "適量鹽" → {name:"鹽", unit:"適量"}；"鹽 適量" 同理；描述型量詞唔留喺 name。 */
function extractDescriptor(nameRaw: string): { name: string; descriptor: string } {
  const name = String(nameRaw ?? "").trim();
  const lead = name.match(DESCRIPTOR_UNIT_RE);
  if (lead) return { name: (lead[2] || "").trim(), descriptor: lead[1] };
  const trail = name.match(DESCRIPTOR_TRAIL_RE);
  if (trail) {
    const rest = name.slice(0, trail.index).trim();
    if (rest) return { name: rest, descriptor: trail[1] };
  }
  return { name, descriptor: "" };
}

/** Best-effort split of an ingredient line "500 g chicken breast" → qty/unit/name. */
function parseIngredientLine(raw: string): { name: string; quantity: string; unit: string } {
  const s = String(raw ?? "").trim();
  if (!s) return { name: "", quantity: "", unit: "" };
  const desc = extractDescriptor(s);
  if (desc.descriptor) return { name: desc.name || desc.descriptor, quantity: "", unit: desc.descriptor };
  const m = s.match(/^([0-9]+(?:[./][0-9]+)?(?:\s*[-–~至]\s*[0-9]+(?:[./][0-9]+)?)?)\s*([A-Za-z\u4e00-\u9fff]{0,7})?\s*(.+)$/);
  if (!m || !m[3]) return { name: s, quantity: "", unit: "" };
  const qty = m[1].replace(/\s+/g, "");
  let unit = (m[2] || "").trim();
  let name = m[3].trim();
  if (unit && !REAL_UNIT_RE.test(unit)) { name = `${unit} ${name}`.trim(); unit = ""; }
  return { name, quantity: qty, unit };
}

/** Build a recipe result from a schema.org JSON-LD node (real extraction — no fabrication). */
async function recipeFromJsonLd(jl: any, thumbnail: string): Promise<any | null> {
  try {
    const srcLang = /[\u4e00-\u9fff]/.test(jl.name + (jl.description ?? "") + jl.ingredients.join(" ")) ? "zh-TW" : "en";
    const ingredients = (jl.ingredients as string[]).map(parseIngredientLine);
    const steps = (jl.steps as string[]).map((instruction: string) => ({ instruction }));
    const built = await buildAllLangs({ name: jl.name, description: jl.description, steps, ingredients, srcLang });
    const dishType = await classifyRecipeDishTypeLLM({
      name: built.name, description: built.description, ingredients: built.ingredients, tags: [], category: undefined,
    });
    let thumbUrl = thumbnail || jl.image || "";
    if (jl.image) {
      try { thumbUrl = (await rehostFirstAvailable([jl.image, thumbnail].filter(Boolean), "其他")) || thumbUrl; } catch { /* ignore */ }
    }
    return {
      name: built.name,
      description: built.description || "",
      cookTime: jl.cookTime ?? 0,
      servings: jl.servings ?? 2,
      difficulty: "中等",
      recipeCategory: "其他",
      dishType,
      ingredients: (built.ingredients || []).map((i: any) => ({
        name: i.name, quantity: i.quantity ?? "", unit: i.unit ?? "", category: i.category ?? "食材",
      })),
      steps: built.steps,
      tags: [],
      sourceAuthor: jl.author ?? "",
      thumbnailUrl: thumbUrl,
      parseReason: "ok" as const,
      nameEn: built.nameEn, nameFil: built.nameFil, nameId: built.nameId,
      descriptionEn: built.descriptionEn, descriptionFil: built.descriptionFil, descriptionId: built.descriptionId,
      stepsEn: built.stepsEn, stepsFil: built.stepsFil, stepsId: built.stepsId,
    };
  } catch (e) {
    console.warn("[recipeFromJsonLd] failed:", (e as Error)?.message);
    return null;
  }
}

async function parseRecipeFromUrl(url: string, userLanguage?: string, clientThumbnail?: string, clientCaption?: string): Promise<{
  name: string;
  description: string;
  cookTime: number;
  servings: number;
  difficulty: string;
  recipeCategory: string;
  ingredients: { name: string; quantity: string; unit: string; category: string }[];
  steps: { instruction: string; duration?: number; tip?: string }[];
  tags: string[];
  sourceAuthor: string;
  thumbnailUrl: string;
  parseReason?: "ok" | "no_recipe_content" | "cannot_read";
}> {
  const sourceType = detectSourceType(url);
  // 匯入效能量度（睇 railway logs 搵瓶頸；唔含 PII）
  const __t0 = Date.now();
  const __stage = (s: string) => console.log(`[parseUrl] ${s} +${Date.now() - __t0}ms`);
  __stage("start");

  // 快取命中 → 直接回（省 LLM 成本 + 加快）
  const __cacheKey = url.trim();
  {
    const hit = parseUrlCache.get(__cacheKey);
    if (hit && Date.now() - hit.at < PARSE_CACHE_TTL_MS) {
      console.log("[parseUrl] cache hit");
      return hit.result;
    }
  }

  // For Instagram: try /media endpoint first to get a clean thumbnail (no "Video" overlay)
  let cleanInstagramThumbnail = "";
  if (sourceType === "instagram") {
    const shortcodeMatch = url.match(/\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/);
    const shortcode = shortcodeMatch?.[1];
    if (shortcode) {
      try {
        const mediaResp = await fetch(
          `https://www.instagram.com/${shortcode}/media/?__a=1&__d=dis`,
          {
            headers: {
              "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
              "Accept": "application/json",
              "X-IG-App-ID": "936619743392459",
            },
            signal: AbortSignal.timeout(10000),
          }
        );
        if (mediaResp.ok) {
          const json = await mediaResp.json() as any;
          const items = json.items || json.graphql?.shortcode_media || json;
          const mediaItem = Array.isArray(items) ? items[0] : items;
          cleanInstagramThumbnail = mediaItem?.image_versions2?.candidates?.[0]?.url
            || mediaItem?.display_url
            || mediaItem?.thumbnail_src
            || "";
          if (cleanInstagramThumbnail) {
            console.log("[parseRecipeFromUrl] Got clean Instagram thumbnail via /media:", cleanInstagramThumbnail.substring(0, 80));
          }
        }
      } catch { /* continue with fallback */ }
    }
  }

  const { text: fetchedContent, thumbnail: fetchedThumbnail } = await fetchPageContent(url);
  __stage("fetchPageContent done");
  // Path A：若手機分享帶嚟 caption，優先/合併使用（Threads/TikTok/小紅書 後端爬唔到時靠佢）
  const clientCaptionText = String(clientCaption ?? "").trim();
  const pageContent = clientCaptionText.length > fetchedContent.length
    ? clientCaptionText
    : (fetchedContent || clientCaptionText);
  if (clientCaptionText) {
    console.log(`[parseRecipeFromUrl] using clientCaption (${clientCaptionText.length} chars, platform=${sourceType})`);
  }
  const hasRealContent = pageContent.length > 30;

  // 縮圖候選：手機拎到（clientThumbnail，住宅 IP 最可靠）優先，其次 oEmbed/embed、/media、page
  const thumbCandidates: string[] = [];
  if (clientThumbnail) thumbCandidates.push(clientThumbnail);
  if (sourceType === "instagram") {
    try {
      thumbCandidates.push(...(await collectInstagramThumbnailCandidates(url)));
    } catch { /* ignore */ }
  }
  if (cleanInstagramThumbnail) thumbCandidates.push(cleanInstagramThumbnail);
  if (fetchedThumbnail) thumbCandidates.push(fetchedThumbnail);

  let effectiveThumbnail = thumbCandidates[0] || "";

  // ── Fast, accurate path: schema.org JSON-LD (no LLM, no hallucination) ──
  // Website → use it directly; social (IG/FB/YT…) → follow the creator's own
  // outbound recipe link and read the JSON-LD there (same dish, authoritative).
  try {
    const isSocial = /instagram|youtube|facebook|threads|xiaohongshu|tiktok/.test(sourceType);
    const candidate = isSocial ? findOutboundRecipeUrl(pageContent || clientCaption || "") : url;
    if (candidate) {
      const html = await fetchRawHtml(candidate);
      __stage("jsonld fetch done");
      const jl = html ? extractRecipeJsonLd(html) : null;
      if (jl) {
        const fromJsonLd = await recipeFromJsonLd(jl, effectiveThumbnail);
        if (fromJsonLd) {
          console.log(`[parseRecipeFromUrl] JSON-LD path ok (${candidate})`);
          cacheParseUrl(__cacheKey, fromJsonLd);
          return fromJsonLd;
        }
      }
    }
  } catch (e) {
    console.warn("[parseRecipeFromUrl] JSON-LD path failed:", (e as Error)?.message);
  }
  
  // If still no thumbnail, use category-based fallback (will be set after parsing)
  // For now, keep it empty and assign after recipeCategory is known

  // Detect if content has actual recipe info (ingredients/steps keywords)
  const hasRecipeKeywords = /(?:材料 | 食材|做法 | 作法|步驟|ingredient|step|recipe|gram|tbsp|tsp|大匙 | 小匙 | 公克 | 毫升 | 份量 | 人份 | 醃製 | 醃漬|[0-9]+\s*(?:克|g|ml|cc|杯|匙|顆|粒|把|片|個|包|湯匙 | 茶匙))/i.test(pageContent);
  console.log(`[parseUrl] source=${sourceType} pageContent=${pageContent.length} hasKeywords=${hasRecipeKeywords} clientCaption=${clientCaptionText.length} thumbnail=${!!effectiveThumbnail}`);

  // If we have text but NO recipe keywords AND no thumbnail to try Vision → return early
  // Note: For Instagram, if we have clientThumbnail (from oEmbed), continue to AI parsing even without keywords
  if (hasRealContent && !hasRecipeKeywords && (sourceType === "instagram" || sourceType === "facebook") && !effectiveThumbnail) {
    return {
      name: "帖子沒有食譜內容",
      description: `這個 Instagram 帖子只有分享文字，沒有食材清單或烹飪步驟。請嘗試：\n1. 複製帖子文字，使用「貼上文字」功能\n2. 手動新增食譜`,
      cookTime: 0,
      servings: 0,
      difficulty: "",
      recipeCategory: "",
      ingredients: [],
      steps: [],
      tags: [],
      sourceAuthor: "",
      thumbnailUrl: effectiveThumbnail || "",
      parseReason: "no_recipe_content" as const,
    };
  }

  const systemPrompt = `你是一個專業的食譜解析助手。從提供的內容中提取完整的食譜資訊並以 JSON 格式回傳。

重要規則：
- 只提取內容中實際存在的食譜資訊，不要虛構或猜測
- 如果內容中沒有食譜資訊，請在 name 回傳"無法解析"，並在 description 說明原因
- 食材分類：肉類/海鮮/蔬菜/調味料/乾貨/其他
- 主要文字使用繁體中文；並同時提供英(En)/菲(Fil)/印尼(Id)譯文`;

  // For Instagram with thumbnail but no keywords: use Vision AI to parse from image
  // Facebook 同樣適用（Reels 多數只有封面圖、caption 未必有完整食材）
  const useVisionForInstagram = effectiveThumbnail && !hasRecipeKeywords
    && ((sourceType === "instagram" && hasRealContent) || isFacebookUrl(url));
  
  // For YouTube/Xiaohongshu: even if we have title/author, the description may not contain full recipe steps.
  const hasTitleOnly = (sourceType === "youtube" || sourceType === "xiaohongshu" || sourceType === "threads") && hasRealContent && !hasRecipeKeywords;

  const contentSection = useVisionForInstagram
    ? `這是一個社交媒體帖文，文字內容冇明顯食譜。請對提供嘅圖片做**文字辨識（OCR）**：**只抽取圖中清楚可見**嘅食材／步驟文字，唔好靠菜名估。
    
帖文文字內容：
${pageContent}

若圖中冇可讀嘅食譜文字（例如只係食物相），請喺 name 回傳「無法解析」，**絕對唔好虛構**任何食材或步驟。`
    : hasTitleOnly
    ? `以下是從${sourceType === "youtube" ? "YouTube 影片" : sourceType === "threads" ? "Threads 帖子" : "小紅書筆記"}頁面提取的資訊（可能只有標題／作者）：

${pageContent}

注意：如果內容**冇**完整食材同步驟，請喺 name 回傳「無法解析」，**唔好虛構**。sourceAuthor 使用上面的 Author 欄位。`
    : hasRealContent
    ? `以下是從網頁提取的實際內容：

${pageContent}

請根據上面的實際內容解析食譜。`
    : `網頁內容無法讀取（可能需要登入）。

URL: ${url}
Platform: ${sourceType}

請在 name 回傳"需要手動輸入"，在 description 說明"無法自動讀取此連結的內容，請使用「貼上文字」功能，複製食譜文字後貼入。"`;

  const thumbnailUrlPlaceholder = effectiveThumbnail || "";

  const userPrompt = `${contentSection}

請回傳以下 JSON 格式（主要文字一律用**繁體中文**；**同時**提供英(En)/菲(Fil)/印尼(Id)譯文）：
{
  "name": "食譜名稱（繁中）",
  "nameEn": "English name",
  "nameFil": "Filipino name",
  "nameId": "Indonesian name",
  "description": "簡短描述（1-2句，繁中）",
  "descriptionEn": "English description",
  "descriptionFil": "Filipino description",
  "descriptionId": "Indonesian description",
  "cookTime": 烹飪時間（分鐘，整數）,
  "servings": 份量（人數，整數）,
  "difficulty": "簡單" | "中等" | "困難",
  "recipeCategory": "中菜" | "西餐" | "日式" | "韓式" | "東南亞" | "港式" | "台式" | "泰式" | "印度" | "甜品" | "飲品" | "其他",
  "dishType": "meat" | "seafood" | "vegetable" | "soup" | "carb" | "appetizer" | "dessert" | "drink" | "other",
  "ingredients": [
    { "name": "食材名稱（繁中）", "nameEn": "English", "nameFil": "Filipino", "nameId": "Indonesian", "quantity": "數量", "unit": "單位", "category": "分類" }
  ],
  "steps": [
    { "instruction": "步驟說明（繁中）", "duration": 分鐘（可選）, "tip": "小貼士（可選）" }
  ],
  "stepsEn": ["English step 1", "..."],
  "stepsFil": ["Filipino step 1", "..."],
  "stepsId": ["Indonesian step 1", "..."],
  "tags": ["標籤1", "標籤2"],
  "sourceAuthor": "創作者名稱",
  "thumbnailUrl": "${thumbnailUrlPlaceholder}"
}

dishType 規則（務必跟隨）：湯麵/湯飯/湯河/湯米線/湯烏冬/湯餃/粥 → carb；純湯/羹/煲湯/燉湯 → soup；湯圓/糖水/糊/豆花 → dessert；飲品 → drink；主食（飯/麵/粉/包）→ carb。

翻譯規則：name、description、ingredients、steps、tags 主要文字一律用**繁體中文**；另外 nameEn/nameFil/nameId、descriptionEn/Fil/Id、stepsEn/Fil/Id、以及每個 ingredient 的 nameEn/Fil/Id 係對應譯文（同一食材/步驟名要前後一致）。若原文係英文/菲文/印尼文/簡體等，先理解再翻成上述 4 種語言。

步驟規則（務必跟隨）：steps 必須**來自來源內容**（帖文／caption／網頁）；若來源冇清楚步驟，**唔好虛構**，steps 可留空。若有步驟，stepsEn/Fil/Id 要同 steps 同數目同次序。
${TAGS_RULE}`;

  // For Instagram with thumbnail: use Vision AI to parse from image
  const visionImage: MessageContent = useVisionForInstagram && effectiveThumbnail
    ? [
        { type: "image_url", image_url: { url: effectiveThumbnail, detail: "high" } },
        { type: "text", text: userPrompt }
      ]
    : userPrompt;

  const response = await invokeLLM({
    // Parse/vision + long 4-language JSON can exceed the 15s default; give it room.
    timeoutMs: 45000,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: visionImage },
    ],
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "recipe_parse",
        strict: false,
        schema: {
          type: "object",
          properties: {
            name: { type: "string" },
            nameEn: { type: "string" },
            nameFil: { type: "string" },
            nameId: { type: "string" },
            description: { type: "string" },
            descriptionEn: { type: "string" },
            descriptionFil: { type: "string" },
            descriptionId: { type: "string" },
            cookTime: { type: "integer" },
            servings: { type: "integer" },
            difficulty: { type: "string" },
            recipeCategory: { type: "string" },
            dishType: { type: "string" },
            ingredients: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  nameEn: { type: "string" },
                  nameFil: { type: "string" },
                  nameId: { type: "string" },
                  quantity: { type: "string" },
                  unit: { type: "string" },
                  category: { type: "string" },
                },
                required: ["name"],
              },
            },
            steps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  instruction: { type: "string" },
                  duration: { type: "integer" },
                  tip: { type: "string" },
                },
                required: ["instruction"],
              },
            },
            stepsEn: { type: "array", items: { type: "string" } },
            stepsFil: { type: "array", items: { type: "string" } },
            stepsId: { type: "array", items: { type: "string" } },
            tags: { type: "array", items: { type: "string" } },
            sourceAuthor: { type: "string" },
            thumbnailUrl: { type: "string" },
          },
          required: ["name", "description", "cookTime", "servings", "difficulty", "recipeCategory", "dishType", "ingredients", "steps", "tags", "sourceAuthor", "thumbnailUrl"],
        },
      },
    },
  });

  const rawContent = response.choices[0]?.message?.content;
  __stage("llm parse done");
  const parsedContent = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
  if (!parsedContent) throw new Error("AI returned empty response");
  console.log(`[parseUrl] llmRawLen=${parsedContent.length} jsonClosed=${parsedContent.trim().endsWith("}")}`);
  const result: any = extractJSON(parsedContent);
  if (Array.isArray(result?.ingredients)) result.ingredients = sanitizeParsedIngredients(result.ingredients);
  if (!result.thumbnailUrl && effectiveThumbnail) result.thumbnailUrl = effectiveThumbnail;
  // Re-host：逐個候選試，第一個成功就用（唔用隨機分類圖 fallback）
  const category = result.recipeCategory || "其他";
  if (result.thumbnailUrl) {
    result.thumbnailUrl = await rehostFirstAvailable([result.thumbnailUrl, ...thumbCandidates], category);
    console.log("[parseRecipeFromUrl] thumbnail rehost result:", result.thumbnailUrl ? "ok" : "none");
  }
  // 冇圖：唔再喺解析路徑「阻塞式」生成 AI 圖（generateRecipeImage 好慢，係匯入最大延遲來源）。
  // 交返空 → 前端用中性佔位／分類封面。AI 封面如需，改為儲存後非同步生成。
  if (!result.thumbnailUrl) result.thumbnailUrl = "";
  // IG hashtags → 併入 tags（方便 AI Chef 用關鍵字搵到）
  try {
    const hashtags = Array.from(
      new Set((String(pageContent).match(/#[\p{L}\p{N}_]{2,30}/gu) || []).map((h) => h.slice(1).trim()).filter(Boolean)),
    ).slice(0, 15);
    if (hashtags.length > 0) {
      const existing: string[] = Array.isArray(result.tags) ? result.tags.map(String) : [];
      const seen = new Set(existing.map((t) => t.toLowerCase()));
      for (const h of hashtags) if (!seen.has(h.toLowerCase())) { existing.push(h); seen.add(h.toLowerCase()); }
      result.tags = existing;
    }
  } catch { /* ignore hashtag extraction errors */ }
  // dishType：parse LLM 有回且合法先用；一律再過 classifyRecipeDishTypeLLM（單一規則來源）
  // 最後再過 guardDishTypeByName（確定性護欄，修正「湯麵/湯圓」等誤判）。
  const DISH_KEYS = ["meat", "seafood", "vegetable", "soup", "carb", "appetizer", "dessert", "drink", "other"];
  const llmDish = String(result.dishType || "").trim();
  let dish: DishKind | undefined = DISH_KEYS.includes(llmDish) ? (llmDish as DishKind) : undefined;
  // 速度：parse LLM 已經回合法 dishType → 唔再額外 call classify（省一次 LLM round-trip）。
  if (!dish) {
    const classified = await classifyRecipeDishTypeLLM({
      name: result.name || "",
      description: result.description || "",
      ingredients: Array.isArray(result.ingredients) ? result.ingredients : [],
      tags: Array.isArray(result.tags) ? result.tags : [],
      category,
    });
    if (classified) dish = classified;
  }
  __stage("classify done");
  result.dishType = guardDishTypeByName(result.name || "", dish || "other");
  // 標籤保底：確保至少有菜系 / 菜式類型 / 家常菜，避免匯入後標籤空白
  try {
    const existing: string[] = Array.isArray(result.tags) ? result.tags.map(String).filter(Boolean) : [];
    const seen = new Set(existing.map((x) => x.toLowerCase()));
    const add = (v?: string) => {
      const s = String(v ?? "").trim();
      if (s && s !== "其他" && !seen.has(s.toLowerCase())) { existing.push(s); seen.add(s.toLowerCase()); }
    };
    add(category);
    const dishLabel: Record<string, string> = {
      meat: "肉類", seafood: "海鮮", vegetable: "蔬菜", soup: "湯水",
      carb: "主食", appetizer: "前菜", dessert: "甜品", drink: "飲品",
    };
    add(dishLabel[String(result.dishType || "")]);
    if (existing.length === 0) existing.push("家常菜");
    result.tags = existing.slice(0, 20);
  } catch { /* ignore tag backfill errors */ }
  // Grounding（防 AI 老作）：非 vision 路徑 → 刪走來源文字搵唔到嘅食材
  if (!useVisionForInstagram && hasRealContent) {
    result.ingredients = groundIngredients(Array.isArray(result.ingredients) ? result.ingredients : [], pageContent);
  }
  // 正規化：難度統一 canonical 中文（LLM 可能回英文/空）
  result.difficulty = normalizeDifficulty(result.difficulty);
  // 內容檢查：URL parse 以前只睇 name → 「有 name 但無料」都會當成功，存入空食譜。
  const hasContent =
    (Array.isArray(result.ingredients) && result.ingredients.length > 0) ||
    (Array.isArray(result.steps) && result.steps.length > 0);
  // Determine parseReason based on result name
  // No usable result at all (LLM returned empty / unparseable JSON) → technical
  // read failure, NOT "post has no recipe content".
  const emptyResult = !result.name || String(result.name).trim() === "";
  if (!hasRealContent || emptyResult) {
    result.parseReason = "cannot_read";
  } else if (result.name === "無法解析" || result.name === "需要手動輸入" || !hasContent) {
    result.parseReason = "no_recipe_content";
  } else {
    result.parseReason = "ok";
  }
  console.log(`[parseUrl] reason=${result.parseReason} name=${String(result.name || "").slice(0, 40)} ingredients=${result.ingredients?.length ?? 0} steps=${result.steps?.length ?? 0}`);
  const __out = await ensureParseTranslations(result);
  cacheParseUrl(__cacheKey, __out);
  return __out;
}

/**
 * 由「作者語言」嘅輸入，產出 4 語言（中文 base + en/fil/id）。
 * - 中文輸入：1 call（zh→en/fil/id）。
 * - 非中文輸入：2 calls（→中文，再→en/fil/id）；作者語言欄用返原文。
 * 唔會 throw（翻譯失敗就回原文，base 盡量用中文）。
 */
export async function buildAllLangs(params: {
  name: string;
  description?: string;
  steps: any[];               // [{instruction,duration?,tip?}] or string[]
  ingredients: any[];         // [{name,...}]
  srcLang?: string;
}): Promise<{
  name: string;
  description: string;
  steps: any[];               // base（中文）steps 物件
  nameEn?: string; nameFil?: string; nameId?: string;
  descriptionEn?: string; descriptionFil?: string; descriptionId?: string;
  stepsEn?: string[]; stepsFil?: string[]; stepsId?: string[];
  ingredients: any[];
}> {
  const isZh = !params.srcLang || params.srcLang.startsWith("zh");
  const stepText = (s: any) => (typeof s === "string" ? s : String(s?.instruction ?? s?.text ?? "")).trim();
  let zhName = String(params.name ?? "").trim();
  let zhDesc = String(params.description ?? "").trim();
  let zhStepText = (params.steps ?? []).map(stepText).filter(Boolean);
  let ingNames = (params.ingredients ?? []).map((i: any) => String(i?.name ?? "").trim());

  if (!isZh) {
    const zh = await translateToChinese(zhName, zhStepText, zhDesc, ingNames, params.srcLang!);
    if (zh.name) zhName = zh.name;
    if (zh.description) zhDesc = zh.description;
    if (zh.steps && zh.steps.length === zhStepText.length) zhStepText = zh.steps;
    if (zh.ingredientNames && zh.ingredientNames.length === ingNames.length) ingNames = zh.ingredientNames;
  }

  const tr = await translateRecipeContent(zhName, zhStepText, zhDesc);

  const baseSteps = isZh
    ? (params.steps ?? [])   // 中文：保留原物件（連 duration/tip）
    : zhStepText.map((instruction) => ({ instruction }));

  const out: any = {
    name: zhName,
    description: zhDesc,
    steps: baseSteps,
    nameEn: tr.nameEn, nameFil: tr.nameFil, nameId: tr.nameId,
    descriptionEn: tr.descriptionEn, descriptionFil: tr.descriptionFil, descriptionId: tr.descriptionId,
    stepsEn: tr.stepsEn, stepsFil: tr.stepsFil, stepsId: tr.stepsId,
    ingredients: (params.ingredients ?? []).map((ing: any, idx: number) => ({ ...ing, name: ingNames[idx] || String(ing?.name ?? "") })),
  };

  if (!isZh) {
    // 目標語言欄用作者原文（保留語氣）；其餘用 tr
    const lang = params.srcLang!;
    if (lang.startsWith("en")) { out.nameEn = params.name; out.descriptionEn = params.description; out.stepsEn = params.steps.map(stepText); }
    else if (lang.startsWith("fil")) { out.nameFil = params.name; out.descriptionFil = params.description; out.stepsFil = params.steps.map(stepText); }
    else if (lang.startsWith("id")) { out.nameId = params.name; out.descriptionId = params.description; out.stepsId = params.steps.map(stepText); }
    out.ingredients = out.ingredients.map((ing: any, idx: number) => {
      const orig = String(params.ingredients[idx]?.name ?? "");
      if (lang.startsWith("en")) return { ...ing, nameEn: orig };
      if (lang.startsWith("fil")) return { ...ing, nameFil: orig };
      if (lang.startsWith("id")) return { ...ing, nameId: orig };
      return ing;
    });
  }

  return out;
}

// ─── Router ───────────────────────────────────────────────────────────────────

/**
 * 存檔即譯：將食譜名 + 步驟翻譯成英/菲/印（一次 LLM call，重用於 import / manual save）。
 * 失敗時回傳空 object（唔阻塞存檔）。
 */

async function assertImportAvailable(familyId: number, userId: string): Promise<void> {
  const ent = await getFamilyEntitlements(familyId, userId);
  if (!ent) throw new TRPCError({ code: "NOT_FOUND", message: "找不到家庭廚房" });
  if (ent.readOnly) throw new TRPCError({ code: "FORBIDDEN", message: "你目前只可檢視此廚房。" });
  await assertUsageAvailable({
    familyId,
    limits: ent.limits,
    cost: { credits: 1, imports: 1 },
  });
}

export const recipesRouter = router({
  // ── Parse URL (AI extract recipe from IG/YouTube URL) ──────────────────────
  parseUrl: protectedProcedure
    .input(z.object({ url: z.string().url(), language: z.string().optional(), clientThumbnail: z.string().optional(), clientCaption: z.string().max(6000).optional() }))
    .mutation(async ({ ctx, input }) => {
      // 🛑 Quota check BEFORE calling LLM
      if (!ctx.activeFamilyId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "請先加入家庭廚房" });
      }
      await assertImportAvailable(ctx.activeFamilyId, String(ctx.user.id));
      
      const parsed = await parseRecipeFromUrl(input.url, input.language, input.clientThumbnail, input.clientCaption);
      // 配額改為喺 importUser（真正儲存）先扣，避免「解析扣咗但存唔到」嘅 off-by-one。
      return {
        ...parsed,
        sourceUrl: input.url,
        sourceType: detectSourceType(input.url),
        sourceUrlHash: hashUrl(input.url),
      };
    }),

  // ── Parse Text (AI extract recipe from pasted text, e.g. 小紅書) ────────────
  parseText: protectedProcedure
    .input(z.object({ text: z.string().min(10).max(5000), language: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // 🛑 Quota check BEFORE calling LLM
      if (!ctx.activeFamilyId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "請先加入家庭廚房" });
      }
      await assertImportAvailable(ctx.activeFamilyId, String(ctx.user.id));
      
      const parsed = await parseTextToRecipe(input.text, input.language);
      // 配額改為喺 importUser 先扣（同 parseUrl 一致）。
      return {
        ...parsed,
        sourceUrl: "",
        sourceType: "import" as const,
        sourceUrlHash: "",
      };
    }),

  // ── Upload recipe screenshot (returns storage URL for Vision AI) ────────────
  uploadRecipeImage: protectedProcedure
    .input(z.object({
      base64: z.string(),
      mimeType: z.string().default("image/jpeg"),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "請先加入家庭廚房" });
      // Validate size: base64 of 4MB ≈ 5.5M chars
      if (input.base64.length > 5_500_000) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "圖片太大，請壓縮後再上傳（最大 4MB）" });
      }
      // 只接受圖片 MIME，避免上載任意內容
      if (!/^image\/(jpeg|png|webp|jpg|heic|heif)$/i.test(input.mimeType)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不支援的圖片格式" });
      }
      const buffer = Buffer.from(input.base64, "base64");
      const ext = input.mimeType.split("/")[1] || "jpg";
      // 安全：key 加 family 前綴 → 防止跨家庭讀取／覆寫（IDOR）
      const key = `recipe-screenshots/f${ctx.activeFamilyId}/${crypto.randomUUID()}.${ext}`;
      const { key: storedKey, url } = await storagePut(key, buffer, input.mimeType);
      const backendHost = process.env.RAILWAY_PUBLIC_DOMAIN;
      // 必須回傳 storagePut 實際用嘅 key（含 hash 後綴），否則之後 storageGet/delete 會搵唔到檔案。
      return { key: storedKey, url: url.startsWith("/") && backendHost ? `https://${backendHost}${url}` : url };
    }),

  // ── Delete uploaded recipe screenshot (clean up orphan R2 files) ────────────
  deleteRecipeImage: protectedProcedure
    .input(z.object({ key: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // 安全：只可刪自己家庭嘅截圖，或自己上載嘅縮圖（防未授權刪除）
      const ownScreenshot = input.key.startsWith(`recipe-screenshots/f${ctx.activeFamilyId}/`);
      const ownThumb = input.key.startsWith(`recipe-thumbnails/user-${ctx.user.id}-`);
      if (!ctx.activeFamilyId || (!ownScreenshot && !ownThumb)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "無權存取此檔案" });
      }
      try {
        const { storageDelete } = await import("../storage");
        await storageDelete(input.key);
      } catch (e) {
        console.warn("[deleteRecipeImage] Failed to delete:", input.key, e);
      }
      return { success: true };
    }),

  // ── Parse Image (Vision AI: extract recipe from uploaded screenshot) ────────
  parseImage: protectedProcedure
    .input(z.object({
      storageKey: z.string().optional(), // 單張（舊）
      storageKeys: z.array(z.string()).max(5).optional(), // 多張截圖（caption + 留言）
    }))
    .mutation(async ({ ctx, input }) => {
      // 🛑 Quota check BEFORE calling LLM
      if (!ctx.activeFamilyId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "請先加入家庭廚房" });
      }
      await assertImportAvailable(ctx.activeFamilyId, String(ctx.user.id));

      // 🛑 Screenshot/camera import is a Pro feature
      const sub = await getFamilySubscription(ctx.activeFamilyId);
      if (!sub?.isPaid) {
        throw new TRPCError({ code: "FORBIDDEN", message: "截圖匯入係 Pro 功能，升級後即可用相機／截圖匯入。" });
      }
      
      // Build absolute URL(s) for Vision API via storage signed URL
      const { storageGetSignedUrl } = await import("../storage");
      const keys = (input.storageKeys && input.storageKeys.length > 0)
        ? input.storageKeys
        : (input.storageKey ? [input.storageKey] : []);
      if (keys.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "缺少圖片" });
      // 安全：只可解析自己家庭嘅截圖（防 IDOR 讀取他人圖片）
      for (const k of keys) {
        if (!k.startsWith(`recipe-screenshots/f${ctx.activeFamilyId}/`)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "無權存取此檔案" });
        }
      }
      const imageUrls = await Promise.all(keys.map((k) => storageGetSignedUrl(k)));
      const imageUrl = imageUrls[0]; // 主圖（做封面）

      const systemPrompt = `你係食譜文字辨識（OCR）助手。只讀取圖片中清楚可見嘅文字：
1. 若圖中有食材清單／步驟文字 → 如實抽取（主要文字用繁體中文；同時提供英(En)/菲(Fil)/印尼(Id)譯文）。
2. 唔准靠菜名、外觀或常識推測食材或步驟（寧缺勿作）。
3. 若圖中冇可讀嘅食譜文字（例如只係食物相、冇字、模糊）→ 喺 name 回傳「需要手動輸入」，並喺 description 簡述原因。
      食材名稱用常見煮食用字；食材分類：肉類、海鮮、蔬菜、調味料、乾貨、其他。`;

      const userPrompt = `請只根據圖片中可見嘅文字抽出食材同步驟，唔好靠外觀估。若圖中冇可讀食譜文字，回傳 name「需要手動輸入」。
請回傳以下 JSON 格式（主要文字繁體中文；同時英/菲/印尼譯文）：
{
  "name": "食譜名稱（繁中）",
  "nameEn": "English name",
  "nameFil": "Filipino name",
  "nameId": "Indonesian name",
  "description": "簡短描述（1-2句，繁中）",
  "descriptionEn": "English description",
  "descriptionFil": "Filipino description",
  "descriptionId": "Indonesian description",
  "cookTime": 烹飪時間（分鐘，整數，如不確定填 30）,
  "servings": 份量（人數，整數，如不確定填 2）,
  "difficulty": "簡單" | "中等" | "困難",
  "recipeCategory": "中菜" | "西餐" | "日式" | "韓式" | "東南亞" | "港式" | "台式" | "泰式" | "印度" | "甜品" | "飲品" | "其他",
  "ingredients": [
    { "name": "食材名稱（繁中）", "nameEn": "English", "nameFil": "Filipino", "nameId": "Indonesian", "quantity": "數量", "unit": "單位", "category": "分類" }
  ],
  "steps": [
    { "instruction": "步驟說明（繁中）", "duration": 分鐘（可選）, "tip": "小貼士（可選）" }
  ],
  "stepsEn": ["English step 1"],
  "stepsFil": ["Filipino step 1"],
  "stepsId": ["Indonesian step 1"],
  "tags": ["標籤 1", "標籤 2"],
  "sourceAuthor": "創作者名稱（如圖片中有顯示）",
  "thumbnailUrl": ""
}
${TAGS_RULE}`;

      const response = await invokeLLM({
    // Parse/vision + long 4-language JSON can exceed the 15s default; give it room.
    timeoutMs: 45000,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              ...imageUrls.map((u) => ({ type: "image_url" as const, image_url: { url: u, detail: "high" as const } })),
              { type: "text", text: imageUrls.length > 1
                ? `${userPrompt}\n\n（以下有 ${imageUrls.length} 張圖，可能係同一食譜嘅不同部分／留言，請合併成一份完整食譜。）`
                : userPrompt },
            ],
          },
        ],
        responseFormat: {
          type: "json_schema",
          json_schema: {
            name: "recipe_parse_image",
            strict: false,
            schema: {
              type: "object",
              properties: {
                name: { type: "string" },
                nameEn: { type: "string" },
                nameFil: { type: "string" },
                nameId: { type: "string" },
                description: { type: "string" },
                descriptionEn: { type: "string" },
                descriptionFil: { type: "string" },
                descriptionId: { type: "string" },
                cookTime: { type: "integer" },
                servings: { type: "integer" },
                difficulty: { type: "string" },
                recipeCategory: { type: "string" },
                ingredients: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      nameEn: { type: "string" },
                      nameFil: { type: "string" },
                      nameId: { type: "string" },
                      quantity: { type: "string" },
                      unit: { type: "string" },
                      category: { type: "string" },
                    },
                    required: ["name", "nameEn", "nameFil", "nameId", "quantity", "unit", "category"],
                  },
                },
                steps: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      instruction: { type: "string" },
                      duration: { type: "integer" },
                      tip: { type: "string" },
                    },
                    required: ["instruction"],
                  },
                },
                stepsEn: { type: "array", items: { type: "string" } },
                stepsFil: { type: "array", items: { type: "string" } },
                stepsId: { type: "array", items: { type: "string" } },
                tags: { type: "array", items: { type: "string" } },
                sourceAuthor: { type: "string" },
                thumbnailUrl: { type: "string" },
              },
              required: ["name", "nameEn", "nameFil", "nameId", "description", "descriptionEn", "descriptionFil", "descriptionId", "cookTime", "servings", "difficulty", "recipeCategory", "ingredients", "steps", "stepsEn", "stepsFil", "stepsId", "tags", "sourceAuthor", "thumbnailUrl"],
            },
          },
        },
      });

      const rawContent = response.choices[0]?.message?.content;
      const parsedContent = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
      if (!parsedContent) throw new Error("AI returned empty response");
  const result: any = extractJSON(parsedContent);

      if (Array.isArray(result?.ingredients)) result.ingredients = sanitizeParsedIngredients(result.ingredients);

      // Use real storage URL as thumbnail if AI didn't extract one.
      // 用後端代理 URL（`/r2-storage/<key>`，永久穩定），避免 1 小時過期嘅預簽 URL。
      if (!result.thumbnailUrl) {
        try {
          const backendHost = process.env.RAILWAY_PUBLIC_DOMAIN;
          const publicUrl = process.env.R2_PUBLIC_URL;
          if (publicUrl) {
            result.thumbnailUrl = `${publicUrl.replace(/\/+$/, "")}/${keys[0]}`;
          } else if (backendHost) {
            result.thumbnailUrl = `https://${backendHost}/r2-storage/${keys[0]}`;
          } else {
            const { storageGet } = await import("../storage");
            const { url: realUrl } = await storageGet(keys[0]);
            result.thumbnailUrl = realUrl;
          }
        } catch {
          // Storage fetch failed — will fall back to category cover below
        }
      }

      // 清走多餘截圖（keys[1..] 只用嚟合併解析，唔會保留）→ 防 R2 孤兒。
      if (keys.length > 1) {
        try {
          const { storageDelete } = await import("../storage");
          await Promise.all(keys.slice(1).map((k) => storageDelete(k).catch(() => {})));
        } catch { /* ignore */ }
      }

      // 冇圖：唔再喺解析路徑阻塞生成 AI 圖（同 parseUrl 一致）。
      if (!result.thumbnailUrl) result.thumbnailUrl = "";

      result.difficulty = normalizeDifficulty(result.difficulty);
      const hasContent = (result.ingredients && result.ingredients.length > 0) ||
        (result.steps && result.steps.length > 0);
      const parseReason = (result.name === "需要手動輸入" || result.name === "無法解析" || !hasContent)
        ? "no_recipe_content" as const
        : "ok" as const;

      // 配額改為喺 importUser 先扣（同 parseUrl 一致）。
      await ensureParseTranslations(result);

      return {
        ...result,
        parseReason,
        sourceUrl: "",
        sourceType: "import" as const,
        sourceUrlHash: "",
      };
    }),

  // ── Check duplicate (by URL hash or name similarity) ──────────────────────
  checkDuplicate: publicProcedure
    .input(z.object({
      sourceUrl: z.string().optional(),
      name: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const urlHash = input.sourceUrl ? hashUrl(input.sourceUrl) : null;
      // 唔再信任 caller 提供嘅 familyId（防枚舉）；只用已驗證嘅 activeFamilyId。
      const familyId = ctx.activeFamilyId ?? null;
      const db = await getDb();
      if (!db) return { hasDuplicate: false, duplicates: [] };
      // 轉義 LIKE 萬用字元（防 % / _ 注入）
      const esc = (s: string) => s.replace(/[%_\\]/g, (m) => "\\" + m);

      const duplicates: { type: "url" | "name"; source: "official" | "user"; id: number; name: string }[] = [];

      if (urlHash) {
        const existing = await db.select({ id: officialRecipes.id, name: officialRecipes.name })
          .from(officialRecipes)
          .where(and(eq(officialRecipes.sourceUrlHash, urlHash), eq(officialRecipes.isActive, true)))
          .limit(1);
        if (existing.length > 0) {
          duplicates.push({ type: "url", source: "official", id: existing[0].id, name: existing[0].name });
        }
      }
      if (input.name) {
        const existing = await db.select({ id: officialRecipes.id, name: officialRecipes.name })
          .from(officialRecipes)
          .where(and(eq(officialRecipes.isActive, true), ilike(officialRecipes.name, `%${esc(input.name)}%`)))
          .limit(3);
        existing.forEach((r: { id: number; name: string }) =>
          duplicates.push({ type: "name", source: "official", id: r.id, name: r.name })
        );
      }

      if (familyId) {
        if (urlHash) {
          const existing = await db.select({ id: customRecipes.id, name: customRecipes.name })
            .from(customRecipes)
            .where(and(eq(customRecipes.familyId, familyId), eq(customRecipes.sourceUrlHash, urlHash)))
            .limit(1);
          if (existing.length > 0) {
            duplicates.push({ type: "url", source: "user", id: existing[0].id, name: existing[0].name });
          }
        }
        if (input.name) {
          const existing = await db.select({ id: customRecipes.id, name: customRecipes.name })
            .from(customRecipes)
            .where(and(eq(customRecipes.familyId, familyId), ilike(customRecipes.name, `%${esc(input.name)}%`)))
            .limit(3);
          existing.forEach((r: { id: number; name: string }) =>
            duplicates.push({ type: "name", source: "user", id: r.id, name: r.name })
          );
        }
      }

      return { hasDuplicate: duplicates.length > 0, duplicates };
    }),

  // ── List official recipes (public, all users) ──────────────────────────────
  listOfficial: publicProcedure
    .input(z.object({
      category: z.string().optional(),
      search: z.string().optional(),
      tag: z.string().optional(),
      cookTimeMax: z.number().optional(),
      limit: z.number().int().min(1).max(500).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const conditions: any[] = [eq(officialRecipes.isActive, true)];

      if (input.category) {
        conditions.push(eq(officialRecipes.recipeCategory, input.category));
      }

      if (input.search) {
        conditions.push(
          or(
            like(officialRecipes.name, `%${input.search}%`),
            like(officialRecipes.description ?? "", `%${input.search}%`),
          )
        );
      }

      if (input.tag) {
        conditions.push(like(officialRecipes.tags ?? "", `%${input.tag}%`));
      }

      if (input.cookTimeMax) {
        conditions.push(lte(officialRecipes.cookTime, input.cookTimeMax));
      }

      const rows = await db.select().from(officialRecipes)
        .where(and(...conditions))
        .orderBy(desc(officialRecipes.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return rows.map((r: typeof officialRecipes.$inferSelect) => ({
        ...r,
        ingredients: r.ingredients ? JSON.parse(r.ingredients) : [],
        steps: r.steps ? JSON.parse(r.steps) : [],
        tags: r.tags ? JSON.parse(r.tags) : [],
        source: "official" as const,
      }));
    }),

  // ── Unified search (official + family custom recipes) ──────────────────────
  search: protectedProcedure
    .input(z.object({
      query: z.string().optional(),
      category: z.string().optional(),
      tags: z.array(z.string()).optional(),
      cookTimeMax: z.number().optional(),
      popularChips: z.array(z.string()).optional(),
      ingredientCategory: z.string().optional(),  // 食材類別篩選
      source: z.enum(["all", "official", "user", "kol", "hot", "ai"]).optional(),  // 搜尋來源：all=全部(含AI)，official=只官方，user=只我的(不含AI)，kol=只 KOL，hot=熱門，ai=只AI生成
      limit: z.number().int().min(1).max(1000).default(20),
      offset: z.number().int().min(0).default(0),
      cursor: z.number().int().min(0).optional(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        if (input.source === "kol" && ctx.activeFamilyId && ctx.clientPlatform !== "native") {
          await assertProFeature(ctx.activeFamilyId, String(ctx.user.id), "kol");
        }
        const db = await getDb();
        if (!db) return { recipes: [], total: 0, officialCount: 0, customCount: 0, aiCount: 0, kolCount: 0, nextCursor: undefined };

      const offset = input.cursor ?? input.offset ?? 0;

      // 查詢解析管線：外文 → 中文 → 繁簡歸一 → 分詞（共用，供條件與排序使用）
      let searchNormalized = "";
      let searchKeywords: string[] = [];
      if (input.query && input.query.trim().length >= 1) {
        const hasForeign = /[a-z]/i.test(input.query);
        const resolved = hasForeign ? await resolveForeignToChinese(input.query) : input.query.trim().toLowerCase();
        searchNormalized = normalizeQuery(resolved);
        searchKeywords = segmentQuery(searchNormalized);
      }

      const officialConditions: any[] = [eq(officialRecipes.isActive, true)];
      const customConditions: any[] = ctx.activeFamilyId
        ? [eq(customRecipes.familyId, ctx.activeFamilyId), eq(customRecipes.isDraft, false)] // 排除草稿：令 badge 數字同可顯示嘅卡一致
        : []; // 無 familyId 時不加條件（雖然實際上唔會有 custom recipes）

      const hasForeignQuery = !!(input.query && /[a-z]/i.test(input.query));
      if (searchKeywords.length > 0) {  // 多關鍵字組合（每關鍵字再以繁/簡/同義詞 OR 擴充）
        // 雙語欄位 + 菜系：全部係「增加 OR term」（只會多命中、唔會少）；
        // 中文 token 唔會 match 英文欄位 → 中文結果只增不減（無回歸）。
        // 外文查詢用 OR（因翻譯只部分成功）；中文用 AND（保留精確度）。
        const buildKwCond = (tbl: any, kw: string) => {
          const variants = getKeywordVariants(kw);
          const fields = [
            tbl.name, tbl.description, tbl.ingredients, tbl.tags,
            tbl.nameEn, tbl.nameFil, tbl.nameId, tbl.recipeCategory,
          ];
          return or(...fields.flatMap((f: any) => variants.map(v => ilike(f, `%${v}%`))));
        };
        const kwOfficial = searchKeywords.map(kw => buildKwCond(officialRecipes, kw));
        officialConditions.push(hasForeignQuery ? or(...kwOfficial) : and(...kwOfficial));

        const kwCustom = searchKeywords.map(kw => buildKwCond(customRecipes, kw));
        customConditions.push(hasForeignQuery ? or(...kwCustom) : and(...kwCustom));
      }

      if (input.category) {
        officialConditions.push(eq(officialRecipes.recipeCategory, input.category));
        customConditions.push(eq(customRecipes.recipeCategory, input.category));
      }

      // Ingredient category filter (search by ingredient keywords)
      if (input.ingredientCategory) {
        const INGREDIENT_CATEGORIES: Record<string, string[]> = {
          meat: ["雞肉", "豬肉", "牛肉", "羊肉", "鴨肉", "排骨", "雞翼", "雞腿", "午餐肉", "香腸", "火腿", "培根", "牛柳", "牛仔骨", "牛腩", "牛腱", "豬扒", "雞胸", "肉丸", "免治牛肉", "免治豬肉"],
          seafood: ["魚", "蝦", "蟹", "三文魚", "帶子", "蜆", "蠔", "生蠔", "魷魚", "章魚", "海參", "鮑魚", "瑤柱", "魚丸", "蝦丸", "墨魚", "八爪魚", "龍蝦", "蟹柳", "蝦仁", "蝦米", "銀魚"],
          vegetable: ["菜心", "白菜", "生菜", "菠菜", "西蘭花", "椰菜", "甘藍", "芹菜", "韭菜", "蔥", "蒜", "洋蔥", "蕃茄", "番茄", "薯仔", "土豆", "紅蘿蔔", "胡蘿蔔", "青瓜", "南瓜", "茄子", "苦瓜", "冬瓜", "節瓜", "絲瓜"],
          tofu: ["豆腐", "豆乾", "豆皮", "腐竹", "油豆腐", "素雞", "豆卜", "凍豆腐"],
          egg: ["雞蛋", "鴨蛋", "鵪鶉蛋", "皮蛋", "鹹蛋", "茶葉蛋"],
          mushroom: ["香菇", "蘑菇", "金針菇", "杏鮑菇", "木耳", "靈芝", "草菇", "猴頭菇", "雞髀菇"],
          carb: ["煲仔飯", "燉飯", "炒飯", "燴飯", "蓋飯", "丼", "米飯", "白飯", "糯米飯", "撈麵", "炒麵", "湯麵", "涼麵", "米粉", "河粉", "烏冬", "意粉", "意大利粉", "饅頭", "包子", "餃子", "雲吞", "粉絲", "麵線", "腸粉", "通粉", "意麵"],
        };
        const keywords = INGREDIENT_CATEGORIES[input.ingredientCategory] || [];
        if (keywords.length > 0) {
          const conditions = keywords.map(k => like(officialRecipes.ingredients ?? "", `%${k}%`));
          officialConditions.push(or(...conditions));
          const conditionsCustom = keywords.map(k => like(customRecipes.ingredients ?? "", `%${k}%`));
          customConditions.push(or(...conditionsCustom));
        }
      }

      // Tag filters (multiple tags with AND logic) - use %"tag"% pattern for precise matching
      if (input.tags && input.tags.length > 0) {
        input.tags.forEach(tag => {
          officialConditions.push(like(officialRecipes.tags ?? "", `%"${tag}"%`));
          customConditions.push(like(customRecipes.tags ?? "", `%"${tag}"%`));
        });
      }

      if (input.cookTimeMax) {
        officialConditions.push(lte(officialRecipes.cookTime, input.cookTimeMax));
        customConditions.push(lte(customRecipes.cookTime, input.cookTimeMax));
      }

      // Popular chip filters (multiple chips with AND logic)
      if (input.popularChips && input.popularChips.length > 0) {
        input.popularChips.forEach((chip) => {
          if (chip === "quick15") {
            officialConditions.push(lte(officialRecipes.cookTime, 15));
            customConditions.push(lte(customRecipes.cookTime, 15));
          }
          if (chip === "quick30") {
            officialConditions.push(lte(officialRecipes.cookTime, 30));
            customConditions.push(lte(customRecipes.cookTime, 30));
          }
          if (chip === "tonight") {
            officialConditions.push(or(
              eq(officialRecipes.recipeCategory, "中菜"),
              like(officialRecipes.tags ?? "", "%家常%")
            ));
            customConditions.push(or(
              eq(customRecipes.recipeCategory, "中菜"),
              like(customRecipes.tags ?? "", "%家常%")
            ));
          }
          if (chip === "hk-style") {
            officialConditions.push(like(officialRecipes.tags ?? "", "%港式%"));
            customConditions.push(like(customRecipes.tags ?? "", "%港式%"));
          }
          if (chip === "kids") {
            officialConditions.push(or(
              like(officialRecipes.tags ?? "", "%小朋友%"),
              and(
                eq(officialRecipes.difficulty, "簡單"),
                not(like(officialRecipes.ingredients ?? "", "%辣椒%")),
                not(like(officialRecipes.ingredients ?? "", "%胡椒%")),
                not(like(officialRecipes.ingredients ?? "", "%花椒%")),
                not(like(officialRecipes.steps ?? "", "%炸%"))
              )
            ));
            customConditions.push(or(
              like(customRecipes.tags ?? "", "%小朋友%"),
              and(
                eq(customRecipes.difficulty, "簡單"),
                not(like(customRecipes.ingredients ?? "", "%辣椒%")),
                not(like(customRecipes.ingredients ?? "", "%胡椒%")),
                not(like(customRecipes.ingredients ?? "", "%花椒%")),
                not(like(customRecipes.steps ?? "", "%炸%"))
              )
            ));
          }
          if (chip === "vegetarian") {
            const meatKeywords = [
              "雞肉", "牛肉", "豬肉", "羊肉", "鴨肉", "肉",
              "牛柳", "牛仔骨", "牛腱", "牛腩",
              "三文魚", "魚柳", "魚肉", "魚片",
              "蝦仁", "蝦肉", "蝦米",
              "蟹肉", "蟹柳",
              "排骨", "雞翼", "雞腿", "雞扒", "雞胸",
              "午餐肉", "香腸", "火腿", "培根", "肉丸",
              "帶子", "蜆肉", "蠔", "魷魚", "章魚",
              "燒鴨", "豬扒", "豬排", "豬手", "豬腳",
              "羊排", "羊腿", "鮑魚", "海參",
              "吞拿魚", "鯖魚", "秋刀魚", "西冷",
              "叉燒", "臘肉", "臘腸", "雞雜", "豬雜",
              "蛙", "蛇", "水魚", "田雞",
            ];
            const hasMeatConditions = meatKeywords.map(k => like(officialRecipes.ingredients ?? "", `%${k}%`));
            officialConditions.push(or(
              like(officialRecipes.tags ?? "", "%素食%"),
              eq(officialRecipes.recipeCategory, "素食"),
              and(...meatKeywords.map(k => not(like(officialRecipes.ingredients ?? "", `%${k}%`))))
            ));
            const hasMeatConditionsCustom = meatKeywords.map(k => like(customRecipes.ingredients ?? "", `%${k}%`));
            customConditions.push(or(
              like(customRecipes.tags ?? "", "%素食%"),
              eq(customRecipes.recipeCategory, "素食"),
              and(...meatKeywords.map(k => not(like(customRecipes.ingredients ?? "", `%${k}%`))))
            ));
          }
          if (chip === "light") {
            officialConditions.push(or(
              like(officialRecipes.tags ?? "", "%清淡%"),
              like(officialRecipes.tags ?? "", "%健康%"),
              like(officialRecipes.tags ?? "", "%少油%")
            ));
            customConditions.push(or(
              like(customRecipes.tags ?? "", "%清淡%"),
              like(customRecipes.tags ?? "", "%健康%"),
              like(customRecipes.tags ?? "", "%少油%")
            ));
          }
          if (chip === "one-person") {
            officialConditions.push(lte(officialRecipes.servings, 2));
            customConditions.push(lte(customRecipes.servings, 2));
          }
          if (chip === "high-protein") {
            const proteinKeywords = [
              "雞肉", "牛肉", "豬肉", "羊肉",
              "牛柳", "牛仔骨", "牛腱", "牛腩",
              "三文魚", "魚柳", "魚肉", "魚片",
              "蝦仁", "蝦肉", "蝦米",
              "蟹肉", "蟹柳",
              "豆腐", "豆乾", "雞蛋", "鴨蛋",
              "排骨", "雞翼", "雞腿", "雞扒", "雞胸",
              "午餐肉", "香腸", "火腿", "培根", "肉丸",
              "帶子", "蜆肉", "蠔", "魚", "章魚",
              "鴨肉", "燒鴨", "鵝肉",
              "豬扒", "豬排", "豬手", "豬腳",
              "羊排", "羊腿",
              "鮑魚", "海參", "魚翅",
              "吞拿魚", "鯖魚", "秋刀魚",
            ];
            const conditions = proteinKeywords.map(k => like(officialRecipes.ingredients ?? "", `%${k}%`));
            officialConditions.push(or(...conditions));
            const conditionsCustom = proteinKeywords.map(k => like(customRecipes.ingredients ?? "", `%${k}%`));
            customConditions.push(or(...conditionsCustom));
          }
          if (chip === "soup") {
            officialConditions.push(or(
              eq(officialRecipes.recipeCategory, "湯水"),
              like(officialRecipes.name, "%湯%"),
              like(officialRecipes.tags ?? "", "%湯水%")
            ));
            customConditions.push(or(
              eq(customRecipes.recipeCategory, "湯水"),
              like(customRecipes.name, "%湯%"),
              like(customRecipes.tags ?? "", "%湯水%")
            ));
          }
          if (chip === "fridge") {
            officialConditions.push(or(
              like(officialRecipes.tags ?? "", "%家常%"),
              like(officialRecipes.tags ?? "", "%簡單%")
            ));
            customConditions.push(or(
              like(customRecipes.tags ?? "", "%家常%"),
              like(customRecipes.tags ?? "", "%簡單%")
            ));
          }
          if (chip === "beginner") {
            officialConditions.push(and(
              eq(officialRecipes.difficulty, "簡單"),
              or(
                like(officialRecipes.tags ?? "", "%新手%"),
                like(officialRecipes.tags ?? "", "%基礎%")
              )
            ));
            customConditions.push(and(
              eq(customRecipes.difficulty, "簡單"),
              or(
                like(customRecipes.tags ?? "", "%新手%"),
                like(customRecipes.tags ?? "", "%基礎%")
              )
            ));
          }
          if (chip === "party") {
            officialConditions.push(or(
              gte(officialRecipes.servings, 4),
              like(officialRecipes.tags ?? "", "%宴客%")
            ));
            customConditions.push(or(
              gte(customRecipes.servings, 4),
              like(customRecipes.tags ?? "", "%宴客%")
            ));
          }
          if (chip === "low-calorie") {
            officialConditions.push(or(
              like(officialRecipes.tags ?? "", "%低卡%"),
              like(officialRecipes.tags ?? "", "%減肥%")
            ));
            customConditions.push(or(
              like(customRecipes.tags ?? "", "%低卡%"),
              like(customRecipes.tags ?? "", "%減肥%")
            ));
          }
          if (chip === "3d1s") {
            officialConditions.push(eq(officialRecipes.recipeCategory, "中菜"));
            customConditions.push(eq(customRecipes.recipeCategory, "中菜"));
          }
          if (chip === "steamed") {
            officialConditions.push(like(officialRecipes.tags ?? "", "%蒸%"));
            customConditions.push(like(customRecipes.tags ?? "", "%蒸%"));
          }
          if (chip === "stir-fry") {
            officialConditions.push(like(officialRecipes.tags ?? "", "%炒%"));
            customConditions.push(like(customRecipes.tags ?? "", "%炒%"));
          }
        });
      }

      // Build relevance score for search ranking (name > description > ingredients > tags)
      const orderByOfficial: any[] = [];
      const orderByCustom: any[] = [];

      if (searchKeywords.length > 0) {  // 相關度排序：精確 > 歸一化 > 首個關鍵字（含變體）
        const firstKeyword = searchKeywords[0];
        const variants = getKeywordVariants(firstKeyword);

        const exactPattern = `%${(input.query ?? "").trim()}%`;
        const normPattern = `%${searchNormalized}%`;
        const firstPatterns = variants.map(v => `%${v}%`);

        const relevanceScore = sql`CASE
            WHEN ${officialRecipes.name} ILIKE ${exactPattern} THEN 25
            WHEN ${officialRecipes.name} ILIKE ${normPattern} THEN 20
            WHEN ${officialRecipes.name} ILIKE ${firstPatterns[0]} THEN 10
            WHEN ${officialRecipes.description} ILIKE ${firstPatterns[0]} THEN 5
            WHEN ${officialRecipes.ingredients} ILIKE ${firstPatterns[0]} THEN 2
            WHEN ${officialRecipes.tags} ILIKE ${firstPatterns[0]} THEN 2
            ELSE 0
          END`;
        orderByOfficial.push(desc(relevanceScore));

        const relevanceScoreCustom = sql`CASE
            WHEN ${customRecipes.name} ILIKE ${exactPattern} THEN 25
            WHEN ${customRecipes.name} ILIKE ${normPattern} THEN 20
            WHEN ${customRecipes.name} ILIKE ${firstPatterns[0]} THEN 10
            WHEN ${customRecipes.description} ILIKE ${firstPatterns[0]} THEN 5
            WHEN ${customRecipes.ingredients} ILIKE ${firstPatterns[0]} THEN 2
            WHEN ${customRecipes.tags} ILIKE ${firstPatterns[0]} THEN 2
            ELSE 0
          END`;
        orderByCustom.push(desc(relevanceScoreCustom));
      }

      // Then sort by popularity and created_at
      orderByOfficial.push(desc(officialRecipes.popularity));
      orderByOfficial.push(desc(officialRecipes.createdAt));

      orderByCustom.push(desc(customRecipes.popularity));
      orderByCustom.push(desc(customRecipes.createdAt));

      // 根據 source 參數決定是否查詢官方/自訂食譜
      const isHotQuery = input.source === "hot";
      const isAiQuery = input.source === "ai";
      const shouldQueryOfficial = !input.source || input.source === "all" || input.source === "official" || isHotQuery;
      let shouldQueryCustom = !input.source || input.source === "all" || input.source === "user" || isHotQuery;

      // KOL（網紅食譜）：全局公共內容，只查 sourceType = 'kol'，唔綁 activeFamilyId。
      // 用戶自己由 IG/YouTube 匯入嘅食譜屬於「我的食譜」，唔應該出現喺 KOL。
      const isKolQuery = input.source === "kol";
      if (isKolQuery) shouldQueryCustom = true;
      if (isAiQuery) shouldQueryCustom = true;
      // 「我的」(user) 排除 AI；「全部」(all) 含 AI；「AI」(ai) 只 AI。
      const aiExclude = eq(customRecipes.isAiGenerated, false);
      const aiOnly = eq(customRecipes.isAiGenerated, true);
      const effectiveCustomConditions: any[] = isKolQuery
        ? [eq(customRecipes.sourceType, "kol")]
        : isHotQuery
          ? [eq(customRecipes.visibility, "public")]
          : isAiQuery
            ? [...customConditions, aiOnly]
            : (input.source === "user" ? [...customConditions, aiExclude] : customConditions);

      // 先計算總數，再用於精確分頁（單一清單 offset 分頁）
      let totalOfficial = 0;
      let totalCustom = 0;

      if (shouldQueryOfficial) {
        const totalOfficialResult = await db.select({ count: count() })
          .from(officialRecipes)
          .where(officialConditions.length > 1 ? and(...officialConditions) : officialConditions[0]);
        totalOfficial = Number(totalOfficialResult[0]?.count ?? 0);
      }

      if (shouldQueryCustom) {
        const totalCustomResult = await db.select({ count: count() })
          .from(customRecipes)
          .where(effectiveCustomConditions.length > 0 ? (effectiveCustomConditions.length > 1 ? and(...effectiveCustomConditions) : effectiveCustomConditions[0]) : undefined);
        totalCustom = Number(totalCustomResult[0]?.count ?? 0);
      }

      const total = totalOfficial + totalCustom;

      // ── Badge counts（來源無關）：令「我的/官方/KOL」數字係各來源真實總數，
      // 唔會因當前 source（如熱門=public）或分頁而顯示錯誤數字。
      const badgeOfficial = Number((await db.select({ count: count() }).from(officialRecipes)
        .where(officialConditions.length > 1 ? and(...officialConditions) : officialConditions[0]))[0]?.count ?? 0);
      const badgeCustom = ctx.activeFamilyId && customConditions.length > 0
        ? Number((await db.select({ count: count() }).from(customRecipes)
            .where(and(...customConditions, aiExclude)))[0]?.count ?? 0)
        : 0;
      const aiCount = ctx.activeFamilyId && customConditions.length > 0
        ? Number((await db.select({ count: count() }).from(customRecipes)
            .where(and(...customConditions, aiOnly)))[0]?.count ?? 0)
        : 0;
      const kolCount = Number((await db.select({ count: count() }).from(customRecipes)
        .where(eq(customRecipes.sourceType, "kol")))[0]?.count ?? 0);

      // 合併清單順序 = 官方（前） + 自製（後）。依全域 offset 推導各自分頁範圍，
      // 確保每頁恰好回傳 limit 筆，不再每頁 2× limit。
      const officialOffset = Math.min(offset, totalOfficial);
      const officialLimit = Math.max(0, Math.min(input.limit, totalOfficial - officialOffset));
      const customOffset = Math.max(0, offset - totalOfficial);
      const customLimit = input.limit - officialLimit;

      // Query official recipes
      const officialRows = shouldQueryOfficial && officialLimit > 0
        ? await db.select().from(officialRecipes)
          .where(officialConditions.length > 1 ? and(...officialConditions) : officialConditions[0])
          .orderBy(...orderByOfficial)
          .limit(officialLimit)
          .offset(officialOffset)
        : [];

      // Query custom recipes (family-scoped)
      const customRows = shouldQueryCustom && customLimit > 0 && effectiveCustomConditions.length > 0
        ? await db.select().from(customRecipes)
          .where(effectiveCustomConditions.length > 1 ? and(...effectiveCustomConditions) : effectiveCustomConditions[0])
          .orderBy(...orderByCustom)
          .limit(customLimit)
          .offset(customOffset)
        : [];

      // Combine and format
      const recipes = [
        ...officialRows.map((r) => ({
          id: `official_${r.id}`,
          source: "official" as const,
          name: r.name,
          nameEn: r.nameEn,
          nameFil: r.nameFil,
          nameId: r.nameId,
          description: r.description,
          image: r.image || r.thumbnailUrl,
          thumbnailUrl: r.thumbnailUrl,
          cookTime: r.cookTime,
          servings: r.servings,
          difficulty: r.difficulty,
          recipeCategory: r.recipeCategory,
          ingredients: r.ingredients ? (() => {
            try {
              return JSON.parse(r.ingredients);
            } catch (e) {
              console.error(`Failed to parse ingredients for recipe ${r.id}:`, e);
              return [];
            }
          })() : [],
          steps: r.steps ? (() => {
            try {
              return JSON.parse(r.steps);
            } catch (e) {
              console.error(`Failed to parse steps for recipe ${r.id}:`, e);
              return [];
            }
          })() : [],
          stepsEn: r.stepsEn ? (() => { try { return JSON.parse(r.stepsEn!); } catch { return []; } })() : [],
          stepsFil: r.stepsFil ? (() => { try { return JSON.parse(r.stepsFil!); } catch { return []; } })() : [],
          stepsId: r.stepsId ? (() => { try { return JSON.parse(r.stepsId!); } catch { return []; } })() : [],
          tags: r.tags ? (() => {
            try {
              return JSON.parse(r.tags);
            } catch (e) {
              console.error(`Failed to parse tags for recipe ${r.id}:`, e);
              return [];
            }
          })() : [],
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
        ...customRows.map((r) => ({
          id: `user_${r.id}`,
          source: "custom" as const,
          name: r.name,
          nameEn: r.nameEn,
          nameFil: r.nameFil,
          nameId: r.nameId,
          description: r.description,
          sourceAuthor: r.sourceAuthor,
          sourceType: r.sourceType,
          sourceUrl: r.sourceUrl,
          image: r.image || r.thumbnailUrl,
          thumbnailUrl: r.thumbnailUrl,
          cookTime: r.cookTime,
          servings: r.servings,
          difficulty: r.difficulty,
          recipeCategory: r.recipeCategory,
          ingredients: r.ingredients ? (() => {
            try {
              return JSON.parse(r.ingredients);
            } catch (e) {
              console.error(`Failed to parse ingredients for recipe ${r.id}:`, e);
              return [];
            }
          })() : [],
          steps: r.steps ? (() => {
            try {
              return JSON.parse(r.steps);
            } catch (e) {
              console.error(`Failed to parse steps for recipe ${r.id}:`, e);
              return [];
            }
          })() : [],
          stepsEn: r.stepsEn ? (() => { try { return JSON.parse(r.stepsEn!); } catch { return []; } })() : [],
          stepsFil: r.stepsFil ? (() => { try { return JSON.parse(r.stepsFil!); } catch { return []; } })() : [],
          stepsId: r.stepsId ? (() => { try { return JSON.parse(r.stepsId!); } catch { return []; } })() : [],
          tags: r.tags ? (() => {
            try {
              return JSON.parse(r.tags);
            } catch (e) {
              console.error(`Failed to parse tags for recipe ${r.id}:`, e);
              return [];
            }
          })() : [],
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
      ];

      // Calculate next cursor (global combined offset)
      const hasMore = offset + input.limit < total;
      const nextCursor = hasMore ? offset + input.limit : undefined;

      return { recipes, total, officialCount: badgeOfficial, customCount: badgeCustom, aiCount, kolCount, nextCursor };
      } catch (error) {
        console.error("[recipes.search] Error:", {
          error: error instanceof Error ? error.message : error,
          input,
          stack: error instanceof Error ? error.stack : undefined,
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `搜尋失敗：${error instanceof Error ? error.message : "未知錯誤"}`,
        });
      }
    }),

  // ── Generate official recipes via AI (Admin only, temporary) ────────────────
  generateOfficial: protectedProcedure
    .input(z.object({
      category: z.string().optional(),
      count: z.number().int().min(1).max(5).default(5),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Admin only" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const category = input.category || "中菜";
      const count = input.count;

      const systemPrompt = `你是一個專業的食譜創作專家。請生成 ${count} 個獨特、實用、適合香港家庭的 ${category} 食譜。

要求：
1. 每個食譜名稱必須獨特，唔准重複
2. 唔准用「XX（家常版）」、「XX（快手版）」等後綴
3. 食材要實用、容易買到
4. 做法要詳細、清晰
5. 份量適合 2-4 人家庭
6. 所有文字使用繁體中文
7. 避免重複食材組合，每個食譜要有特色

回傳 JSON array 格式，每個食譜包含：
{
  "name": "食譜名稱",
  "description": "簡短描述（1-2句）",
  "cookTime": 烹飪時間（分鐘，整數）,
  "servings": 份量（人數，整數）,
  "difficulty": "簡單" | "中等" | "困難",
  "recipeCategory": "${category}",
  "ingredients": [
    { "name": "食材名", "quantity": "數量", "unit": "單位", "category": "肉類/海鮮/蔬菜/調味料/乾貨/其他" }
  ],
  "steps": [
    { "instruction": "步驟說明", "duration": 分鐘（整數）}
  ],
  "tags": ["標籤1", "標籤2"]
}`;

      const userPrompt = `請生成 ${count} 個獨特嘅 ${category} 食譜。確保每個食譜都係真正唔同嘅菜式，唔好重複。`;

      const response = await invokeLLM({
    // Parse/vision + long 4-language JSON can exceed the 15s default; give it room.
    timeoutMs: 45000,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        responseFormat: {
          type: "json_schema",
          json_schema: {
            name: "recipe_batch",
            strict: true,
            schema: {
              type: "object",
              properties: {
                recipes: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      description: { type: "string" },
                      cookTime: { type: "integer" },
                      servings: { type: "integer" },
                      difficulty: { type: "string" },
                      recipeCategory: { type: "string" },
                      ingredients: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            name: { type: "string" },
                            quantity: { type: "string" },
                            unit: { type: "string" },
                            category: { type: "string" },
                          },
                          required: ["name", "quantity", "unit", "category"],
                        },
                      },
                      steps: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            instruction: { type: "string" },
                            duration: { type: "integer" },
                          },
                          required: ["instruction", "duration"],
                        },
                      },
                      tags: { type: "array", items: { type: "string" } },
                    },
                    required: ["name", "description", "cookTime", "servings", "difficulty", "recipeCategory", "ingredients", "steps", "tags"],
                  },
                },
              },
              required: ["recipes"],
            },
          },
        },
      });

      const rawContent = response.choices[0]?.message?.content;
      const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
      if (!content) throw new Error("AI returned empty response");

      const parsed = extractJSON(content) as { recipes: any[] };
      if (!parsed.recipes || !Array.isArray(parsed.recipes)) {
        throw new Error("Invalid response format");
      }

      const inserted: number[] = [];
      for (const recipe of parsed.recipes) {
        const [row] = await db.insert(officialRecipes).values({
          importedByUserId: "ai-generator",
          name: recipe.name,
          description: recipe.description,
          image: null,
          thumbnailUrl: null,
          cookTime: recipe.cookTime,
          servings: recipe.servings,
          difficulty: recipe.difficulty,
          recipeCategory: recipe.recipeCategory || category,
          dishType: recipe.dishType || (await classifyRecipeDishTypeLLM({
            name: recipe.name,
            description: recipe.description,
            ingredients: recipe.ingredients,
            tags: recipe.tags,
            category: recipe.recipeCategory || category,
          })),
            ingredients: await withIngredientTranslations(recipe.ingredients),
          steps: JSON.stringify(recipe.steps),
          tags: JSON.stringify(recipe.tags || []),
          sourceType: "manual",
          sourceUrl: null,
          sourceUrlHash: null,
          sourceAuthor: null,
          scenarioTags: computeScenarioTags({
            name: recipe.name, description: recipe.description, cookTime: recipe.cookTime,
            difficulty: recipe.difficulty, recipeCategory: recipe.recipeCategory,
            dishType: recipe.dishType, ingredients: recipe.ingredients, steps: recipe.steps, tags: recipe.tags,
          }),
        }).returning();
        inserted.push(row.id);
      }

      return { count: inserted.length, ids: inserted };
    }),

  // ── Import official recipe (Admin only) ────────────────────────────────────
  importOfficial: protectedProcedure
    .input(recipeInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Admin only" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const urlHash = input.sourceUrl ? hashUrl(input.sourceUrl) : null;
      if (urlHash) {
        const existing = await db.select({ id: officialRecipes.id })
          .from(officialRecipes)
          .where(eq(officialRecipes.sourceUrlHash, urlHash))
          .limit(1);
        if (existing.length > 0) {
          throw new TRPCError({ code: "CONFLICT", message: "此食譜 URL 已存在於官方食譜庫" });
        }
      }

      // Download and re-upload thumbnail to S3 to avoid IG/external CDN expiry
      let resolvedOfficialThumbnailUrl = input.image || input.thumbnailUrl || "";
      const rawOfficialThumb = input.thumbnailUrl || input.image || "";
      if (rawOfficialThumb && !rawOfficialThumb.startsWith("/manus-storage/")) {
        try {
          const imgResp = await fetch(rawOfficialThumb, {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
              "Referer": "https://www.instagram.com/",
            },
            signal: AbortSignal.timeout(10000),
          });
          if (imgResp.ok) {
            const contentType = imgResp.headers.get("content-type") || "image/jpeg";
            const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
            const arrayBuf = await imgResp.arrayBuffer();
            const buf = Buffer.from(arrayBuf);
            const key = `recipe-thumbnails/official-${ctx.user.id}-${Date.now()}.${ext}`;
            const { url } = await storagePut(key, buf, contentType);
            const backendHost = process.env.RAILWAY_PUBLIC_DOMAIN;
            resolvedOfficialThumbnailUrl = url.startsWith("/") && backendHost ? `https://${backendHost}${url}` : url;
          }
        } catch {
          // If download fails, keep original URL as fallback
        }
      }

      const _stepsArrO = Array.isArray(input.steps) ? input.steps.map((s: any) => typeof s === "string" ? s : (s.instruction ?? "")) : [];
      const _trO = await translateRecipeContent(input.name, _stepsArrO, input.description);
      const [inserted] = await db.insert(officialRecipes).values({
        importedByUserId: String(ctx.user.id),
        name: input.name,
        nameEn: _trO.nameEn,
        nameFil: _trO.nameFil,
        nameId: _trO.nameId,
        description: input.description,
        descriptionEn: _trO.descriptionEn,
        descriptionFil: _trO.descriptionFil,
        descriptionId: _trO.descriptionId,
        image: resolvedOfficialThumbnailUrl,
        thumbnailUrl: resolvedOfficialThumbnailUrl,
        cookTime: input.cookTime,
        servings: input.servings,
        difficulty: input.difficulty,
        recipeCategory: input.recipeCategory,
        ingredients: await withIngredientTranslations(input.ingredients),
        steps: JSON.stringify(input.steps),
        stepsEn: _trO.stepsEn ? JSON.stringify(_trO.stepsEn) : undefined,
        stepsFil: _trO.stepsFil ? JSON.stringify(_trO.stepsFil) : undefined,
        stepsId: _trO.stepsId ? JSON.stringify(_trO.stepsId) : undefined,
        tags: JSON.stringify(cleanTags(input.tags || [])),
        sourceType: input.sourceUrl ? detectSourceType(input.sourceUrl) : "manual",
        sourceUrl: input.sourceUrl,
        sourceUrlHash: urlHash ?? undefined,
        sourceAuthor: input.sourceAuthor,
        scenarioTags: computeScenarioTags({
          name: input.name, description: input.description, cookTime: input.cookTime,
          difficulty: input.difficulty, recipeCategory: input.recipeCategory,
          dishType: input.dishType, ingredients: input.ingredients, steps: input.steps, tags: input.tags,
        }),
      }).returning();

      return { success: true, id: inserted.id };
    }),

  // ── Batch import official recipes (Admin only) ─────────────────────────────
  batchImportOfficial: protectedProcedure
    .input(z.object({ recipes: z.array(recipeInputSchema) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Admin only" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const results: { name: string; status: "imported" | "duplicate" | "error"; error?: string }[] = [];

      for (const recipe of input.recipes) {
        try {
          const urlHash = recipe.sourceUrl ? hashUrl(recipe.sourceUrl) : null;
          if (urlHash) {
            const existing = await db.select({ id: officialRecipes.id })
              .from(officialRecipes)
              .where(eq(officialRecipes.sourceUrlHash, urlHash))
              .limit(1);
            if (existing.length > 0) {
              results.push({ name: recipe.name, status: "duplicate" });
              continue;
            }
          }
          await db.insert(officialRecipes).values({
            importedByUserId: String(ctx.user.id),
            name: recipe.name,
            description: recipe.description,
            image: recipe.image || recipe.thumbnailUrl,
            thumbnailUrl: recipe.thumbnailUrl,
            cookTime: recipe.cookTime,
            servings: recipe.servings,
            difficulty: recipe.difficulty,
            recipeCategory: recipe.recipeCategory,
          ingredients: await withIngredientTranslations(recipe.ingredients),
            steps: JSON.stringify(recipe.steps),
            tags: JSON.stringify(recipe.tags || []),
            sourceType: recipe.sourceUrl ? detectSourceType(recipe.sourceUrl) : "manual",
            sourceUrl: recipe.sourceUrl,
            sourceUrlHash: urlHash ?? undefined,
            sourceAuthor: recipe.sourceAuthor,
            scenarioTags: computeScenarioTags({
              name: recipe.name, description: recipe.description, cookTime: recipe.cookTime,
              difficulty: recipe.difficulty, recipeCategory: recipe.recipeCategory,
              dishType: recipe.dishType, ingredients: recipe.ingredients, steps: recipe.steps, tags: recipe.tags,
            }),
            isActive: true,
          });
          results.push({ name: recipe.name, status: "imported" });
        } catch (err) {
          results.push({ name: recipe.name, status: "error", error: String(err) });
        }
      }

      return {
        total: input.recipes.length,
        imported: results.filter(r => r.status === "imported").length,
        duplicates: results.filter(r => r.status === "duplicate").length,
        errors: results.filter(r => r.status === "error").length,
        results,
      };
    }),

  // ── Import user recipe ──────────────────────────────────────────────────────
  importUser: protectedProcedure
    .input(recipeInputSchema.extend({
      visibility: z.enum(["private", "pending_public"]).default("private"),
      isAiGenerated: z.boolean().optional(),
      inputLang: z.string().optional(),
      // 用戶主動「先儲存（名＋連結）」時允許無食材/步驟，仍標記為未完整（讀取時依內容判斷）
      allowIncomplete: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      const familyId = ctx.activeFamilyId;
      const userId = String(ctx.user.id);
      const ent = await getFamilyEntitlements(familyId, userId);
      if (!ent) throw new TRPCError({ code: "NOT_FOUND", message: "找不到家庭廚房" });
      if (ent.readOnly) throw new TRPCError({ code: "FORBIDDEN", message: "你目前只可檢視此廚房。" });

      let reservationId: number | undefined;
      if (!input.isAiGenerated) {
        try {
          const reservation = await reserveUsage({
            familyId,
            userId,
            kind: "import",
            limits: ent.limits,
            idempotencyKey: `import:${familyId}:${userId}:${crypto.randomUUID()}`,
            cost: { credits: 1, imports: 1 },
          });
          reservationId = reservation.eventId;
        } catch (error) {
          usageLimitToTRPC(error);
        }
      }

      try {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const urlHash = input.sourceUrl ? hashUrl(input.sourceUrl) : null;
      if (urlHash) {
        const existing = await db.select({ id: customRecipes.id })
          .from(customRecipes)
          .where(and(eq(customRecipes.familyId, ctx.activeFamilyId), eq(customRecipes.sourceUrlHash, urlHash)))
          .limit(1);
        if (existing.length > 0) {
          throw new TRPCError({ code: "CONFLICT", message: "此食譜已在你的食譜庫中" });
        }
      }

      // Download and re-upload thumbnail to avoid IG/external CDN hotlink protection
      let resolvedThumbnailUrl = input.image || input.thumbnailUrl || "";
      const rawThumb = input.thumbnailUrl || input.image || "";
      const isManusStorage = rawThumb.includes(".r2.cloudflarestorage.com/") ||
        rawThumb.includes("/r2-storage/") ||
        (process.env.R2_PUBLIC_URL && rawThumb.startsWith(process.env.R2_PUBLIC_URL));
      if (rawThumb && !isManusStorage && !rawThumb.startsWith("/r2-storage/")) {
        try {
          await assertSafeUrl(rawThumb); // SSRF 防護：唔准指向內網/本機
          const imgResp = await fetch(rawThumb, {
            headers: {
              "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
              "Referer": "https://www.instagram.com/",
              "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
              "Sec-Fetch-Site": "cross-site",
              "Sec-Fetch-Mode": "no-cors",
            },
            signal: AbortSignal.timeout(10000),
          });
          if (imgResp.ok) {
            const contentType = imgResp.headers.get("content-type") || "image/jpeg";
            const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
            const arrayBuf = await imgResp.arrayBuffer();
            const buf = Buffer.from(arrayBuf);
            const key = `recipe-thumbnails/user-${ctx.user.id}-${Date.now()}.${ext}`;
            const { url } = await storagePut(key, buf, contentType);
            const backendHost = process.env.RAILWAY_PUBLIC_DOMAIN;
            resolvedThumbnailUrl = url.startsWith("/") && backendHost ? `https://${backendHost}${url}` : url;
          }
        } catch {
          // If download fails, keep original URL as fallback
        }
      }

      // 守門：唔准存入「無名」食譜。無食材又無步驟 → 只有用戶主動 allowIncomplete（先儲存名＋連結）才放行。
      if (!String(input.name ?? "").trim()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "請輸入食譜名稱。" });
      }
      const _hasIngredients = Array.isArray(input.ingredients) && input.ingredients.some((i: any) => String(i?.name ?? "").trim());
      const _hasSteps = Array.isArray(input.steps) && input.steps.some((s: any) => String(typeof s === "string" ? s : (s?.instruction ?? "")).trim());
      if (!_hasIngredients && !_hasSteps && !input.allowIncomplete) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "食譜內容不足（沒有食材或步驟），請手動輸入。" });
      }

      // 速度：只有「4 語言齊全」先跳過翻譯；否則由作者語言 buildAllLangs 補齊（保證中文 base + en/fil/id）
      const hasAll =
        !!input.nameEn && !!input.nameFil && !!input.nameId &&
        (!!input.stepsEn && input.stepsEn.length > 0) &&
        (!!input.stepsFil && input.stepsFil.length > 0) &&
        (!!input.stepsId && input.stepsId.length > 0);

      let baseName = input.name;
      let baseDesc = input.description ?? "";
      let baseSteps: any[] = input.steps;
      let baseIngredients: any[] = input.ingredients;
      let _tr: any;
      if (hasAll) {
        _tr = {
          nameEn: input.nameEn, nameFil: input.nameFil, nameId: input.nameId,
          descriptionEn: input.descriptionEn, descriptionFil: input.descriptionFil, descriptionId: input.descriptionId,
          stepsEn: input.stepsEn, stepsFil: input.stepsFil, stepsId: input.stepsId,
        };
      } else {
        // Degrade gracefully: if translation fails, still save the canonical base
        // (missing locales are filled later by buildTranslationPatch on read).
        try {
          const built = await buildAllLangs({
            name: input.name, description: input.description, steps: input.steps,
            ingredients: input.ingredients, srcLang: input.inputLang,
          });
          baseName = built.name; baseDesc = built.description; baseSteps = built.steps; baseIngredients = built.ingredients;
          _tr = built;
        } catch (e) {
          console.warn("[importUser] buildAllLangs failed; saving canonical base only:", (e as Error)?.message);
          _tr = {};
        }
      }

      const [inserted] = await db.insert(customRecipes).values({
        familyId: ctx.activeFamilyId,
        createdByUserId: String(ctx.user.id),
        name: baseName,
        nameEn: _tr.nameEn,
        nameFil: _tr.nameFil,
        nameId: _tr.nameId,
        description: baseDesc,
        descriptionEn: _tr.descriptionEn,
        descriptionFil: _tr.descriptionFil,
        descriptionId: _tr.descriptionId,
        image: resolvedThumbnailUrl,
        thumbnailUrl: resolvedThumbnailUrl,
        cookTime: input.cookTime,
        servings: input.servings,
        difficulty: normalizeDifficulty(input.difficulty),
        recipeCategory: input.recipeCategory,
        dishType: input.dishType || (await classifyRecipeDishTypeLLM({
          name: baseName,
          description: baseDesc,
          ingredients: baseIngredients,
          tags: input.tags,
          category: input.recipeCategory,
        })),
        ingredients: await withIngredientTranslations(baseIngredients),
        steps: JSON.stringify(baseSteps),
        stepsEn: _tr.stepsEn ? JSON.stringify(_tr.stepsEn) : undefined,
        stepsFil: _tr.stepsFil ? JSON.stringify(_tr.stepsFil) : undefined,
        stepsId: _tr.stepsId ? JSON.stringify(_tr.stepsId) : undefined,
        tags: JSON.stringify(cleanTags(input.tags || [])),
        sourceType: input.sourceUrl ? detectSourceType(input.sourceUrl) : "manual",
        sourceUrl: input.sourceUrl,
        sourceUrlHash: urlHash ?? undefined,
        sourceAuthor: input.sourceAuthor,
        visibility: input.visibility,
        isAiGenerated: input.isAiGenerated ?? false,
        scenarioTags: computeScenarioTags({
          name: baseName, description: baseDesc, cookTime: input.cookTime,
          difficulty: input.difficulty, recipeCategory: input.recipeCategory,
          dishType: input.dishType, ingredients: baseIngredients, steps: baseSteps, tags: input.tags,
        }),
      }).returning();

      if (reservationId) await commitUsage(reservationId);

      return { success: true, id: inserted.id };
      } catch (error) {
        if (reservationId) await refundUsage(reservationId).catch(() => {});
        usageLimitToTRPC(error);
      }
    }),

  // ── List user's own recipes ─────────────────────────────────────────────────
  listUser: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(500).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) return [];
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select().from(customRecipes)
        .where(eq(customRecipes.familyId, ctx.activeFamilyId))
        .orderBy(desc(customRecipes.createdAt))
        .limit(input.limit)
        .offset(input.offset);
      return rows.map((r: typeof customRecipes.$inferSelect) => ({
        ...r,
        ingredients: r.ingredients ? JSON.parse(r.ingredients) : [],
        steps: r.steps ? JSON.parse(r.steps) : [],
        stepsEn: r.stepsEn ? (() => { try { return JSON.parse(r.stepsEn!); } catch { return []; } })() : [],
        stepsFil: r.stepsFil ? (() => { try { return JSON.parse(r.stepsFil!); } catch { return []; } })() : [],
        stepsId: r.stepsId ? (() => { try { return JSON.parse(r.stepsId!); } catch { return []; } })() : [],
        tags: r.tags ? JSON.parse(r.tags) : [],
        source: "user" as const,
      }));
    }),

  // ── List all public recipes (official + approved user) ─────────────────────
  listPublic: publicProcedure
    .input(z.object({
      category: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const official = await db.select().from(officialRecipes)
        .where(eq(officialRecipes.isActive, true))
        .orderBy(desc(officialRecipes.createdAt))
        .limit(input.limit);

      const userPublic = await db.select().from(customRecipes)
        .where(eq(customRecipes.visibility, "public"))
        .orderBy(desc(customRecipes.createdAt))
        .limit(input.limit);

      const all = [
        ...official.map((r: typeof officialRecipes.$inferSelect) => ({
          id: `official_${r.id}`,
          name: r.name,
          description: r.description,
          image: r.image,
          thumbnailUrl: r.thumbnailUrl,
          cookTime: r.cookTime,
          servings: r.servings,
          difficulty: r.difficulty,
          recipeCategory: r.recipeCategory,
          ingredients: r.ingredients ? JSON.parse(r.ingredients) : [],
          steps: r.steps ? JSON.parse(r.steps) : [],
          tags: r.tags ? JSON.parse(r.tags) : [],
          sourceUrl: r.sourceUrl,
          sourceAuthor: r.sourceAuthor,
          sourceType: r.sourceType,
          source: "official" as const,
          createdAt: r.createdAt,
        })),
        ...userPublic.map((r: typeof customRecipes.$inferSelect) => ({
          id: `user_${r.id}`,
          name: r.name,
          description: r.description,
          image: r.image,
          thumbnailUrl: r.thumbnailUrl,
          cookTime: r.cookTime,
          servings: r.servings,
          difficulty: r.difficulty,
          recipeCategory: r.recipeCategory,
          ingredients: r.ingredients ? JSON.parse(r.ingredients) : [],
          steps: r.steps ? JSON.parse(r.steps) : [],
          tags: r.tags ? JSON.parse(r.tags) : [],
          sourceUrl: r.sourceUrl,
          sourceAuthor: r.sourceAuthor,
          sourceType: r.sourceType,
          source: "user" as const,
          createdAt: r.createdAt,
        })),
      ];

      return all
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(input.offset, input.offset + input.limit);
    }),

  // ── Request public (user requests to make recipe public) ───────────────────
  requestPublic: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [recipe] = await db.select().from(customRecipes)
        .where(and(eq(customRecipes.id, input.id), eq(customRecipes.familyId, ctx.activeFamilyId)))
        .limit(1);
      if (!recipe) throw new TRPCError({ code: "NOT_FOUND" });
      await db.update(customRecipes)
        .set({ visibility: "pending_public" })
        .where(eq(customRecipes.id, input.id));
      return { success: true };
    }),

  // ── Admin: list pending public requests ────────────────────────────────────
  adminListPending: protectedProcedure
    .query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select().from(customRecipes)
        .where(eq(customRecipes.visibility, "pending_public"))
        .orderBy(desc(customRecipes.createdAt));
      return rows.map((r: typeof customRecipes.$inferSelect) => ({
        ...r,
        ingredients: r.ingredients ? JSON.parse(r.ingredients) : [],
        steps: r.steps ? JSON.parse(r.steps) : [],
        tags: r.tags ? JSON.parse(r.tags) : [],
      }));
    }),

  // ── Admin: approve public request ──────────────────────────────────────────
  adminApprove: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(customRecipes)
        .set({ visibility: "public", approvedByUserId: String(ctx.user.id), approvedAt: new Date() })
        .where(eq(customRecipes.id, input.id));
      return { success: true };
    }),

  // ── Admin: reject public request ───────────────────────────────────────────
  adminReject: protectedProcedure
    .input(z.object({ id: z.number().int(), reason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(customRecipes)
        .set({ visibility: "private", rejectionReason: input.reason })
        .where(eq(customRecipes.id, input.id));
      return { success: true };
    }),
  // ── User: create blank recipe manually ─────────────────────────────────────
  createBlank: protectedProcedure
    .input(recipeInputSchema.extend({
      name: z.string().max(128),
      visibility: z.enum(["private", "pending_public"]).default("private"),
      isDraft: z.boolean().default(false),
      inputLang: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "請先建立或加入家庭廚房，才能儲存食譜" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const isDraft = input.isDraft;
      let baseName = (input.name && input.name.trim()) || (isDraft ? "未命名草稿" : input.name);
      let baseDesc = input.description ?? "";
      let baseSteps: any[] = input.steps;
      let baseIngredients: any[] = input.ingredients;
      let _tr2: any = {};
      // 草稿唔翻譯（避免自動儲存狂燒錢）；最終儲存先補齊 4 語言（保證中文 base）
      if (!isDraft) {
        const built = await buildAllLangs({
          name: baseName, description: input.description, steps: input.steps,
          ingredients: input.ingredients, srcLang: input.inputLang,
        });
        baseName = built.name; baseDesc = built.description; baseSteps = built.steps; baseIngredients = built.ingredients;
        _tr2 = built;
      }
      const [inserted] = await db.insert(customRecipes).values({
        familyId: ctx.activeFamilyId,
        createdByUserId: String(ctx.user.id),
        name: baseName,
        nameEn: _tr2.nameEn,
        nameFil: _tr2.nameFil,
        nameId: _tr2.nameId,
        description: baseDesc,
        descriptionEn: _tr2.descriptionEn,
        descriptionFil: _tr2.descriptionFil,
        descriptionId: _tr2.descriptionId,
        image: input.image ?? "",
        thumbnailUrl: input.thumbnailUrl ?? input.image ?? "",
        cookTime: input.cookTime ?? 0,
        servings: input.servings ?? 2,
        difficulty: normalizeDifficulty(input.difficulty),
        recipeCategory: input.recipeCategory ?? "mixed",
        dishType: input.dishType || (isDraft ? "other" : (await classifyRecipeDishTypeLLM({
          name: baseName,
          description: baseDesc,
          ingredients: baseIngredients,
          tags: input.tags,
          category: input.recipeCategory,
        }))),
        ingredients: isDraft ? JSON.stringify(baseIngredients) : await withIngredientTranslations(baseIngredients),
        steps: JSON.stringify(baseSteps),
        stepsEn: _tr2.stepsEn ? JSON.stringify(_tr2.stepsEn) : undefined,
        stepsFil: _tr2.stepsFil ? JSON.stringify(_tr2.stepsFil) : undefined,
        stepsId: _tr2.stepsId ? JSON.stringify(_tr2.stepsId) : undefined,
        tags: JSON.stringify(input.tags ?? ["自訂", "我的食譜"]),
        sourceType: input.sourceUrl ? detectSourceType(input.sourceUrl) : "manual",
        sourceUrl: input.sourceUrl,
        sourceAuthor: input.sourceAuthor,
        visibility: input.visibility,
        isDraft: input.isDraft,
        scenarioTags: isDraft ? "[]" : computeScenarioTags({
          name: baseName, description: baseDesc, cookTime: input.cookTime,
          difficulty: input.difficulty, recipeCategory: input.recipeCategory,
          dishType: input.dishType, ingredients: baseIngredients, steps: baseSteps, tags: input.tags,
        }),
      }).returning();

      return { success: true, id: inserted.id };
    }),

  // ── User: update own recipe ────────────────────────────────────────────────
  updateUser: protectedProcedure
    .input(recipeInputSchema.extend({
      id: z.number().int(),
      name: z.string().max(128),
      visibility: z.enum(["private", "pending_public"]).default("private"),
      isDraft: z.boolean().default(false),
      inputLang: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "請先建立或加入家庭廚房" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [recipe] = await db.select({ id: customRecipes.id, createdByUserId: customRecipes.createdByUserId })
        .from(customRecipes)
        .where(eq(customRecipes.id, input.id))
        .limit(1);
      if (!recipe) throw new TRPCError({ code: "NOT_FOUND" });
      if (recipe.createdByUserId !== String(ctx.user.id)) throw new TRPCError({ code: "FORBIDDEN" });

      const isDraft = input.isDraft;
      const baseNameRaw = (input.name && input.name.trim()) || (isDraft ? "未命名草稿" : input.name);
      const update: any = {
        name: baseNameRaw,
        description: input.description ?? "",
        // 只在有提供時更新圖片，否則保留原有（防部分更新清空圖）
        ...(input.image !== undefined || input.thumbnailUrl !== undefined
          ? { image: input.image ?? input.thumbnailUrl ?? "", thumbnailUrl: input.thumbnailUrl ?? input.image ?? "" }
          : {}),
        cookTime: input.cookTime ?? 0,
        servings: input.servings ?? 2,
        difficulty: normalizeDifficulty(input.difficulty),
        recipeCategory: input.recipeCategory ?? "mixed",
        dishType: input.dishType || (isDraft ? "other" : (await classifyRecipeDishTypeLLM({
          name: baseNameRaw,
          description: input.description,
          ingredients: input.ingredients,
          tags: input.tags,
          category: input.recipeCategory,
        }))),
        steps: JSON.stringify(input.steps),
        tags: JSON.stringify(cleanTags(input.tags ?? [])),
        sourceType: input.sourceUrl ? detectSourceType(input.sourceUrl) : "manual",
        sourceUrl: input.sourceUrl,
        sourceAuthor: input.sourceAuthor,
        visibility: input.visibility,
        isDraft: input.isDraft,
        updatedAt: new Date(),
        scenarioTags: isDraft ? "[]" : computeScenarioTags({
          name: baseNameRaw, description: input.description, cookTime: input.cookTime,
          difficulty: input.difficulty, recipeCategory: input.recipeCategory,
          dishType: input.dishType, ingredients: input.ingredients, steps: input.steps, tags: input.tags,
        }),
      };
      if (!isDraft) {
        // 最終儲存：由作者語言 buildAllLangs 補齊 4 語言（保證中文 base）；非中文編輯唔會覆寫中文 base
        const built = await buildAllLangs({
          name: baseNameRaw, description: input.description, steps: input.steps,
          ingredients: input.ingredients, srcLang: input.inputLang,
        });
        update.name = built.name;
        update.description = built.description;
        update.nameEn = built.nameEn; update.nameFil = built.nameFil; update.nameId = built.nameId;
        update.descriptionEn = built.descriptionEn; update.descriptionFil = built.descriptionFil; update.descriptionId = built.descriptionId;
        update.steps = JSON.stringify(built.steps);
        update.stepsEn = built.stepsEn ? JSON.stringify(built.stepsEn) : undefined;
        update.stepsFil = built.stepsFil ? JSON.stringify(built.stepsFil) : undefined;
        update.stepsId = built.stepsId ? JSON.stringify(built.stepsId) : undefined;
        update.ingredients = await withIngredientTranslations(built.ingredients);
      } else {
        // 草稿：唔翻譯、亦唔覆寫現有翻譯（避免自動儲存清空譯文）
        update.ingredients = JSON.stringify(input.ingredients);
      }

      await db.update(customRecipes).set(update).where(eq(customRecipes.id, input.id));

      return { success: true };
    }),

  // ── Get family draft recipe (auto-saved partial recipe) ─────────────────
  getDraft: protectedProcedure
    .query(async ({ ctx }) => {
      if (!ctx.activeFamilyId) return null;
      const db = await getDb();
      if (!db) return null;
      const [r] = await db.select().from(customRecipes)
        .where(and(eq(customRecipes.familyId, ctx.activeFamilyId), eq(customRecipes.isDraft, true)))
        .orderBy(desc(customRecipes.updatedAt))
        .limit(1);
      if (!r) return null;
      return {
        ...r,
        id: `user_${r.id}`,
        ingredients: r.ingredients ? JSON.parse(r.ingredients) : [],
        steps: r.steps ? JSON.parse(r.steps) : [],
        tags: r.tags ? JSON.parse(r.tags) : [],
        source: "user" as const,
      };
    }),

  // ── Admin: delete (soft-delete) official recipe ─────────────────────────
  deleteOfficial: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN', message: '只有管理員可以刪除官方食譜' });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const [recipe] = await db.select({ id: officialRecipes.id })
        .from(officialRecipes)
        .where(eq(officialRecipes.id, input.id))
        .limit(1);
      if (!recipe) throw new TRPCError({ code: 'NOT_FOUND', message: '找不到該食譜' });
      await db.update(officialRecipes)
        .set({ isActive: false })
        .where(eq(officialRecipes.id, input.id));
      return { success: true };
    }),

  // ── User: delete own imported recipe ──────────────────────────────────────
  deleteUser: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [recipe] = await db.select().from(customRecipes)
        .where(eq(customRecipes.id, input.id))
        .limit(1);
      if (!recipe) throw new TRPCError({ code: "NOT_FOUND" });
      if (recipe.createdByUserId !== String(ctx.user.id)) throw new TRPCError({ code: "FORBIDDEN" });
      await db.delete(customRecipes).where(eq(customRecipes.id, input.id));
      return { success: true };
    }),

  // ── Admin: create official recipe ─────────────────────────────────────────
  adminCreateOfficial: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(128),
      nameEn: z.string().optional(),
      description: z.string().optional(),
      image: z.string().optional(),
      cookTime: z.number().int().min(1).default(20),
      servings: z.number().int().min(1).default(2),
      difficulty: z.string().default('中等'),
      recipeCategory: z.string().default('mixed'),
      tags: z.array(z.string()).optional(),
      sourceAuthor: z.string().optional(),
      sourceUrl: z.string().optional(),
      tips: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN', message: '只有管理員可以新增官方食譜' });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const [inserted] = await db.insert(officialRecipes).values({
        importedByUserId: String(ctx.user.id),
        name: input.name,
        description: input.description ?? '',
        image: input.image ?? '',
        thumbnailUrl: input.image ?? '',
        cookTime: input.cookTime,
        servings: input.servings,
        difficulty: input.difficulty,
        recipeCategory: input.recipeCategory,
        ingredients: JSON.stringify([]),
        steps: JSON.stringify([]),
        tags: JSON.stringify(cleanTags(input.tags ?? [])),
        sourceType: 'manual',
        sourceAuthor: input.sourceAuthor ?? '',
        sourceUrl: input.sourceUrl ?? '',
        tips: input.tips ?? '',
        isActive: true,
        scenarioTags: computeScenarioTags({
          name: input.name, description: input.description, cookTime: input.cookTime,
          difficulty: input.difficulty, recipeCategory: input.recipeCategory,
          ingredients: [], steps: [], tags: input.tags,
        }),
      }).returning();
      return { success: true, id: inserted.id };
    }),

  // ── Admin: update official recipe ─────────────────────────────────────────
  adminUpdateOfficial: protectedProcedure
    .input(z.object({
      id: z.number().int(),
      name: z.string().min(1).max(128),
      nameEn: z.string().optional(),
      description: z.string().optional(),
      image: z.string().optional(),
      cookTime: z.number().int().min(1).default(20),
      servings: z.number().int().min(1).default(2),
      difficulty: z.string().default('中等'),
      recipeCategory: z.string().default('mixed'),
      tags: z.array(z.string()).optional(),
      sourceAuthor: z.string().optional(),
      sourceUrl: z.string().optional(),
      sourceType: z.enum(["instagram", "youtube", "xiaohongshu", "threads", "tiktok", "manual", "kol"]).optional(),
      tips: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN', message: '只有管理員可以編輯官方食譜' });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const [recipe] = await db.select({ id: officialRecipes.id })
        .from(officialRecipes)
        .where(eq(officialRecipes.id, input.id))
        .limit(1);
      if (!recipe) throw new TRPCError({ code: 'NOT_FOUND', message: '找不到該食譜' });
      await db.update(officialRecipes).set({
        name: input.name,
        description: input.description ?? '',
        image: input.image ?? '',
        thumbnailUrl: input.image ?? '',
        cookTime: input.cookTime,
        servings: input.servings,
        difficulty: input.difficulty,
        recipeCategory: input.recipeCategory,
        tags: JSON.stringify(cleanTags(input.tags ?? [])),
        sourceAuthor: input.sourceAuthor ?? '',
        sourceUrl: input.sourceUrl ?? '',
        sourceType: input.sourceType,
        tips: input.tips ?? '',
        updatedAt: new Date(),
        scenarioTags: computeScenarioTags({
          name: input.name, description: input.description, cookTime: input.cookTime,
          difficulty: input.difficulty, recipeCategory: input.recipeCategory, tags: input.tags,
        }),
      }).where(eq(officialRecipes.id, input.id));
      return { success: true };
    }),

  // ── Admin: add a KOL recipe (global, familyId=0, public) ───────────────────
  adminCreateKol: protectedProcedure
    .input(z.object({ url: z.string().url(), sourceAuthor: z.string().max(128).optional() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN', message: '只有管理員可以新增網紅食譜' });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const parsed = await parseRecipeFromUrl(input.url, "zh-TW", undefined);
      if (!parsed?.name) throw new TRPCError({ code: 'BAD_REQUEST', message: '無法解析此連結' });
      const stepsArr = (parsed.steps || []).map((s: any) => typeof s === "string" ? s : (s.instruction ?? ""));
      const tr = await translateRecipeContent(parsed.name, stepsArr, parsed.description ?? "");
      const img = parsed.thumbnailUrl || "";
      const [inserted] = await db.insert(customRecipes).values({
        familyId: 0,
        createdByUserId: String(ctx.user.id),
        name: parsed.name,
        nameEn: tr.nameEn,
        nameFil: tr.nameFil,
        nameId: tr.nameId,
        description: parsed.description ?? "",
        descriptionEn: tr.descriptionEn,
        descriptionFil: tr.descriptionFil,
        descriptionId: tr.descriptionId,
        image: img,
        thumbnailUrl: img,
        cookTime: parsed.cookTime ?? 30,
        servings: parsed.servings ?? 4,
        difficulty: parsed.difficulty ?? "中等",
        recipeCategory: parsed.recipeCategory ?? "其他",
            ingredients: await withIngredientTranslations(parsed.ingredients ?? []),
        steps: JSON.stringify(parsed.steps ?? []),
        stepsEn: tr.stepsEn ? JSON.stringify(tr.stepsEn) : undefined,
        stepsFil: tr.stepsFil ? JSON.stringify(tr.stepsFil) : undefined,
        stepsId: tr.stepsId ? JSON.stringify(tr.stepsId) : undefined,
        tags: JSON.stringify(parsed.tags ?? []),
        sourceType: "kol",
        sourceUrl: input.url,
        sourceAuthor: input.sourceAuthor ?? parsed.sourceAuthor ?? "",
        visibility: "public",
        scenarioTags: computeScenarioTags({
          name: parsed.name, description: parsed.description, cookTime: parsed.cookTime ?? 30,
          difficulty: parsed.difficulty, recipeCategory: parsed.recipeCategory,
          ingredients: parsed.ingredients, steps: parsed.steps, tags: parsed.tags,
        }),
      }).returning();
      return { success: true, id: inserted.id, name: parsed.name };
    }),

  // ── Admin: batch add KOL recipes from links ────────────────────────────────
  adminCreateKolBatch: protectedProcedure
    .input(z.object({ urls: z.array(z.string().url()).min(1).max(20), sourceAuthor: z.string().max(128).optional() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN', message: '只有管理員可以新增網紅食譜' });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const results: { url: string; ok: boolean; name?: string; error?: string }[] = [];
      for (const url of input.urls) {
        try {
          const parsed = await parseRecipeFromUrl(url, "zh-TW", undefined);
          if (!parsed?.name) throw new Error("無法解析");
          const stepsArr = (parsed.steps || []).map((s: any) => typeof s === "string" ? s : (s.instruction ?? ""));
          const tr = await translateRecipeContent(parsed.name, stepsArr, parsed.description ?? "");
          const img = parsed.thumbnailUrl || "";
          await db.insert(customRecipes).values({
            familyId: 0,
            createdByUserId: String(ctx.user.id),
            name: parsed.name,
            nameEn: tr.nameEn, nameFil: tr.nameFil, nameId: tr.nameId,
            description: parsed.description ?? "",
            descriptionEn: tr.descriptionEn, descriptionFil: tr.descriptionFil, descriptionId: tr.descriptionId,
            image: img, thumbnailUrl: img,
            cookTime: parsed.cookTime ?? 30, servings: parsed.servings ?? 4,
            difficulty: parsed.difficulty ?? "中等", recipeCategory: parsed.recipeCategory ?? "其他",
        ingredients: await withIngredientTranslations(parsed.ingredients ?? []),
            steps: JSON.stringify(parsed.steps ?? []),
            stepsEn: tr.stepsEn ? JSON.stringify(tr.stepsEn) : undefined,
            stepsFil: tr.stepsFil ? JSON.stringify(tr.stepsFil) : undefined,
            stepsId: tr.stepsId ? JSON.stringify(tr.stepsId) : undefined,
            tags: JSON.stringify(parsed.tags ?? []),
            sourceType: "kol", sourceUrl: url,
            sourceAuthor: input.sourceAuthor ?? parsed.sourceAuthor ?? "",
            visibility: "public",
            scenarioTags: computeScenarioTags({
              name: parsed.name, description: parsed.description, cookTime: parsed.cookTime ?? 30,
              difficulty: parsed.difficulty, recipeCategory: parsed.recipeCategory,
              ingredients: parsed.ingredients, steps: parsed.steps, tags: parsed.tags,
            }),
          });
          results.push({ url, ok: true, name: parsed.name });
        } catch (e) {
          results.push({ url, ok: false, error: (e as Error)?.message });
        }
      }
      return { results };
    }),

  // ── Admin: list KOL recipes ────────────────────────────────────────────────
  adminListKol: protectedProcedure
    .query(async ({ ctx }) => {
      if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN' });
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select().from(customRecipes).where(eq(customRecipes.sourceType, "kol")).orderBy(desc(customRecipes.createdAt));
      return rows.map((r) => ({
        id: r.id, name: r.name, nameEn: r.nameEn, sourceAuthor: r.sourceAuthor, sourceUrl: r.sourceUrl,
        image: r.image, thumbnailUrl: r.thumbnailUrl, createdAt: r.createdAt,
      }));
    }),

  // ── Admin: delete a KOL recipe ─────────────────────────────────────────────
  adminDeleteKol: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN' });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      await db.delete(customRecipes).where(and(eq(customRecipes.id, input.id), eq(customRecipes.sourceType, "kol")));
      return { success: true };
    }),

  // ── Save a KOL recipe into the user's own kitchen ──────────────────────────
  saveKolRecipe: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: 'BAD_REQUEST', message: '請先加入家庭廚房' });
      if (ctx.clientPlatform !== "native") {
        await assertProFeature(ctx.activeFamilyId, String(ctx.user.id), "kol");
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const [kol] = await db.select().from(customRecipes)
        .where(and(eq(customRecipes.id, input.id), eq(customRecipes.sourceType, "kol"))).limit(1);
      if (!kol) throw new TRPCError({ code: 'NOT_FOUND', message: '找不到此網紅食譜' });
      if (kol.sourceUrl) {
        const dup = await db.select({ id: customRecipes.id }).from(customRecipes)
          .where(and(eq(customRecipes.familyId, ctx.activeFamilyId), eq(customRecipes.sourceUrl, kol.sourceUrl))).limit(1);
        if (dup.length > 0) return { success: true, id: dup[0].id, already: true };
      }
      const [inserted] = await db.insert(customRecipes).values({
        familyId: ctx.activeFamilyId,
        createdByUserId: String(ctx.user.id),
        name: kol.name, nameEn: kol.nameEn, nameFil: kol.nameFil, nameId: kol.nameId,
        description: kol.description, image: kol.image, thumbnailUrl: kol.thumbnailUrl,
        cookTime: kol.cookTime, servings: kol.servings, difficulty: kol.difficulty,
        recipeCategory: kol.recipeCategory, dishType: kol.dishType,
        ingredients: kol.ingredients, steps: kol.steps,
        stepsEn: kol.stepsEn, stepsFil: kol.stepsFil, stepsId: kol.stepsId,
        tags: kol.tags, sourceType: "manual",
        sourceUrl: kol.sourceUrl, sourceAuthor: kol.sourceAuthor,
        visibility: "private",
        scenarioTags: kol.scenarioTags ?? computeScenarioTags({
          name: kol.name, description: kol.description, cookTime: kol.cookTime,
          difficulty: kol.difficulty, recipeCategory: kol.recipeCategory, dishType: kol.dishType,
          ingredients: kol.ingredients, steps: kol.steps, tags: kol.tags,
        }),
      }).returning();
      return { success: true, id: inserted.id };
    }),

  // ── KOL whitelist (partnered creators auto-publish) ────────────────────────
  isKolCreator: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return { isCreator: false };
      const rows = await db.select({ userId: kolCreators.userId }).from(kolCreators).where(eq(kolCreators.userId, String(ctx.user.id))).limit(1);
      return { isCreator: rows.length > 0 };
    }),

  adminListKolCreators: protectedProcedure
    .query(async ({ ctx }) => {
      if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN' });
      const db = await getDb();
      if (!db) return [];
      return db.select().from(kolCreators).orderBy(desc(kolCreators.addedAt));
    }),

  adminAddKolCreator: protectedProcedure
    .input(z.object({ email: z.string().email(), displayName: z.string().max(128).optional() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN' });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const [u] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.email, input.email)).limit(1);
      if (!u) throw new TRPCError({ code: 'NOT_FOUND', message: '此電郵未註冊' });
      await db.insert(kolCreators).values({ userId: String(u.id), email: input.email, displayName: input.displayName ?? u.name ?? null, addedByUserId: String(ctx.user.id) })
        .onConflictDoNothing({ target: kolCreators.userId });
      return { success: true };
    }),

  adminRemoveKolCreator: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN' });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      await db.delete(kolCreators).where(eq(kolCreators.userId, input.userId));
      return { success: true };
    }),

  // Whitelisted creator submits one of their recipes → auto-publish to KOL
  submitToKol: protectedProcedure
    .input(z.object({ recipeId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const wl = await db.select({ userId: kolCreators.userId }).from(kolCreators).where(eq(kolCreators.userId, String(ctx.user.id))).limit(1);
      if (wl.length === 0) throw new TRPCError({ code: 'FORBIDDEN', message: '你唔喺網紅白名單，請先聯絡管理員' });
      if (!ctx.activeFamilyId) throw new TRPCError({ code: 'BAD_REQUEST', message: '請先加入家庭廚房' });
      const [src] = await db.select().from(customRecipes)
        .where(and(eq(customRecipes.id, input.recipeId), eq(customRecipes.familyId, ctx.activeFamilyId))).limit(1);
      if (!src) throw new TRPCError({ code: 'NOT_FOUND', message: '找不到此食譜' });
      // Translate if missing (bilingual content)
      let nameEn = src.nameEn, nameFil = src.nameFil, nameId = src.nameId, stepsEn = src.stepsEn, stepsFil = src.stepsFil, stepsId = src.stepsId;
      let descriptionEn = src.descriptionEn, descriptionFil = src.descriptionFil, descriptionId = src.descriptionId;
      if (!src.nameEn || !src.stepsEn || !src.descriptionEn) {
        const stepsArr = (() => { try { const p = JSON.parse(src.steps || "[]"); return Array.isArray(p) ? p.map((s: any) => typeof s === "string" ? s : (s.instruction ?? "")) : []; } catch { return []; } })();
        const tr = await translateRecipeContent(src.name, stepsArr, src.description ?? "");
        nameEn = nameEn ?? tr.nameEn ?? null; nameFil = nameFil ?? tr.nameFil ?? null; nameId = nameId ?? tr.nameId ?? null;
        descriptionEn = descriptionEn ?? tr.descriptionEn ?? null; descriptionFil = descriptionFil ?? tr.descriptionFil ?? null; descriptionId = descriptionId ?? tr.descriptionId ?? null;
        stepsEn = stepsEn ?? (tr.stepsEn ? JSON.stringify(tr.stepsEn) : null);
        stepsFil = stepsFil ?? (tr.stepsFil ? JSON.stringify(tr.stepsFil) : null);
        stepsId = stepsId ?? (tr.stepsId ? JSON.stringify(tr.stepsId) : null);
      }
      const [inserted] = await db.insert(customRecipes).values({
        familyId: 0,
        createdByUserId: String(ctx.user.id),
        name: src.name, nameEn, nameFil, nameId,
        description: src.description, image: src.image, thumbnailUrl: src.thumbnailUrl,
        descriptionEn, descriptionFil, descriptionId,
        cookTime: src.cookTime, servings: src.servings, difficulty: src.difficulty,
        recipeCategory: src.recipeCategory, dishType: src.dishType,
        ingredients: src.ingredients, steps: src.steps,
        stepsEn, stepsFil, stepsId,
        tags: src.tags, sourceType: "kol",
        sourceUrl: src.sourceUrl, sourceAuthor: src.sourceAuthor ?? ctx.user.name ?? "",
        visibility: "public",
        scenarioTags: src.scenarioTags ?? computeScenarioTags({
          name: src.name, description: src.description, cookTime: src.cookTime,
          difficulty: src.difficulty, recipeCategory: src.recipeCategory, dishType: src.dishType,
          ingredients: src.ingredients, steps: src.steps, tags: src.tags,
        }),
      }).returning();
      return { success: true, id: inserted.id };
    }),


  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Parse id: "official_123" or "user_123" or plain "123" (legacy)
      const isOfficial = input.id.startsWith("official_");
      const isUser = input.id.startsWith("user_");
      const numericId = parseInt(
        isOfficial ? input.id.replace("official_", "")
        : isUser ? input.id.replace("user_", "")
        : input.id,
        10
      );

      if (isNaN(numericId)) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid recipe id" });

      if (isOfficial || !isUser) {
        // Try official first
        const [r] = await db.select().from(officialRecipes)
          .where(eq(officialRecipes.id, numericId)).limit(1);
        if (r) {
          return {
            ...r,
            id: `official_${r.id}`,
            ingredients: r.ingredients ? JSON.parse(r.ingredients) : [],
            steps: r.steps ? JSON.parse(r.steps) : [],
            stepsEn: r.stepsEn ? (() => { try { return JSON.parse(r.stepsEn!); } catch { return []; } })() : [],
            stepsFil: r.stepsFil ? (() => { try { return JSON.parse(r.stepsFil!); } catch { return []; } })() : [],
            stepsId: r.stepsId ? (() => { try { return JSON.parse(r.stepsId!); } catch { return []; } })() : [],
            tags: r.tags ? JSON.parse(r.tags) : [],
            source: "official" as const,
          };
        }
        if (isOfficial) throw new TRPCError({ code: "NOT_FOUND" });
      }

      // Try user recipe
      const [r] = await db.select().from(customRecipes)
        .where(eq(customRecipes.id, numericId)).limit(1);
      if (!r) throw new TRPCError({ code: "NOT_FOUND" });

      // Check access: user can view their own family's recipes or public recipes
      if (r.visibility === "private") {
        if (!ctx.user || !ctx.activeFamilyId || r.familyId !== ctx.activeFamilyId) {
          // Distinct message so the client can show a private-recipe notice
          // (log in / no access) instead of a generic "not found".
          throw new TRPCError({ code: "FORBIDDEN", message: "PRIVATE_RECIPE" });
        }
      }
      // pending_public 未審批 → 只有自己家庭睇得到（防公開枚舉）
      if (r.visibility === "pending_public") {
        if (!ctx.user || !ctx.activeFamilyId || r.familyId !== ctx.activeFamilyId) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
      }

      // L3: on-demand 補翻譯 —— 非阻塞（fire-and-forget）：唔好等 LLM 拖慢詳情頁。
      // 缺語言先背景補 + 寫回 cache；今次先回基底資料，下次開就有譯文。
      void (async () => {
        try {
          const patch = await buildTranslationPatch(r as any);
          if (Object.keys(patch).length > 0) {
            await db.update(customRecipes).set(patch as any).where(eq(customRecipes.id, r.id));
          }
        } catch { /* 唔阻塞 */ }
      })();
      const merged: any = { ...r };

      return {
        ...merged,
        id: `user_${r.id}`,
        visibility: r.visibility,
        ingredients: merged.ingredients ? JSON.parse(merged.ingredients) : [],
        steps: merged.steps ? JSON.parse(merged.steps) : [],
        stepsEn: merged.stepsEn ? (() => { try { return JSON.parse(merged.stepsEn!); } catch { return []; } })() : [],
        stepsFil: merged.stepsFil ? (() => { try { return JSON.parse(merged.stepsFil!); } catch { return []; } })() : [],
        stepsId: merged.stepsId ? (() => { try { return JSON.parse(merged.stepsId!); } catch { return []; } })() : [],
        tags: merged.tags ? JSON.parse(merged.tags) : [],
        source: "user" as const,
      };
    }),

  // ── Admin: migrate external images to R2 ───────────────────────────────────
  adminMigrateExternalImages: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional())
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN', message: '只有管理員可以執行遷移' });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      const EXTERNAL_PATTERNS = ['instagram.com', 'cdninstagram.com', 'scontent-', '.fbcdn.net'];
      const isExternal = (url: string) => {
        if (!url) return false;
        const isR2 = url.includes('.r2.cloudflarestorage.com/') || url.startsWith('/r2-storage/');
        if (isR2) return false;
        return EXTERNAL_PATTERNS.some(p => url.includes(p));
      };

      const recipes = await db.select().from(customRecipes)
        .where(sql`${customRecipes.image} LIKE '%instagram%' OR ${customRecipes.thumbnailUrl} LIKE '%instagram%'`)
        .limit(input?.limit ?? 50);

      let migrated = 0;
      let failed = 0;

      for (const recipe of recipes) {
        if (!isExternal(recipe.image || '') && !isExternal(recipe.thumbnailUrl || '')) continue;

        try {
          const newImage = recipe.image ? await rehostExternalImage(recipe.image) : '';
          const newThumbnail = recipe.thumbnailUrl ? await rehostExternalImage(recipe.thumbnailUrl) : newImage || '';

          await db.update(customRecipes)
            .set({ image: newImage, thumbnailUrl: newThumbnail, updatedAt: new Date() })
            .where(eq(customRecipes.id, recipe.id));

          migrated++;
        } catch {
          failed++;
        }
      }

      return { success: true, migrated, failed, total: recipes.length };
    }),

  // ── User: toggle recipe collection (bookmark) ──────────────────────────────
  toggleCollection: protectedProcedure
    .input(z.object({ 
      recipeId: z.string(),
      recipeType: z.enum(["official", "custom"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const userId = String(ctx.user.id);
      const { recipeId, recipeType } = input;

      // Check if already collected
      const existing = await db.select()
        .from(userRecipeCollections)
        .where(and(
          eq(userRecipeCollections.userId, userId),
          eq(userRecipeCollections.recipeId, recipeId),
          eq(userRecipeCollections.recipeType, recipeType)
        ))
        .limit(1);

      if (existing.length > 0) {
        // Remove collection
        await db.delete(userRecipeCollections)
          .where(and(
            eq(userRecipeCollections.userId, userId),
            eq(userRecipeCollections.recipeId, recipeId),
            eq(userRecipeCollections.recipeType, recipeType)
          ));
        return { collected: false };
      } else {
        // Add collection
        await db.insert(userRecipeCollections).values({
          userId,
          recipeId,
          recipeType,
        });
        return { collected: true };
      }
    }),

  // ── User: get collected recipes ────────────────────────────────────────────
  listCollections: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const userId = String(ctx.user.id);
      const collections = await db.select()
        .from(userRecipeCollections)
        .where(eq(userRecipeCollections.userId, userId));

      const recipes: any[] = [];

      for (const collection of collections) {
        if (collection.recipeType === "official") {
          const numericId = parseInt(collection.recipeId, 10);
          const [r] = await db.select()
            .from(officialRecipes)
            .where(eq(officialRecipes.id, numericId))
            .limit(1);
          if (r) {
            recipes.push({
              ...r,
              id: `official_${r.id}`,
              ingredients: r.ingredients ? JSON.parse(r.ingredients) : [],
              steps: r.steps ? JSON.parse(r.steps) : [],
              tags: r.tags ? JSON.parse(r.tags) : [],
              source: "official" as const,
              isCollected: true,
            });
          }
        } else if (collection.recipeType === "custom") {
          const numericId = parseInt(collection.recipeId, 10);
          const [r] = await db.select()
            .from(customRecipes)
            .where(eq(customRecipes.id, numericId))
            .limit(1);
          if (r && (r.visibility === "public" || r.visibility === "pending_public")) {
            recipes.push({
              ...r,
              id: `user_${r.id}`,
              ingredients: r.ingredients ? JSON.parse(r.ingredients) : [],
              steps: r.steps ? JSON.parse(r.steps) : [],
              tags: r.tags ? JSON.parse(r.tags) : [],
              source: "user" as const,
              isCollected: true,
            });
          }
        }
      }

      return recipes;
    }),

  // ── Public: list KOL recipes (source_type = 'kol' only) ───────────────────
  listKol: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) return [];
      if (ctx.clientPlatform !== "native") {
        await assertProFeature(ctx.activeFamilyId, String(ctx.user.id), "kol");
      }
      const db = await getDb();
      if (!db) return [];

      const recipes = await db.select()
        .from(customRecipes)
        .where(eq(customRecipes.sourceType, "kol"))
        .orderBy(desc(customRecipes.popularity))
        .limit(input?.limit ?? 20)
        .offset(input?.offset ?? 0);

      return recipes.map((r) => ({
        ...r,
        id: `user_${r.id}`,
        ingredients: r.ingredients ? JSON.parse(r.ingredients) : [],
        steps: r.steps ? JSON.parse(r.steps) : [],
        tags: r.tags ? JSON.parse(r.tags) : [],
        source: "user" as const,
      }));
    }),

});
