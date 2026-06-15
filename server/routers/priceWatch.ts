/**
 * 消委會格價 API 路由
 * 資料來源：消費者委員會「網上價格一覽通」
 * API URL: https://online-price-watch.consumer.org.hk/opw/opendata/pricewatch.json
 * 更新頻率：每日
 * 涵蓋超市：惠康、百佳、Market Place、屈臣氏、AEON、大昌食品
 */
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";

// 超市代碼對照表
const SUPERMARKET_NAMES: Record<string, string> = {
  WELLCOME: "惠康",
  PARKNSHOP: "百佳",
  JASONS: "Market Place",
  WATSONS: "屈臣氏",
  AEON: "AEON",
  DCHFOOD: "大昌食品",
};

// 快取：避免每次請求都重新下載 2.5MB 資料
let cachedData: PriceWatchItem[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 小時快取

interface PriceEntry {
  supermarketCode: string;
  price: string;
}

interface OfferEntry {
  supermarketCode: string;
  "zh-Hant"?: string;
  en?: string;
}

interface PriceWatchItem {
  code: string;
  brand: { en?: string; "zh-Hant"?: string };
  name: { en?: string; "zh-Hant"?: string };
  cat1Name?: { en?: string; "zh-Hant"?: string };
  cat2Name?: { en?: string; "zh-Hant"?: string };
  cat3Name?: { en?: string; "zh-Hant"?: string };
  prices: PriceEntry[];
  offers?: OfferEntry[];
}

async function fetchPriceWatchData(): Promise<PriceWatchItem[]> {
  const now = Date.now();
  if (cachedData && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedData;
  }
  try {
    const res = await fetch(
      "https://online-price-watch.consumer.org.hk/opw/opendata/pricewatch.json",
      { signal: AbortSignal.timeout(15000) }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as PriceWatchItem[];
    cachedData = data;
    cacheTimestamp = now;
    return data;
  } catch (err) {
    console.error("[priceWatch] Failed to fetch data:", err);
    if (cachedData) return cachedData; // 失敗時返回舊快取
    return [];
  }
}

/**
 * 搜尋食材關鍵字，返回最相關的格價結果
 * 策略：精確匹配 > 包含匹配 > 部分匹配
 */
function searchIngredient(data: PriceWatchItem[], keyword: string): PriceWatchItem[] {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return [];

  // 移除常見量詞（避免干擾搜尋）
  const cleanKw = kw
    .replace(/\d+/g, "")
    .replace(/(克|毫升|ml|g|kg|個|隻|條|包|罐|瓶|袋|盒)/gi, "")
    .trim();

  const exact: PriceWatchItem[] = [];
  const contains: PriceWatchItem[] = [];

  // 短關鍵字（≤2個字）禁用反向包含匹配，避免「鹽」匹配到「含鹽牛油」
  const isShortKeyword = cleanKw.length <= 2;

  for (const item of data) {
    const nameTc = (item.name["zh-Hant"] || "").toLowerCase();
    const nameEn = (item.name.en || "").toLowerCase();
    const brandTc = (item.brand["zh-Hant"] || "").toLowerCase();

    if (nameTc === cleanKw || nameEn === cleanKw) {
      exact.push(item);
    } else if (
      nameTc.includes(cleanKw) ||
      nameEn.includes(cleanKw) ||
      // 短關鍵字不做反向包含：避免「鹽」→「含鹽牛油」
      (!isShortKeyword && cleanKw.includes(nameTc)) ||
      brandTc.includes(cleanKw)
    ) {
      contains.push(item);
    }
  }

  // 返回最多 5 個結果（精確優先）
  return [...exact, ...contains].slice(0, 5);
}

export const priceWatchRouter = router({
  /**
   * 搜尋單一食材的格價
   */
  search: publicProcedure
    .input(
      z.object({
        keyword: z.string().min(1).max(50),
      })
    )
    .query(async ({ input }) => {
      const data = await fetchPriceWatchData();
      const results = searchIngredient(data, input.keyword);

      return results.map((item) => ({
        code: item.code,
        name: item.name["zh-Hant"] || item.name.en || "",
        nameEn: item.name.en || "",
        brand: item.brand["zh-Hant"] || item.brand.en || "",
        category: item.cat2Name?.["zh-Hant"] || item.cat1Name?.["zh-Hant"] || "",
        prices: item.prices.map((p) => ({
          supermarketCode: p.supermarketCode,
          supermarketName: SUPERMARKET_NAMES[p.supermarketCode] || p.supermarketCode,
          price: parseFloat(p.price),
        })),
        offers: (item.offers || []).map((o) => ({
          supermarketCode: o.supermarketCode,
          supermarketName: SUPERMARKET_NAMES[o.supermarketCode] || o.supermarketCode,
          text: o["zh-Hant"] || o.en || "",
        })),
        dataSource: "消費者委員會",
        dataSourceUrl: "https://online-price-watch.consumer.org.hk",
      }));
    }),

  /**
   * 批量搜尋多個食材的格價（食譜詳情頁用）
   */
  batchSearch: publicProcedure
    .input(
      z.object({
        keywords: z.array(z.string().min(1).max(50)).max(30),
      })
    )
    .query(async ({ input }) => {
      const data = await fetchPriceWatchData();

      const results: Record<
        string,
        {
          found: boolean;
          items: {
            code: string;
            name: string;
            brand: string;
            prices: { supermarketCode: string; supermarketName: string; price: number }[];
            offers: { supermarketCode: string; supermarketName: string; text: string }[];
          }[];
        }
      > = {};

      for (const keyword of input.keywords) {
        const matches = searchIngredient(data, keyword);
        results[keyword] = {
          found: matches.length > 0,
          items: matches.map((item) => ({
            code: item.code,
            name: item.name["zh-Hant"] || item.name.en || "",
            brand: item.brand["zh-Hant"] || item.brand.en || "",
            prices: item.prices.map((p) => ({
              supermarketCode: p.supermarketCode,
              supermarketName: SUPERMARKET_NAMES[p.supermarketCode] || p.supermarketCode,
              price: parseFloat(p.price),
            })),
            offers: (item.offers || []).map((o) => ({
              supermarketCode: o.supermarketCode,
              supermarketName: SUPERMARKET_NAMES[o.supermarketCode] || o.supermarketCode,
              text: o["zh-Hant"] || o.en || "",
            })),
          })),
        };
      }

      return {
        results,
        dataSource: "消費者委員會",
        dataSourceUrl: "https://online-price-watch.consumer.org.hk",
        totalItems: data.length,
        // 資料快取時間（毫秒 UTC）
        dataFetchedAt: cacheTimestamp > 0 ? cacheTimestamp : Date.now(),
      };
    }),
});
