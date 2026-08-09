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
import { getDb, getCommonIngredients } from "../db";
import { customRecipes, officialRecipes } from "../../drizzle/schema";
import { eq, and, or, desc, like, ilike, lte, count, not, gte, sql } from "drizzle-orm";
import crypto from "crypto";
import { storagePut } from "../storage";
import { ENV } from "../_core/env";

// ─── 智能搜尋：分詞詞典、同義詞歸一化、多語言、模糊匹配、關鍵字分割 ──────────────

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

function detectSourceType(url: string): "instagram" | "youtube" | "xiaohongshu" | "threads" | "tiktok" | "manual" {
  if (url.includes("instagram.com")) return "instagram";
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  if (url.includes("xiaohongshu.com") || url.includes("xhslink.com")) return "xiaohongshu";
  if (url.includes("threads.net")) return "threads";
  if (url.includes("tiktok.com")) return "tiktok";
  return "manual";
}

// ─── parseText helper ───────────────────────────────────────────────────────

async function rehostExternalImage(imageUrl: string, category?: string): Promise<string> {
  if (!imageUrl) return "";
  // Decode HTML entities that break fetch (especially Instagram's &amp;)
  imageUrl = imageUrl.replace(/&amp;/g, "&");
  
  const isR2 = imageUrl.includes(".r2.cloudflarestorage.com/") ||
    (process.env.R2_PUBLIC_URL && imageUrl.startsWith(process.env.R2_PUBLIC_URL)) ||
    imageUrl.startsWith("/r2-storage/");
  if (isR2) return imageUrl;
  
  console.log("[rehostExternalImage] Attempting to rehost:", imageUrl.substring(0, 100));
  
  // Try primary fetch with Instagram referer
  try {
    const resp = await fetch(imageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Referer": "https://www.instagram.com/",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Sec-Fetch-Site": "cross-site",
        "Sec-Fetch-Mode": "no-cors",
      },
      signal: AbortSignal.timeout(10000),
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
    const retryResp = await fetch(imageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(10000),
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
  
  // Final fallback: return category-based Unsplash cover
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
  const languageNameMap: Record<string, string> = {
    "zh-TW": "繁體中文",
    "zh-CN": "简体中文",
    "zh": "中文",
    "en": "English",
    "fil": "Filipino",
    "id": "Indonesian",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "it": "Italian",
    "pt": "Portuguese",
    "ru": "Russian",
    "ja": "Japanese",
    "ko": "Korean",
    "vi": "Vietnamese",
    "th": "Thai",
    "ms": "Malay",
    "ar": "Arabic",
    "hi": "Hindi",
    "bn": "Bengali",
    "ur": "Urdu",
    "tr": "Turkish",
    "pl": "Polish",
    "nl": "Dutch",
    "sv": "Swedish",
    "no": "Norwegian",
    "da": "Danish",
    "fi": "Finnish",
    "el": "Greek",
    "he": "Hebrew",
    "fa": "Persian",
    "sw": "Swahili",
  };

  const targetLang = userLanguage && languageNameMap[userLanguage]
    ? languageNameMap[userLanguage]
    : userLanguage || "繁體中文";

  const systemPrompt = `你是一個專業的食譜解析助手。從用戶貼上的文字（可能來自小紅書、WhatsApp、網站等）中提取完整的食譜資訊並以 JSON 格式回傳。
  
  重要規則：
  - 只提取內容中實際存在的食譜資訊，不要虛構或猜測
  - 如果內容中沒有食譜資訊（例如純聊天、問候、食評、無食材和步驟的文字），請在 name 回傳"無法解析"，並在 description 說明原因
  - 食材分類規則：肉類、海鮮/蔬菜/調味料/乾貨/其他
  - 所有文字使用${targetLang}`;

  const userPrompt = `請從以下食譜文字中提取食譜資訊：

---
${text}
---

請回傳以下 JSON 格式（所有文字使用${targetLang}）：
{
  "name": "食譜名稱",
  "description": "簡短描述（1-2句）",
  "cookTime": 烹飪時間（分鐘，整數）,
  "servings": 份量（人數，整數）,
  "difficulty": "簡單" | "中等" | "困難",
  "recipeCategory": "粵菜" | "台式" | "日式" | "韓式" | "西式" | "甜品" | "湯水" | "快手菜" | "其他",
  "ingredients": [
    { "name": "食材名稱", "quantity": "數量", "unit": "單位", "category": "分類" }
  ],
  "steps": [
    { "instruction": "步驟說明", "duration": 分鐘（可選）, "tip": "小貼士（可選）" }
  ],
  "tags": ["標籤1", "標籤2"],
  "sourceAuthor": "創作者名稱（如文字中有提及）",
  "thumbnailUrl": ""
}`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "recipe_parse_text",
        strict: true,
        schema: {
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
                  tip: { type: "string" },
                },
                required: ["instruction"],
              },
            },
            tags: { type: "array", items: { type: "string" } },
            sourceAuthor: { type: "string" },
            thumbnailUrl: { type: "string" },
          },
          required: ["name", "description", "cookTime", "servings", "difficulty", "recipeCategory", "ingredients", "steps", "tags", "sourceAuthor", "thumbnailUrl"],
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
  result.parseReason = (result.name === "無法解析" || result.name === "需要手動輸入" || !hasContent)
    ? "no_recipe_content"
    : "ok";
  return result;
}

// ─── Ingredient / Step schemas ────────────────────────────────────────────────

const ingredientSchema = z.object({
  name: z.string(),
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
  ingredients: z.array(ingredientSchema),
  steps: z.array(stepSchema),
  tags: z.array(z.string()).optional(),
  sourceUrl: z.string().optional(),
  sourceAuthor: z.string().optional(),
});

// ─── Fetch webpage content helper ────────────────────────────────────────────

async function fetchPageContent(url: string): Promise<{ text: string; thumbnail: string }> {
  try {
    const sourceType = detectSourceType(url);

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
                igAuthor = media.owner?.full_name || media.owner?.username || "";
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

      // Step 3: Fallback — try fetching og:description from the page
      if (!igCaption) {
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
            if (!igThumbnail) {
              const thumbMatch = html.match(/property="og:image" content="([^"]+)"/) ||
                                 html.match(/content="([^"]+)" property="og:image"/);
              if (thumbMatch) igThumbnail = thumbMatch[1].replace(/&amp;/g, "&");
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
      if (noteUrl.includes("xhslink.com")) {
        try {
          const followResp = await fetch(noteUrl, {
            method: "HEAD",
            headers: {
              "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
            },
            redirect: "manual",
            signal: AbortSignal.timeout(10000),
          });
          const location = followResp.headers.get("location");
          if (location) noteUrl = location;
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

      // Step 2: Fallback — page scrape og:description
      if (!threadText) {
      try {
        const resp = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
            "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          signal: AbortSignal.timeout(12000),
        });
        if (resp.ok) {
          const html = await resp.text();

          // og:title
          const titleMatch = html.match(/property="og:title"\s*content="([^"]+)"/) ||
                             html.match(/name="twitter:title"\s*content="([^"]+)"/);
          if (titleMatch) threadText = `Title: ${titleMatch[1].replace(/&amp;/g, "&")}`;

          // og:description (usually contains the post text)
          const descMatch = html.match(/property="og:description"\s*content="([\s\S]*?)"/) ||
                            html.match(/name="description"\s*content="([^"]+)"/);
          if (descMatch) {
            const desc = descMatch[1]
              .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
              .replace(/&quot;/g, '"')
              .replace(/&amp;/g, "&")
              .trim();
            threadText += threadText ? `\n\nDescription:\n${desc}` : `Description: ${desc}`;
          }

          // og:image
          const imgMatch = html.match(/property="og:image"\s*content="([^"]+)"/);
          if (imgMatch) threadThumbnail = imgMatch[1];

          // Author from og:title (format "username on Threads")
          if (url.includes("/@")) {
            const userMatch = url.match(/threads\.net\/@?([^/\?]+)/);
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

    return { text: "", thumbnail: "" };
  } catch {
    return { text: "", thumbnail: "" };
  }
}

// ─── AI Parse URL ─────────────────────────────────────────────────────────────

async function parseRecipeFromUrl(url: string, userLanguage?: string, clientThumbnail?: string): Promise<{
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

  const languageNameMap: Record<string, string> = {
    "zh-TW": "繁體中文",
    "zh-CN": "简体中文",
    "zh": "中文",
    "en": "English",
    "fil": "Filipino",
    "id": "Indonesian",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "it": "Italian",
    "pt": "Portuguese",
    "ru": "Russian",
    "ja": "Japanese",
    "ko": "Korean",
    "vi": "Vietnamese",
    "th": "Thai",
    "ms": "Malay",
    "ar": "Arabic",
    "hi": "Hindi",
    "bn": "Bengali",
    "ur": "Urdu",
    "tr": "Turkish",
    "pl": "Polish",
    "nl": "Dutch",
    "sv": "Swedish",
    "no": "Norwegian",
    "da": "Danish",
    "fi": "Finnish",
    "el": "Greek",
    "he": "Hebrew",
    "fa": "Persian",
    "sw": "Swahili",
  };

  const targetLang = userLanguage && languageNameMap[userLanguage]
    ? languageNameMap[userLanguage]
    : userLanguage || "繁體中文";

  const { text: pageContent, thumbnail: fetchedThumbnail } = await fetchPageContent(url);
  const hasRealContent = pageContent.length > 30;
  
  // Use client-extracted thumbnail as fallback if backend extraction failed
  let effectiveThumbnail = fetchedThumbnail || clientThumbnail;
  
  // If still no thumbnail, use category-based fallback (will be set after parsing)
  // For now, keep it empty and assign after recipeCategory is known

  // Detect if content has actual recipe info (ingredients/steps keywords)
  const hasRecipeKeywords = /(?:材料 | 食材|做法 | 作法|步驟|ingredient|step|recipe|gram|tbsp|tsp|大匙 | 小匙 | 公克 | 毫升 | 份量 | 人份 | 醃製 | 醃漬|[0-9]+\s*(?:克|g|ml|cc|杯|匙|顆|粒|把|片|個|包|湯匙 | 茶匙))/i.test(pageContent);

  // If we have text but NO recipe keywords AND no thumbnail to try Vision → return early
  // Note: For Instagram, if we have clientThumbnail (from oEmbed), continue to AI parsing even without keywords
  if (hasRealContent && !hasRecipeKeywords && sourceType === "instagram" && !effectiveThumbnail) {
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
- 所有文字使用${targetLang}`;

  // For Instagram with thumbnail but no keywords: use Vision AI to parse from image
  const useVisionForInstagram = sourceType === "instagram" && effectiveThumbnail && !hasRecipeKeywords && hasRealContent;
  
  // For YouTube/Xiaohongshu: even if we have title/author, the description may not contain full recipe steps.
  const hasTitleOnly = (sourceType === "youtube" || sourceType === "xiaohongshu" || sourceType === "threads") && hasRealContent && !hasRecipeKeywords;

  const contentSection = useVisionForInstagram
    ? `這是一個 Instagram 帖子，有封面圖片但文字內容沒有明顯的食譜關鍵字。請使用提供的圖片進行視覺分析，識別菜餚並推斷食材和步驟。
    
Instagram 帖子文字內容：
${pageContent}

請根據圖片中的菜餚外觀和文字提示，生成合理的食譜。`
    : hasTitleOnly
    ? `以下是從${sourceType === "youtube" ? "YouTube 影片" : sourceType === "threads" ? "Threads 帖子" : "小紅書筆記"}頁面提取的資訊：

${pageContent}

注意：內容可能沒有完整食譜詳細資訊。請根據標題和描述推斷這是什麼類型的食譜，並生成合理的食材和步驟（標記為「根據標題推斷」）。sourceAuthor 使用上面的 Author 欄位。`
    : hasRealContent
    ? `以下是從網頁提取的實際內容：

${pageContent}

請根據上面的實際內容解析食譜。`
    : `網頁內容無法讀取（可能需要登入）。

URL: ${url}
Platform: ${sourceType}

請在 name 回傳"需要手動輸入"，在 description 說明"無法自動讀取此連結的內容，請使用「貼上文字」功能，從 ${sourceType === "instagram" ? "Instagram" : sourceType === "xiaohongshu" ? "小紅書" : sourceType === "threads" ? "Threads" : "YouTube"} 複製食譜文字後貼入。"`;

  const thumbnailUrlPlaceholder = effectiveThumbnail || "";

  const userPrompt = `${contentSection}

請回傳以下 JSON 格式：
{
  "name": "食譜名稱",
  "description": "簡短描述（1-2句）",
  "cookTime": 烹飪時間（分鐘，整數）,
  "servings": 份量（人數，整數）,
  "difficulty": "簡單" | "中等" | "困難",
  "recipeCategory": "粵菜" | "台式" | "日式" | "韓式" | "西式" | "甜品" | "湯水" | "快手菜" | "其他",
  "ingredients": [
    { "name": "食材名稱", "quantity": "數量", "unit": "單位", "category": "分類" }
  ],
  "steps": [
    { "instruction": "步驟說明", "duration": 分鐘（可選）, "tip": "小貼士（可選）" }
  ],
  "tags": ["標籤1", "標籤2"],
  "sourceAuthor": "創作者名稱",
  "thumbnailUrl": "${thumbnailUrlPlaceholder}"
}`;

  // For Instagram with thumbnail: use Vision AI to parse from image
  const visionImage: MessageContent = useVisionForInstagram && effectiveThumbnail
    ? [
        { type: "image_url", image_url: { url: effectiveThumbnail, detail: "high" } },
        { type: "text", text: userPrompt }
      ]
    : userPrompt;

  const response = await invokeLLM({
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
            tags: { type: "array", items: { type: "string" } },
            sourceAuthor: { type: "string" },
            thumbnailUrl: { type: "string" },
          },
          required: ["name", "description", "cookTime", "servings", "difficulty", "recipeCategory", "ingredients", "steps", "tags", "sourceAuthor", "thumbnailUrl"],
        },
      },
    },
  });

  const rawContent = response.choices[0]?.message?.content;
  const parsedContent = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
  if (!parsedContent) throw new Error("AI returned empty response");
  const result: any = extractJSON(parsedContent);
  if (!result.thumbnailUrl && effectiveThumbnail) result.thumbnailUrl = effectiveThumbnail;
  // Re-host external thumbnail to R2 so it works in preview
  const category = result.recipeCategory || "其他";
  if (result.thumbnailUrl) {
    result.thumbnailUrl = await rehostExternalImage(result.thumbnailUrl, category);
  }
  // Smart fallback: assign category-based cover if still no thumbnail
  if (!result.thumbnailUrl || result.thumbnailUrl === "") {
    const categoryCovers = FALLBACK_COVERS[category] || FALLBACK_COVERS["中菜"] || [DEFAULT_FALLBACK];
    const randomCover = categoryCovers[Math.floor(Math.random() * categoryCovers.length)];
    result.thumbnailUrl = randomCover;
  }
  // Determine parseReason based on result name
  if (!hasRealContent) {
    result.parseReason = "cannot_read";
  } else if (result.name === "無法解析" || result.name === "需要手動輸入") {
    result.parseReason = "no_recipe_content";
  } else {
    result.parseReason = "ok";
  }
  return result;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const recipesRouter = router({
  // ── Parse URL (AI extract recipe from IG/YouTube URL) ──────────────────────
  parseUrl: protectedProcedure
    .input(z.object({ url: z.string().url(), language: z.string().optional(), clientThumbnail: z.string().optional() }))
    .mutation(async ({ input }) => {
      const parsed = await parseRecipeFromUrl(input.url, input.language, input.clientThumbnail);
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
    .mutation(async ({ input }) => {
      const parsed = await parseTextToRecipe(input.text, input.language);
      return {
        ...parsed,
        sourceUrl: "",
        sourceType: "manual" as const,
        sourceUrlHash: "",
      };
    }),

  // ── Upload recipe screenshot (returns storage URL for Vision AI) ────────────
  uploadRecipeImage: protectedProcedure
    .input(z.object({
      base64: z.string(),
      mimeType: z.string().default("image/jpeg"),
    }))
    .mutation(async ({ input }) => {
      // Validate size: base64 of 4MB ≈ 5.5M chars
      if (input.base64.length > 5_500_000) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "圖片太大，請壓縮後再上傳（最大 4MB）" });
      }
      const buffer = Buffer.from(input.base64, "base64");
      const ext = input.mimeType.split("/")[1] || "jpg";
      const { key, url } = await storagePut(`recipe-screenshots/screenshot.${ext}`, buffer, input.mimeType);
      const backendHost = process.env.RAILWAY_PUBLIC_DOMAIN;
      return { key, url: url.startsWith("/") && backendHost ? `https://${backendHost}${url}` : url };
    }),

  // ── Parse Image (Vision AI: extract recipe from uploaded screenshot) ────────
  parseImage: protectedProcedure
    .input(z.object({
      storageKey: z.string(), // key returned by uploadRecipeImage
    }))
    .mutation(async ({ input }) => {
      // Build absolute URL for Vision API via storage signed URL
      const { storageGetSignedUrl } = await import("../storage");
      const imageUrl = await storageGetSignedUrl(input.storageKey);

      const systemPrompt = `你是一個專業的食譜創作助手。請仔細分析用戶上傳的圖片：
1. 如果圖片中有食物或菜餚，請根據外觀、顏色、質地和常見烹飪方式推測可能的食材和做法。
2. 如果圖片中同時有文字（例如食材清單、步驟），請把文字資訊作為輔助，提高準確度。
3. 只有在完全無法判斷圖片內容（例如圖片空白、過度模糊、或與食物無關）時，才在 name 回傳「需要手動輸入」，並在 description 說明原因。
請以繁體中文回傳，並使用以下 JSON 格式。食材分類規則：肉類、海鮮、蔬菜、調味料、乾貨、其他。`;

      const userPrompt = `請分析這張圖片，盡力識別或推測出食材和烹飪步驟。
請回傳以下 JSON 格式（所有文字使用繁體中文）：
{
  "name": "食譜名稱",
  "description": "簡短描述（1-2句）",
  "cookTime": 烹飪時間（分鐘，整數，如不確定填 30）,
  "servings": 份量（人數，整數，如不確定填 2）,
  "difficulty": "簡單" | "中等" | "困難",
  "recipeCategory": "粵菜" | "台式" | "日式" | "韓式" | "西式" | "甜品" | "湯水" | "快手菜" | "其他",
  "ingredients": [
    { "name": "食材名稱", "quantity": "數量", "unit": "單位", "category": "分類" }
  ],
  "steps": [
    { "instruction": "步驟說明", "duration": 分鐘（可選）, "tip": "小貼士（可選）" }
  ],
  "tags": ["標籤 1", "標籤 2"],
  "sourceAuthor": "創作者名稱（如圖片中有顯示）",
  "thumbnailUrl": ""
}`;

      const response = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
              { type: "text", text: userPrompt },
            ],
          },
        ],
        responseFormat: {
          type: "json_schema",
          json_schema: {
            name: "recipe_parse_image",
            strict: true,
            schema: {
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
                      tip: { type: "string" },
                    },
                    required: ["instruction"],
                  },
                },
                tags: { type: "array", items: { type: "string" } },
                sourceAuthor: { type: "string" },
                thumbnailUrl: { type: "string" },
              },
              required: ["name", "description", "cookTime", "servings", "difficulty", "recipeCategory", "ingredients", "steps", "tags", "sourceAuthor", "thumbnailUrl"],
            },
          },
        },
      });

      const rawContent = response.choices[0]?.message?.content;
      const parsedContent = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
      if (!parsedContent) throw new Error("AI returned empty response");
  const result: any = extractJSON(parsedContent);

      // Use real storage URL as thumbnail if AI didn't extract one
      if (!result.thumbnailUrl) {
        try {
          const { storageGet } = await import("../storage");
          const { url: realUrl } = await storageGet(input.storageKey);
          result.thumbnailUrl = realUrl;
        } catch {
          // Storage fetch failed — will fall back to category cover below
        }
      }

      // Smart fallback: assign category-based cover if still no thumbnail
      if (!result.thumbnailUrl || result.thumbnailUrl === "") {
        const category = result.recipeCategory || "其他";
        const categoryCovers = FALLBACK_COVERS[category] || FALLBACK_COVERS["中菜"] || [DEFAULT_FALLBACK];
        const randomCover = categoryCovers[Math.floor(Math.random() * categoryCovers.length)];
        result.thumbnailUrl = randomCover;
      }

      const hasContent = (result.ingredients && result.ingredients.length > 0) ||
        (result.steps && result.steps.length > 0);
      const parseReason = (result.name === "需要手動輸入" || result.name === "無法解析" || !hasContent)
        ? "no_recipe_content" as const
        : "ok" as const;

      return {
        ...result,
        parseReason,
        sourceUrl: "",
        sourceType: "manual" as const,
        sourceUrlHash: "",
      };
    }),

  // ── Check duplicate (by URL hash or name similarity) ──────────────────────
  checkDuplicate: publicProcedure
    .input(z.object({
      sourceUrl: z.string().optional(),
      name: z.string().optional(),
      familyId: z.number().int().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const urlHash = input.sourceUrl ? hashUrl(input.sourceUrl) : null;
      const familyId = input.familyId ?? ctx.activeFamilyId ?? null;
      const db = await getDb();
      if (!db) return { hasDuplicate: false, duplicates: [] };

      const duplicates: { type: "url" | "name"; source: "official" | "user"; id: number; name: string }[] = [];

      if (urlHash) {
        const existing = await db.select({ id: officialRecipes.id, name: officialRecipes.name })
          .from(officialRecipes)
          .where(eq(officialRecipes.sourceUrlHash, urlHash))
          .limit(1);
        if (existing.length > 0) {
          duplicates.push({ type: "url", source: "official", id: existing[0].id, name: existing[0].name });
        }
      }
      if (input.name) {
        const existing = await db.select({ id: officialRecipes.id, name: officialRecipes.name })
          .from(officialRecipes)
          .where(like(officialRecipes.name, `%${input.name}%`))
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
            .where(and(eq(customRecipes.familyId, familyId), like(customRecipes.name, `%${input.name}%`)))
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
      source: z.enum(["all", "official", "user"]).optional(),  // 搜尋來源：all=全部，official=只官方，user=只自訂
      limit: z.number().int().min(1).max(1000).default(20),
      offset: z.number().int().min(0).default(0),
      cursor: z.number().int().min(0).optional(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const db = await getDb();
        if (!db) return { recipes: [], total: 0, officialCount: 0, customCount: 0, nextCursor: undefined };

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
        ? [eq(customRecipes.familyId, ctx.activeFamilyId)]
        : []; // 無 familyId 時不加條件（雖然實際上唔會有 custom recipes）

      if (searchKeywords.length > 0) {  // 多關鍵字 AND 組合（每關鍵字再以繁/簡/同義詞 OR 擴充）
        const officialKeywordConditions = searchKeywords.map(kw => {
          const variants = getKeywordVariants(kw);
          return or(
            or(...variants.map(v => ilike(officialRecipes.name, `%${v}%`))),
            or(...variants.map(v => ilike(officialRecipes.description ?? "", `%${v}%`))),
            or(...variants.map(v => ilike(officialRecipes.ingredients ?? "", `%${v}%`))),
            or(...variants.map(v => ilike(officialRecipes.tags ?? "", `%${v}%`)))
          );
        });
        officialConditions.push(and(...officialKeywordConditions));

        const customKeywordConditions = searchKeywords.map(kw => {
          const variants = getKeywordVariants(kw);
          return or(
            or(...variants.map(v => ilike(customRecipes.name, `%${v}%`))),
            or(...variants.map(v => ilike(customRecipes.description ?? "", `%${v}%`))),
            or(...variants.map(v => ilike(customRecipes.ingredients ?? "", `%${v}%`))),
            or(...variants.map(v => ilike(customRecipes.tags ?? "", `%${v}%`)))
          );
        });
        customConditions.push(and(...customKeywordConditions));
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
      const shouldQueryOfficial = !input.source || input.source === "all" || input.source === "official";
      const shouldQueryCustom = !input.source || input.source === "all" || input.source === "user";

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
          .where(customConditions.length > 0 ? (customConditions.length > 1 ? and(...customConditions) : customConditions[0]) : undefined);
        totalCustom = Number(totalCustomResult[0]?.count ?? 0);
      }

      const total = totalOfficial + totalCustom;

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
      const customRows = shouldQueryCustom && customLimit > 0 && customConditions.length > 0
        ? await db.select().from(customRecipes)
          .where(customConditions.length > 1 ? and(...customConditions) : customConditions[0])
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
          tags: r.tags ? (() => {
            try {
              return JSON.parse(r.tags);
            } catch (e) {
              console.error(`Failed to parse tags for recipe ${r.id}:`, e);
              return [];
            }
          })() : [],
        })),
        ...customRows.map((r) => ({
          id: `user_${r.id}`,
          source: "custom" as const,
          name: r.name,
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
          tags: r.tags ? (() => {
            try {
              return JSON.parse(r.tags);
            } catch (e) {
              console.error(`Failed to parse tags for recipe ${r.id}:`, e);
              return [];
            }
          })() : [],
        })),
      ];

      // Calculate next cursor (global combined offset)
      const hasMore = offset + input.limit < total;
      const nextCursor = hasMore ? offset + input.limit : undefined;

      return { recipes, total, officialCount: totalOfficial, customCount: totalCustom, nextCursor };
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
          ingredients: JSON.stringify(recipe.ingredients),
          steps: JSON.stringify(recipe.steps),
          tags: JSON.stringify(recipe.tags || []),
          sourceType: "manual",
          sourceUrl: null,
          sourceUrlHash: null,
          sourceAuthor: null,
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

      const [inserted] = await db.insert(officialRecipes).values({
        importedByUserId: String(ctx.user.id),
        name: input.name,
        description: input.description,
        image: resolvedOfficialThumbnailUrl,
        thumbnailUrl: resolvedOfficialThumbnailUrl,
        cookTime: input.cookTime,
        servings: input.servings,
        difficulty: input.difficulty,
        recipeCategory: input.recipeCategory,
        ingredients: JSON.stringify(input.ingredients),
        steps: JSON.stringify(input.steps),
        tags: JSON.stringify(input.tags || []),
        sourceType: input.sourceUrl ? detectSourceType(input.sourceUrl) : "manual",
        sourceUrl: input.sourceUrl,
        sourceUrlHash: urlHash ?? undefined,
        sourceAuthor: input.sourceAuthor,
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
            ingredients: JSON.stringify(recipe.ingredients),
            steps: JSON.stringify(recipe.steps),
            tags: JSON.stringify(recipe.tags || []),
            sourceType: recipe.sourceUrl ? detectSourceType(recipe.sourceUrl) : "manual",
            sourceUrl: recipe.sourceUrl,
            sourceUrlHash: urlHash ?? undefined,
            sourceAuthor: recipe.sourceAuthor,
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
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
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
        (process.env.R2_PUBLIC_URL && rawThumb.startsWith(process.env.R2_PUBLIC_URL));
      if (rawThumb && !isManusStorage && !rawThumb.startsWith("/r2-storage/")) {
        try {
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

      const [inserted] = await db.insert(customRecipes).values({
        familyId: ctx.activeFamilyId,
        createdByUserId: String(ctx.user.id),
        name: input.name,
        description: input.description,
        image: resolvedThumbnailUrl,
        thumbnailUrl: resolvedThumbnailUrl,
        cookTime: input.cookTime,
        servings: input.servings,
        difficulty: input.difficulty,
        recipeCategory: input.recipeCategory,
        ingredients: JSON.stringify(input.ingredients),
        steps: JSON.stringify(input.steps),
        tags: JSON.stringify(input.tags || []),
        sourceType: input.sourceUrl ? detectSourceType(input.sourceUrl) : "manual",
        sourceUrl: input.sourceUrl,
        sourceUrlHash: urlHash ?? undefined,
        sourceAuthor: input.sourceAuthor,
        visibility: input.visibility,
      }).returning();

      return { success: true, id: inserted.id };
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
      visibility: z.enum(["private", "pending_public"]).default("private"),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) throw new TRPCError({ code: "BAD_REQUEST", message: "請先建立或加入家庭廚房，才能儲存食譜" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [inserted] = await db.insert(customRecipes).values({
        familyId: ctx.activeFamilyId,
        createdByUserId: String(ctx.user.id),
        name: input.name,
        description: input.description ?? "",
        image: input.image ?? "",
        thumbnailUrl: input.thumbnailUrl ?? input.image ?? "",
        cookTime: input.cookTime ?? 0,
        servings: input.servings ?? 2,
        difficulty: input.difficulty ?? "中等",
        recipeCategory: input.recipeCategory ?? "mixed",
        ingredients: JSON.stringify(input.ingredients),
        steps: JSON.stringify(input.steps),
        tags: JSON.stringify(input.tags ?? ["自訂", "我的食譜"]),
        sourceType: input.sourceUrl ? detectSourceType(input.sourceUrl) : "manual",
        sourceUrl: input.sourceUrl,
        sourceAuthor: input.sourceAuthor,
        visibility: input.visibility,
      }).returning();

      return { success: true, id: inserted.id };
    }),

  // ── User: update own recipe ────────────────────────────────────────────────
  updateUser: protectedProcedure
    .input(recipeInputSchema.extend({
      id: z.number().int(),
      visibility: z.enum(["private", "pending_public"]).default("private"),
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

      await db.update(customRecipes).set({
        name: input.name,
        description: input.description ?? "",
        image: input.image ?? "",
        thumbnailUrl: input.thumbnailUrl ?? input.image ?? "",
        cookTime: input.cookTime ?? 0,
        servings: input.servings ?? 2,
        difficulty: input.difficulty ?? "中等",
        recipeCategory: input.recipeCategory ?? "mixed",
        ingredients: JSON.stringify(input.ingredients),
        steps: JSON.stringify(input.steps),
        tags: JSON.stringify(input.tags ?? []),
        sourceType: input.sourceUrl ? detectSourceType(input.sourceUrl) : "manual",
        sourceUrl: input.sourceUrl,
        sourceAuthor: input.sourceAuthor,
        visibility: input.visibility,
        updatedAt: new Date(),
      }).where(eq(customRecipes.id, input.id));

      return { success: true };
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
        tags: JSON.stringify(input.tags ?? []),
        sourceType: 'manual',
        sourceAuthor: input.sourceAuthor ?? '',
        sourceUrl: input.sourceUrl ?? '',
        tips: input.tips ?? '',
        isActive: true,
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
        tags: JSON.stringify(input.tags ?? []),
        sourceAuthor: input.sourceAuthor ?? '',
        sourceUrl: input.sourceUrl ?? '',
        tips: input.tips ?? '',
        updatedAt: new Date(),
      }).where(eq(officialRecipes.id, input.id));
      return { success: true };
    }),

  // ── Get single recipe by id (supports official_ and user_ prefix) ─────────────
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
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }
      }

      return {
        ...r,
        id: `user_${r.id}`,
        ingredients: r.ingredients ? JSON.parse(r.ingredients) : [],
        steps: r.steps ? JSON.parse(r.steps) : [],
        tags: r.tags ? JSON.parse(r.tags) : [],
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

});
