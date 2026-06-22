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
import { invokeLLM, MessageContent, TextContent, ImageContent } from "../_core/llm";
import { getDb } from "../db";
import { customRecipes, officialRecipes } from "../../drizzle/schema";
import { eq, and, desc, like } from "drizzle-orm";
import crypto from "crypto";
import { storagePut } from "../storage";
import { ENV } from "../_core/env";

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

async function parseTextToRecipe(text: string): Promise<{
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
}> {
  const systemPrompt = `你是一個專業的食譜解析助手。從用戶貼上的文字（可能來自小紅書、WhatsApp、網站等）中提取完整的食譜資訊並以 JSON 格式回傳。
  
  食材分類規則：
  - 肉類：豬肉、牛肉、雞肉、羊肉等
  - 海鮮：魚、蝦、蟹、貝類等
  - 蔬菜：各類蔬菜
  - 調味料：醬油、鹽、糖、油等
  - 乾貨：粉絲、木耳、腐竹等
  - 其他：不屬於以上分類的食材`;

  const userPrompt = `請從以下食譜文字中提取食譜資訊：

---
${text}
---

請回傳以下 JSON 格式（所有文字使用繁體中文）：
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
    { "instruction": "步驟說明", "duration": 秒數（可選）, "tip": "小貼士（可選）" }
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
  return JSON.parse(content);
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

      // Step 1: RapidAPI Instagram Scraper (primary method)
      const rapidApiKey = ENV.rapidApiKey;
      if (rapidApiKey) {
        try {
          // Extract shortcode from URL (e.g. /reel/DYtC5HfIEEU/ → DYtC5HfIEEU)
          const shortcodeMatch = url.match(/\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/);
          const shortcode = shortcodeMatch?.[1] ?? "";
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
              if (thumbMatch) igThumbnail = thumbMatch[1];
            }
          }
        } catch { /* continue */ }
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

async function parseRecipeFromUrl(url: string): Promise<{
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

  // Step 1: Try to fetch real page content
  const { text: pageContent, thumbnail: fetchedThumbnail } = await fetchPageContent(url);
  const hasRealContent = pageContent.length > 30;

  // Detect if content has actual recipe info (ingredients/steps keywords)
  const hasRecipeKeywords = /材料|食材|做法|步驟|ingredient|step|recipe|gram|ml|tbsp|tsp|大匙|小匙|克|公克|毫升|份量|人份|準備|醃|炒|煮|蒸|烤|炸/i.test(pageContent);

  // If we have text but NO recipe keywords AND no thumbnail to try Vision → return early
  if (hasRealContent && !hasRecipeKeywords && sourceType === "instagram" && !fetchedThumbnail) {
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
      thumbnailUrl: fetchedThumbnail,
      parseReason: "no_recipe_content" as const,
    };
  }

  const systemPrompt = `你是一個專業的食譜解析助手。從提供的內容中提取完整的食譜資訊並以 JSON 格式回傳。

重要規則：
- 只提取內容中實際存在的食譜資訊，不要虛構或猜測
- 如果內容中沒有食譜資訊，請在 name 回傳"無法解析"，並在 description 說明原因
- 食材分類：肉類/海鮮/蔬菜/調味料/乾貨/其他
- 所有文字使用繁體中文`;

  // For YouTube/Xiaohongshu: even if we have title/author, the description may not contain full recipe steps.
  const hasTitleOnly = (sourceType === "youtube" || sourceType === "xiaohongshu" || sourceType === "threads") && hasRealContent && !hasRecipeKeywords;

  const contentSection = hasTitleOnly
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

  const thumbnailUrlPlaceholder = fetchedThumbnail || "";

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
    { "instruction": "步驟說明", "duration": 秒數（可選）, "tip": "小貼士（可選）" }
  ],
  "tags": ["標籤1", "標籤2"],
  "sourceAuthor": "創作者名稱",
  "thumbnailUrl": "${thumbnailUrlPlaceholder}"
}`;

  // Download thumbnail and convert to base64 (DashScope can't fetch IG CDN directly)
  let visionImage: MessageContent = userPrompt;
  if (fetchedThumbnail) {
    try {
      const imgResp = await fetch(fetchedThumbnail, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
          "Referer": "https://www.instagram.com/",
        },
        signal: AbortSignal.timeout(8000),
      });
      if (imgResp.ok) {
        const contentType = imgResp.headers.get("content-type") || "image/jpeg";
        const buf = Buffer.from(await imgResp.arrayBuffer());
        const b64 = buf.toString("base64");
        visionImage = [
          { type: "image_url", image_url: { url: `data:${contentType};base64,${b64}` } },
          { type: "text", text: userPrompt },
        ];
      }
    } catch { /* if download fails, fall back to text-only */ }
  }

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
  const result = JSON.parse(parsedContent);
  if (!result.thumbnailUrl && fetchedThumbnail) result.thumbnailUrl = fetchedThumbnail;
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
  parseUrl: publicProcedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ input }) => {
      const parsed = await parseRecipeFromUrl(input.url);
      return {
        ...parsed,
        sourceUrl: input.url,
        sourceType: detectSourceType(input.url),
        sourceUrlHash: hashUrl(input.url),
      };
    }),

  // ── Parse Text (AI extract recipe from pasted text, e.g. 小紅書) ────────────
  parseText: publicProcedure
    .input(z.object({ text: z.string().min(10).max(5000) }))
    .mutation(async ({ input }) => {
      const parsed = await parseTextToRecipe(input.text);
      return {
        ...parsed,
        sourceUrl: "",
        sourceType: "manual" as const,
        sourceUrlHash: "",
      };
    }),

  // ── Upload recipe screenshot (returns storage URL for Vision AI) ────────────
  uploadRecipeImage: publicProcedure
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
      return { key, url };
    }),

  // ── Parse Image (Vision AI: extract recipe from uploaded screenshot) ────────
  parseImage: publicProcedure
    .input(z.object({
      storageKey: z.string(), // key returned by uploadRecipeImage
    }))
    .mutation(async ({ input }) => {
      // Build absolute URL for Vision API via storage signed URL
      const { storageGetSignedUrl } = await import("../storage");
      const imageUrl = await storageGetSignedUrl(input.storageKey);

      const systemPrompt = `你是一個專業的食譜解析助手。用戶上傳了一張食譜截圖（來自 Instagram、小紅書、YouTube 等社交媒體）。
請仔細分析圖片中的所有文字，提取完整的食譜資訊並以 JSON 格式回傳。
如果圖片中沒有足夠的食譜資訊，請在 name 回傳「需要手動輸入」，並在 description 說明原因。
食材分類規則：肉類、海鮮、蔬菜、調味料、乾貨、其他。`;

      const userPrompt = `請分析這張食譜截圖，提取所有可見的食材、份量和烹飪步驟。
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
    { "instruction": "步驟說明", "duration": 秒數（可選）, "tip": "小貼士（可選）" }
  ],
  "tags": ["標籤1", "標籤2"],
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
      const result = JSON.parse(parsedContent);

      // Use real storage URL as thumbnail if AI didn't extract one
      if (!result.thumbnailUrl) {
        const { storageGet } = await import("../storage");
        const { url: realUrl } = await storageGet(input.storageKey);
        result.thumbnailUrl = realUrl;
      }

      const parseReason = (result.name === "需要手動輸入" || result.name === "無法解析")
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
      limit: z.number().int().min(1).max(500).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select().from(officialRecipes)
        .where(eq(officialRecipes.isActive, true))
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
            resolvedOfficialThumbnailUrl = url;
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
            const key = `recipe-thumbnails/user-${ctx.user.id}-${Date.now()}.${ext}`;
            const { url } = await storagePut(key, buf, contentType);
            resolvedThumbnailUrl = url;
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
        sourceType: "manual",
        visibility: input.visibility,
      });

      return { success: true, id: (inserted as { insertId: number }).insertId };
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
      });
      return { success: true, id: (inserted as { insertId: number }).insertId };
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

      return {
        ...r,
        id: `user_${r.id}`,
        ingredients: r.ingredients ? JSON.parse(r.ingredients) : [],
        steps: r.steps ? JSON.parse(r.steps) : [],
        tags: r.tags ? JSON.parse(r.tags) : [],
        source: "user" as const,
      };
    }),

});
