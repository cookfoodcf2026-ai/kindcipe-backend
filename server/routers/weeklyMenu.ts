import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { getDb, getFamilySubscription, addMealPlanBatch } from "../db";
import { weeklyMenu, officialRecipes, mealPlans, customRecipes } from "../../drizzle/schema";
import { protectedProcedure, publicProcedure, adminProcedure, router } from "../_core/trpc";
import { invokeLLM, extractJSON } from "../_core/llm";

type SlotType = "meat" | "seafood" | "veg" | "soup";

// ─── Helper: Validate user recipe completeness ───────────────────────────────
const isValidUserRecipe = (r: typeof customRecipes.$inferSelect): boolean => {
  if (!r.name || r.name.trim() === "") return false;
  
  // Validate ingredients are present and non-empty
  try {
    const ing = r.ingredients ? JSON.parse(r.ingredients) : [];
    if (!Array.isArray(ing) || ing.length === 0) return false;
    // Check each ingredient has a name
    if (ing.some((i: any) => !i.name || i.name.trim() === "")) return false;
  } catch {
    return false;
  }
  
  // Validate steps are present and non-empty
  try {
    const steps = r.steps ? JSON.parse(r.steps) : [];
    if (!Array.isArray(steps) || steps.length === 0) return false;
  } catch {
    return false;
  }
  
  return true;
};

// ─── Helper: Detect dish type (meat/seafood/veg/soup) from name/ingredients ──
const detectDishType = (name: string, ingredients?: string | null): "meat" | "seafood" | "vegetable" | "soup" | "dessert" => {
  const nameLower = name.toLowerCase();
  const ingLower = ingredients ? ingredients.toLowerCase() : "";
  
  // Priority 1: Detect dessert (should not enter AI weekly menu 4-dish slots)
  if (nameLower.includes("蛋糕") || nameLower.includes("甜品") || nameLower.includes("布甸") ||
      nameLower.includes("撻") || nameLower.includes("餅") || nameLower.includes("糖水") ||
      nameLower.includes("sweet") || nameLower.includes("cake") || nameLower.includes("dessert") ||
      nameLower.includes("布丁") || nameLower.includes("冰淇淋") || nameLower.includes("雪糕")) {
    return "dessert";
  }
  
  // Priority 2: Detect soup
  if (nameLower.includes("湯") || nameLower.includes("粥") || nameLower.includes("燉") ||
      nameLower.includes("羹") || nameLower.includes("煲") || nameLower.includes("soup")) {
    return "soup";
  }
  
  // Priority 3: Detect seafood
  if (nameLower.includes("魚") || nameLower.includes("蝦") || nameLower.includes("蟹") ||
      nameLower.includes("蜆") || nameLower.includes("蠔") || nameLower.includes("海鮮") ||
      nameLower.includes("斑") || nameLower.includes("帶子") || nameLower.includes("魷魚") ||
      nameLower.includes("花甲") || nameLower.includes("蛤") || nameLower.includes("墨魚") ||
      nameLower.includes("八爪魚") || nameLower.includes("三文魚") || nameLower.includes("龍脷") ||
      nameLower.includes("魚") || nameLower.includes("魚") || nameLower.includes("seafood") ||
      nameLower.includes("fish") || nameLower.includes("prawn") || nameLower.includes("crab")) {
    return "seafood";
  }
  
  // Priority 4: Detect vegetable/egg/tofu
  if (nameLower.includes("菜") || nameLower.includes("瓜") || nameLower.includes("薯") ||
      nameLower.includes("豆腐") || nameLower.includes("蛋") || nameLower.includes("菇") ||
      nameLower.includes("茄子") || nameLower.includes("豆苗") || nameLower.includes("西蘭花") ||
      nameLower.includes("菠菜") || nameLower.includes("白菜") || nameLower.includes("芥蘭") ||
      nameLower.includes("通菜") || nameLower.includes("番茄") || nameLower.includes("蔬菜") ||
      nameLower.includes("veg") || nameLower.includes("tofu") || nameLower.includes("egg")) {
    return "vegetable";
  }
  
  // Default: meat
  return "meat";
};

// ─── Helper: Detect cuisine style from name/tags ─────────────────────────────
const detectCuisineStyle = (name: string, recipeCategory?: string | null, tags?: string | null): "chinese" | "western" | "japanese" | "korean" | "sea" | "other" => {
  const nameLower = name.toLowerCase();
  const catLower = (recipeCategory || "").toLowerCase();
  const tagsLower = (tags || "").toLowerCase();
  const combined = `${nameLower} ${catLower} ${tagsLower}`;
  
  // Western keywords
  const WESTERN_KEYWORDS = ["西餐", "意粉", "比薩", "", "烤", "扒", "芝士", "忌廉", "沙律", "意大利", "法式", "葡式", "德式", "美式", "西班牙", "羅勒", "橄欖", "牛扒", "豬扒", "雞扒", "western", "pasta", "pizza", "cheese", "cream", "salad", "steak"];
  // Japanese keywords
  const JAPANESE_KEYWORDS = ["日式", "照燒", "蒲燒", "咖哩", "味噌", "丼", "烏冬", "天婦羅", "壽司", "刺身", "拉麵", "蕎麥", "japanese", "sushi", "ramen", "tempura", "miso", "teriyaki"];
  // Korean keywords
  const KOREAN_KEYWORDS = ["韓式", "泡菜", "部隊鍋", "燒肉", "石鍋", "人參雞", "韓劇", "korean", "kimchi", "bbq", "bulgogi"];
  // Southeast Asian keywords
  const SEA_KEYWORDS = ["泰式", "越式", "印尼", "馬來", "冬蔭功", "沙爹", "肉骨茶", "椰漿", "咖喱", "東南亞", "thai", "vietnamese", "indonesian", "malaysian", "tom yum", "satay", "curry", "coconut"];
  // Chinese keywords
  const CHINESE_KEYWORDS = ["中菜", "港式", "粵式", "川", "湘", "上海", "北京", "台灣", "潮州", "豉油", "油", "叉燒", "燒味", "蒸", "炒", "燜", "煲", "花雕", "醉", "梅頭", "火腩", "肉餅", "chinese", "cantonese"];
  
  // Check category first (most reliable)
  if (catLower.includes("西餐") || catLower.includes("western")) return "western";
  if (catLower.includes("日式") || catLower.includes("japanese")) return "japanese";
  if (catLower.includes("韓式") || catLower.includes("korean")) return "korean";
  if (catLower.includes("東南亞") || catLower.includes("thai") || catLower.includes("vietnamese")) return "sea";
  if (catLower.includes("中菜") || catLower.includes("chinese")) return "chinese";
  
  // Check name and tags
  if (WESTERN_KEYWORDS.some(k => combined.includes(k))) return "western";
  if (JAPANESE_KEYWORDS.some(k => combined.includes(k))) return "japanese";
  if (KOREAN_KEYWORDS.some(k => combined.includes(k))) return "korean";
  if (SEA_KEYWORDS.some(k => combined.includes(k))) return "sea";
  if (CHINESE_KEYWORDS.some(k => combined.includes(k))) return "chinese";
  
  // Default to chinese (safest fallback for HK users)
  return "chinese";
};

// ─── Weather helper (Open-Meteo, no API key needed) ─────────────────────────
async function getHKWeather(): Promise<{ tempC: number; weatherCode: number; description: string; season: string }> {
  try {
    const url = "https://api.open-meteo.com/v1/forecast?latitude=22.3193&longitude=114.1694&current=temperature_2m,weathercode,precipitation&timezone=Asia%2FHong_Kong";
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const data = await res.json() as { current: { temperature_2m: number; weathercode: number } };
    const tempC = data.current.temperature_2m;
    const weatherCode = data.current.weathercode;
    let description = "晴朗";
    if (weatherCode >= 95) description = "雷暴";
    else if (weatherCode >= 80) description = "陣雨";
    else if (weatherCode >= 51) description = "下雨";
    else if (weatherCode >= 45) description = "有霧";
    else if (weatherCode >= 1) description = "多雲";
    const month = new Date().getMonth() + 1;
    let season = "秋季";
    if (month >= 3 && month <= 5) season = "春季";
    else if (month >= 6 && month <= 9) season = "夏季";
    else if (month >= 10 && month <= 11) season = "秋季";
    else season = "冬季";
    return { tempC, weatherCode, description, season };
  } catch {
    const month = new Date().getMonth() + 1;
    const season = month >= 6 && month <= 9 ? "夏季" : month >= 3 && month <= 5 ? "春季" : month >= 10 && month <= 11 ? "秋季" : "冬季";
    return { tempC: 25, weatherCode: 0, description: "晴朗", season };
  }
}

// Get Monday of the current week (ISO week start)
function getWeekStart(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

type RuleRecipe = { id: string; name: string; cookTime: number | null; tags: string[]; image: string | null; dishType: string };

/**
 * 規則式一週餐單（免費無限使用，毋須 AI）。
 * 依序輪換各類別食譜，避免重複最近食過的菜式。
 */
function buildRuleBasedWeek(
  byType: Record<"meat" | "seafood" | "vegetable" | "soup", RuleRecipe[]>,
  recentMeals: string[],
): Array<{
  dayOfWeek: number;
  meatId: string; meatReason: string;
  seafoodId: string; seafoodReason: string;
  vegId: string; vegReason: string;
  soupId: string; soupReason: string;
}> {
  const recentSet = new Set(recentMeals.map(m => m.trim()));
  const pick = (list: RuleRecipe[], offset: number, dayIndex: number) => {
    const sorted = [...list];
    sorted.sort((a, b) => Number(recentSet.has(a.name)) - Number(recentSet.has(b.name)));
    return sorted[(dayIndex + offset) % sorted.length];
  };
  const days: Array<{
    dayOfWeek: number;
    meatId: string; meatReason: string;
    seafoodId: string; seafoodReason: string;
    vegId: string; vegReason: string;
    soupId: string; soupReason: string;
  }> = [];
  for (let i = 1; i <= 7; i++) {
    const dayIndex = i - 1;
    const isWeekend = i >= 6;
    days.push({
      dayOfWeek: i,
      meatId: pick(byType.meat, 0, dayIndex).id,
      meatReason: isWeekend ? "週末可慢慢煮" : "快手家常菜",
      seafoodId: pick(byType.seafood, 1, dayIndex).id,
      seafoodReason: "均衡海鮮",
      vegId: pick(byType.vegetable, 2, dayIndex).id,
      vegReason: "清爽配菜",
      soupId: pick(byType.soup, 3, dayIndex).id,
      soupReason: "滋潤例湯",
    });
  }
  return days;
}

// ─── Zod schema for a single dish slot ───────────────────────────────────────
const dishSlotSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string().nullable().optional(),
  cookTime: z.number().nullable().optional(),
});

export const weeklyMenuRouter = router({
  /** Get this week's dinner recommendations (public) */
  getThisWeek: publicProcedure.query(async () => {
    const db = await getDb();
    const weekStart = getWeekStart();
    if (!db) return { weekStart, items: [] };
    const items = await db
      .select()
      .from(weeklyMenu)
      .where(and(eq(weeklyMenu.weekStart, weekStart), eq(weeklyMenu.familyId, 0)))
      .orderBy(weeklyMenu.dayOfWeek);
    return { weekStart, items };
  }),

  /** Get a specific week's menu (public) */
  getWeek: publicProcedure
    .input(z.object({ weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { weekStart: input.weekStart, items: [] };
      const items = await db
        .select()
        .from(weeklyMenu)
        .where(and(eq(weeklyMenu.weekStart, input.weekStart), eq(weeklyMenu.familyId, 0)))
        .orderBy(weeklyMenu.dayOfWeek);
      return { weekStart: input.weekStart, items };
    }),

  /** Admin: set a day's full 4-dish dinner */
  setDay: adminProcedure
    .input(
      z.object({
        weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        dayOfWeek: z.number().int().min(1).max(7),
        meat: dishSlotSchema.nullable().optional(),
        seafood: dishSlotSchema.nullable().optional(),
        veg: dishSlotSchema.nullable().optional(),
        soup: dishSlotSchema.nullable().optional(),
        sponsorName: z.string().optional(),
        sponsorUrl: z.string().optional(),
        sponsorLogoUrl: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      await db
        .insert(weeklyMenu)
        .values({
          familyId: 0,
          weekStart: input.weekStart,
          dayOfWeek: input.dayOfWeek,
          meatId: input.meat?.id ?? null,
          meatName: input.meat?.name ?? null,
          meatImage: input.meat?.image ?? null,
          meatCookTime: input.meat?.cookTime ?? null,
          seafoodId: input.seafood?.id ?? null,
          seafoodName: input.seafood?.name ?? null,
          seafoodImage: input.seafood?.image ?? null,
          seafoodCookTime: input.seafood?.cookTime ?? null,
          vegId: input.veg?.id ?? null,
          vegName: input.veg?.name ?? null,
          vegImage: input.veg?.image ?? null,
          vegCookTime: input.veg?.cookTime ?? null,
          soupId: input.soup?.id ?? null,
          soupName: input.soup?.name ?? null,
          soupImage: input.soup?.image ?? null,
          soupCookTime: input.soup?.cookTime ?? null,
          sponsorName: input.sponsorName ?? null,
          sponsorUrl: input.sponsorUrl ?? null,
          sponsorLogoUrl: input.sponsorLogoUrl ?? null,
          setByUserId: ctx.user.id,
        })
        .onConflictDoUpdate({
          target: [weeklyMenu.weekStart, weeklyMenu.dayOfWeek],
          set: {
            meatId: input.meat?.id ?? null,
            meatName: input.meat?.name ?? null,
            meatImage: input.meat?.image ?? null,
            meatCookTime: input.meat?.cookTime ?? null,
            seafoodId: input.seafood?.id ?? null,
            seafoodName: input.seafood?.name ?? null,
            seafoodImage: input.seafood?.image ?? null,
            seafoodCookTime: input.seafood?.cookTime ?? null,
            vegId: input.veg?.id ?? null,
            vegName: input.veg?.name ?? null,
            vegImage: input.veg?.image ?? null,
            vegCookTime: input.veg?.cookTime ?? null,
            soupId: input.soup?.id ?? null,
            soupName: input.soup?.name ?? null,
            soupImage: input.soup?.image ?? null,
            soupCookTime: input.soup?.cookTime ?? null,
            sponsorName: input.sponsorName ?? null,
            sponsorUrl: input.sponsorUrl ?? null,
            sponsorLogoUrl: input.sponsorLogoUrl ?? null,
            setByUserId: ctx.user.id,
          },
        });

      return { success: true };
    }),

  /** Admin: remove a day's recommendation */
  removeDay: adminProcedure
    .input(
      z.object({
        weekStart: z.string(),
        dayOfWeek: z.number().int().min(1).max(7),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db
        .delete(weeklyMenu)
        .where(
          and(
            eq(weeklyMenu.weekStart, input.weekStart),
            eq(weeklyMenu.dayOfWeek, input.dayOfWeek),
            eq(weeklyMenu.familyId, 0)
          )
        );
      return { success: true };
    }),

  /** Admin: bulk set the whole week at once (from AI suggest confirm) */
  setWeek: adminProcedure
    .input(
      z.object({
        weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        days: z.array(
          z.object({
            dayOfWeek: z.number().int().min(1).max(7),
            meat: dishSlotSchema.nullable().optional(),
            seafood: dishSlotSchema.nullable().optional(),
            veg: dishSlotSchema.nullable().optional(),
            soup: dishSlotSchema.nullable().optional(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      for (const d of input.days) {
        await db.insert(weeklyMenu).values({
          familyId: 0,
          weekStart: input.weekStart,
          dayOfWeek: d.dayOfWeek,
          meatId: d.meat?.id ?? null,
          meatName: d.meat?.name ?? null,
          meatImage: d.meat?.image ?? null,
          meatCookTime: d.meat?.cookTime ?? null,
          seafoodId: d.seafood?.id ?? null,
          seafoodName: d.seafood?.name ?? null,
          seafoodImage: d.seafood?.image ?? null,
          seafoodCookTime: d.seafood?.cookTime ?? null,
          vegId: d.veg?.id ?? null,
          vegName: d.veg?.name ?? null,
          vegImage: d.veg?.image ?? null,
          vegCookTime: d.veg?.cookTime ?? null,
          soupId: d.soup?.id ?? null,
          soupName: d.soup?.name ?? null,
          soupImage: d.soup?.image ?? null,
          soupCookTime: d.soup?.cookTime ?? null,
          sponsorName: null,
          sponsorUrl: null,
          sponsorLogoUrl: null,
          setByUserId: ctx.user.id,
        }).onConflictDoUpdate({
          target: [weeklyMenu.weekStart, weeklyMenu.dayOfWeek],
          set: {
            meatId: d.meat?.id ?? null,
            meatName: d.meat?.name ?? null,
            meatImage: d.meat?.image ?? null,
            meatCookTime: d.meat?.cookTime ?? null,
            seafoodId: d.seafood?.id ?? null,
            seafoodName: d.seafood?.name ?? null,
            seafoodImage: d.seafood?.image ?? null,
            seafoodCookTime: d.seafood?.cookTime ?? null,
            vegId: d.veg?.id ?? null,
            vegName: d.veg?.name ?? null,
            vegImage: d.veg?.image ?? null,
            vegCookTime: d.veg?.cookTime ?? null,
            soupId: d.soup?.id ?? null,
            soupName: d.soup?.name ?? null,
            soupImage: d.soup?.image ?? null,
            soupCookTime: d.soup?.cookTime ?? null,
            sponsorName: null,
            sponsorUrl: null,
            sponsorLogoUrl: null,
            setByUserId: ctx.user.id,
          },
        });
      }

      return { success: true, count: input.days.length };
    }),

  /** AI / 規則式 weekly dinner suggestion — 4 dishes per day, ONLY from DB recipes */
  aiSuggest: protectedProcedure
    .input(z.object({
      city: z.string().default("香港"),
      writeToMealPlans: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.activeFamilyRole !== "owner" && ctx.activeFamilyRole !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only family owner or admin can modify the weekly menu" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // 免費 = 規則式（無限、零 AI 成本）＋升級提示；付費 = AI 智能排程
      const sub = ctx.activeFamilyId ? await getFamilySubscription(ctx.activeFamilyId) : null;
      const isPaid = sub?.isPaid ?? false;

      // 1. Get current weather
      const weather = await getHKWeather();

      // 2. Get last 14 days of dinners to avoid repetition
      const today = new Date();
      const twoWeeksAgo = new Date(today);
      twoWeeksAgo.setDate(today.getDate() - 14);
      const startDate = twoWeeksAgo.toISOString().slice(0, 10);
      const endDate = today.toISOString().slice(0, 10);

      let recentMeals: string[] = [];
      if (ctx.activeFamilyId) {
        const { gte: gteOp, lte: lteOp } = await import("drizzle-orm");
        const plans = await db.select({ recipeName: mealPlans.recipeName })
          .from(mealPlans)
          .where(
            and(
              eq(mealPlans.familyId, ctx.activeFamilyId),
              eq(mealPlans.mealType, "dinner"),
              gteOp(mealPlans.date, startDate),
              lteOp(mealPlans.date, endDate)
            )
          )
          .orderBy(desc(mealPlans.createdAt))
          .limit(30);
        const seen = new Set<string>();
        recentMeals = plans.map(p => p.recipeName).filter(name => {
          if (seen.has(name)) return false;
          seen.add(name);
          return true;
        });
      }

      // 3. Get ALL active official recipes from DB — these are the ONLY source for AI
      const officialList = await db.select({
        id: officialRecipes.id,
        name: officialRecipes.name,
        cookTime: officialRecipes.cookTime,
        recipeCategory: officialRecipes.recipeCategory,
        thumbnailUrl: officialRecipes.thumbnailUrl,
        image: officialRecipes.image,
        tags: officialRecipes.tags,
      })
        .from(officialRecipes)
        .where(eq(officialRecipes.isActive, true))
        .orderBy(desc(officialRecipes.createdAt))
        .limit(100);

      // 4. Map category/tags to dishType
      const categoryToDishType = (cat: string | null, tagStr: string, recipeName: string): "meat" | "seafood" | "vegetable" | "soup" | "other" => {
        const c = (cat || "").toLowerCase();
        const t = tagStr.toLowerCase();
        const n = recipeName.toLowerCase();

        // Soup first (most specific) — check category, tags, AND name
        if (c.includes("soup") || c.includes("湯") || t.includes("湯水") || t.includes("老火湯") || t.includes("例湯") ||
            n.includes("湯") || n.includes("粥") || n.includes("燉")) return "soup";

        // Seafood — check category, tags, AND name
        if (c.includes("seafood") || c.includes("fish") || c.includes("海鮮") || c.includes("魚") || c.includes("蝦") || c.includes("蟹") ||
            t.includes("海鮮") || t.includes("魚") || t.includes("蝦") || t.includes("蟹") || t.includes("貝") || t.includes("帶子") ||
            n.includes("魚") || n.includes("蝦") || n.includes("蟹") || n.includes("帶子") || n.includes("海鮮") ||
            n.includes("三文魚") || n.includes("龍脷") || n.includes("鱸魚") || n.includes("鯇魚") || n.includes("鮭魚") ||
            n.includes("花甲") || n.includes("蛤") || n.includes("蠔") || n.includes("墨魚") || n.includes("魷魚") || n.includes("八爪魚")) return "seafood";

        // Vegetable / egg / tofu — check category, tags, AND name
        if (c.includes("vegetable") || c.includes("veg") || c.includes("蔬菜") || c.includes("素") || c.includes("蛋") || c.includes("豆腐") ||
            t.includes("蔬菜") || t.includes("素食") || t.includes("豆腐") || t.includes("蛋類") ||
            n.includes("豆腐") || n.includes("蛋") || n.includes("菜") || n.includes("瓜") || n.includes("薯") ||
            n.includes("菠菜") || n.includes("西蘭花") || n.includes("白菜") || n.includes("芥蘭") || n.includes("通菜") ||
            n.includes("炒蛋") || n.includes("蒸蛋") || n.includes("煎蛋") || n.includes("豆苗") || n.includes("番茄")) return "vegetable";

        // Meat — check category, tags, AND name
        if (c.includes("meat") || c.includes("pork") || c.includes("beef") || c.includes("chicken") || c.includes("poultry") ||
            c.includes("肉") || c.includes("豬") || c.includes("牛") || c.includes("雞") || c.includes("鴨") || c.includes("羊") ||
            t.includes("豬肉") || t.includes("牛肉") || t.includes("雞肉") || t.includes("鴨肉") ||
            n.includes("豬") || n.includes("牛") || n.includes("雞") || n.includes("鴨") || n.includes("羊") || n.includes("肉") ||
            n.includes("排骨") || n.includes("五花") || n.includes("腩") || n.includes("扒") || n.includes("叉燒") ||
            n.includes("炸雞") || n.includes("烤雞") || n.includes("白切雞") || n.includes("鹽焗雞")) return "meat";

        return "other";
      };

      const allDbRecipes = officialList.map(r => {
        let parsedTags: string[] = [];
        try { parsedTags = r.tags ? JSON.parse(r.tags) : []; } catch { parsedTags = []; }
        const tagStr = parsedTags.join(" ");
        const dishType = categoryToDishType(r.recipeCategory, tagStr, r.name);
        return {
          id: `official:${r.id}`,
          name: r.name,
          dishType,
          cookTime: r.cookTime,
          tags: parsedTags,
          // Store the real image URL directly from DB
          image: r.thumbnailUrl || r.image || null,
        };
      });

      const byType = {
        meat: allDbRecipes.filter(r => r.dishType === "meat"),
        seafood: allDbRecipes.filter(r => r.dishType === "seafood"),
        vegetable: allDbRecipes.filter(r => r.dishType === "vegetable"),
        soup: allDbRecipes.filter(r => r.dishType === "soup"),
      };

      // 5. Check if we have enough recipes in each category
      const missingCategories: string[] = [];
      if (byType.meat.length === 0) missingCategories.push("肉類");
      if (byType.seafood.length === 0) missingCategories.push("海鮮/魚");
      if (byType.vegetable.length === 0) missingCategories.push("蔬菜");
      if (byType.soup.length === 0) missingCategories.push("湯水");

      if (missingCategories.length > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `食譜庫中缺少以下類別的食譜：${missingCategories.join("、")}。請先在食譜庫中加入這些類別的食譜，AI 才能生成完整週餐推薦。`,
        });
      }

      // 6. 免費版：規則式生成（無限，零 AI 成本）；付費版：AI 智能排程
      let parsed: {
        reasoning: string;
        days: Array<{
          dayOfWeek: number;
          meatId: string; meatReason: string;
          seafoodId: string; seafoodReason: string;
          vegId: string; vegReason: string;
          soupId: string; soupReason: string;
        }>;
      } | null = null;
      if (!isPaid) {
        parsed = {
          reasoning: "規則式週餐（免費版）：按食譜庫輪換安排，避免重複近日菜式。升級家庭版可享 AI 智能排程。",
          days: buildRuleBasedWeek(byType, recentMeals),
        };
      }

      if (!parsed) {
        // 7. Build AI prompt — only IDs from DB, AI picks from the list
        const systemPrompt = `你是「煮飯啦 Cookfood」的 AI 家庭晚餐規劃助手。
每天晚餐固定為四道菜：
- 肉類主餸（meat）：1 道豬/牛/雞等肉類菜式
- 海鮮/魚副餸（seafood）：1 道海鮮或魚類菜式
- 蔬菜（vegetable）：1 道蔬菜或蛋豆腐類菜式
- 湯（soup）：1 道例湯或老火湯

規則：
1. 平日（週一至週五）以簡單快手菜式為主（30分鐘內）
2. 週末（週六、週日）可安排較複雜或耗時的菜式
3. 天氣熱時（>28°C）偏向清淡、蒸煮菜式；天氣涼時（<18°C）偏向燉煮、熱氣菜式
4. 避免同週連續兩天出現相同肉類（如連續雞肉）
5. 將最近 2 週已吃過的菜式列為低優先
6. 必須從提供的食譜清單中選擇，不能發明新食譜
7. 每道菜必須使用對應類別的食譜（肉類用 meat 清單，海鮮用 seafood 清單，蔬菜用 vegetable 清單，湯用 soup 清單）
8. 回覆的 ID 必須完全符合清單中的 id 欄位，不得修改
9. **每天的四道菜必須統一風格**：如果肉類主餸係中式（如港式、粵式），咁海鮮、蔬菜、湯都必須係中式；如果主係西式（如意粉、扒類），咁其他三道都應該係西式。避免同一餐出現中西混合（例如：豬扒飯 + 意大利湯）。
10. **一星期 7 日中，必須有 5 日係中式餐單**：因為中菜食譜最充足（170 個），而且符合香港人飲食習慣。其餘 2 日優先選擇西餐或日式（兩者優先級相同），如果唔夠就用東南亞或韓式 fallback。
11. **你可以使用用戶自訂食譜**：用戶食譜會同官方食譜混合一齊，用戶食譜可能有唔同嘅風格同創意。如果用戶食譜唔完整（冇食材/步驟），系統已經過濾咗，你唔使擔心。
12. **重要：你必須從上面提供的食譜清單選擇 ID，唔可以發明新 ID**：
    - 每個 ID 必須完全匹配清單中的 id 欄位（例如：「official:123」或「user:456」）
    - 如果你選擇一個唔存在 ID，系統會自動替你換成第一個食譜，並記錄低個錯誤
    - 為咗最佳體驗，請仔細檢查你選擇嘅每個 ID 是否清單入面

必須用 JSON 格式回覆：
{
  "reasoning": "簡述本週安排思路（不超過 80 字）",
  "days": [
    {
      "dayOfWeek": 1,
      "meatId": "official:123",
      "meatReason": "簡短理由",
      "seafoodId": "official:456",
      "seafoodReason": "簡短理由",
      "vegId": "official:789",
      "vegReason": "簡短理由",
      "soupId": "official:101",
      "soupReason": "簡短理由"
    },
    ...
  ]
}
dayOfWeek: 1=週一, 2=週二, ..., 7=週日，必須包含全部 7 天。`;

      const userPrompt = `目前情況：
- 城市：${input.city}
- 天氣：${weather.description}，氣溫 ${weather.tempC.toFixed(1)}°C
- 季節：${weather.season}
- 最近 2 週晚餐：${recentMeals.length > 0 ? recentMeals.join("、") : "暫無記錄"}

可用食譜清單（必須從以下清單選擇，使用完整 id 欄位）：

【肉類 meat】
${JSON.stringify(byType.meat.map(r => ({ id: r.id, name: r.name, cookTime: r.cookTime, tags: r.tags })))}

【海鮮/魚 seafood】
${JSON.stringify(byType.seafood.map(r => ({ id: r.id, name: r.name, cookTime: r.cookTime, tags: r.tags })))}

【蔬菜 vegetable】
${JSON.stringify(byType.vegetable.map(r => ({ id: r.id, name: r.name, cookTime: r.cookTime, tags: r.tags })))}

【湯 soup】
${JSON.stringify(byType.soup.map(r => ({ id: r.id, name: r.name, cookTime: r.cookTime, tags: r.tags })))}

請為本週安排 7 天晚餐，每天各選 1 肉類、1 海鮮/魚、1 蔬菜、1 湯。`;

      const llmResponse = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        responseFormat: {
          type: "json_schema",
          json_schema: {
            name: "weekly_menu_4dish",
            strict: true,
            schema: {
              type: "object",
              properties: {
                reasoning: { type: "string" },
                days: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      dayOfWeek: { type: "integer" },
                      meatId: { type: "string" },
                      meatReason: { type: "string" },
                      seafoodId: { type: "string" },
                      seafoodReason: { type: "string" },
                      vegId: { type: "string" },
                      vegReason: { type: "string" },
                      soupId: { type: "string" },
                      soupReason: { type: "string" },
                    },
                    required: ["dayOfWeek", "meatId", "meatReason", "seafoodId", "seafoodReason", "vegId", "vegReason", "soupId", "soupReason"],
                  },
                },
              },
              required: ["reasoning", "days"],
            },
          },
        },
      });

      const rawContent = llmResponse.choices?.[0]?.message?.content;
      const content = typeof rawContent === "string" ? rawContent : null;
      if (!content) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未返回結果" });

      try {
        parsed = extractJSON(content);
      } catch {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 返回格式錯誤" });
      }
      }

      if (!parsed) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未返回結果" });
      }

      // Build a lookup map from DB recipes (id → full recipe info with real image)
      const recipeMap = new Map(allDbRecipes.map(r => [r.id, r]));

      // Validate and fill missing days
      const dayMap = new Map<number, any>();
      parsed.days
        .filter(d => d.dayOfWeek >= 1 && d.dayOfWeek <= 7)
        .forEach((d: any) => {
          dayMap.set(d.dayOfWeek, d);
        });
      const validDays = Array.from(dayMap.values());
      const uniqueDayNums = new Set(validDays.map(d => d.dayOfWeek));
      if (uniqueDayNums.size < 7) {
        // Fill missing days with first available recipe in each category
        const fallbackMeat = byType.meat[0]?.id;
        const fallbackSeafood = byType.seafood[0]?.id;
        const fallbackVeg = byType.vegetable[0]?.id;
        const fallbackSoup = byType.soup[0]?.id;
        if (fallbackMeat && fallbackSeafood && fallbackVeg && fallbackSoup) {
          for (let i = 1; i <= 7; i++) {
            if (!uniqueDayNums.has(i)) {
              validDays.push({
                dayOfWeek: i,
                meatId: fallbackMeat, meatReason: "AI 補充",
                seafoodId: fallbackSeafood, seafoodReason: "AI 補充",
                vegId: fallbackVeg, vegReason: "AI 補充",
                soupId: fallbackSoup, soupReason: "AI 補充",
              });
            }
          }
        }
      }
      validDays.sort((a, b) => a.dayOfWeek - b.dayOfWeek);

      // Enrich with REAL recipe data from DB — image always comes from DB record
      const enrichedDays = validDays.map(d => {
        const getInfo = (id: string | null, reason: string, slotType: SlotType) => {
          if (!id) {
            // ID 為 null，返回空 slot
            return { id: null, name: null, image: null, cookTime: null, reason: null };
          }
          const r = recipeMap.get(id);
          if (!r) {
            // 無效 ID → 自動替換為同類別第一個有效食譜
            const fallback = byType[slotType as keyof typeof byType][0];
            if (!fallback) {
              // 如果連 fallback 都冇，返回 null
              return { id: null, name: null, image: null, cookTime: null, reason: null };
            }
            
            // 內部記錄 AI 錯誤（開發用）
            console.warn(`[AI Weekly Menu] Invalid recipe ID detected: ${id}`);
            console.warn(`  → Day: ${d.dayOfWeek}, Slot: ${slotType}`);
            console.warn(`  → Replaced with: ${fallback.name} (${fallback.id})`);
            
            return {
              id: fallback.id,
              name: fallback.name,
              image: fallback.image,
              cookTime: fallback.cookTime ?? null,
              reason: reason || `自動替換（原 ID: ${id} 無效）`,
            };
          }
          return {
            id: r.id,
            name: r.name,
            image: r.image, // Always from DB, never invented
            cookTime: r.cookTime ?? null,
            reason,
          };
        };
        return {
          dayOfWeek: d.dayOfWeek,
          meat: getInfo(d.meatId, d.meatReason, "meat"),
          seafood: getInfo(d.seafoodId, d.seafoodReason, "seafood"),
          veg: getInfo(d.vegId, d.vegReason, "veg"),
          soup: getInfo(d.soupId, d.soupReason, "soup"),
        };
      });
      // 8. 寫入自己廚房嘅 mealPlans（每日晚餐 4 道菜）
      if (input.writeToMealPlans && ctx.activeFamilyId && enrichedDays.length > 0) {
        const weekStart = getWeekStart();
        const base = new Date(`${weekStart}T00:00:00`);
        const userId = String(ctx.user.id);
        const rows: Array<{
          familyId: number;
          date: string;
          mealType: "dinner";
          recipeId: string;
          recipeName: string;
          recipeImage: string | null;
          status: "confirmed";
          proposedByUserId: string;
          proposedByName: string;
        }> = [];
        for (const d of enrichedDays) {
          const date = new Date(base);
          date.setDate(base.getDate() + (d.dayOfWeek - 1));
          const ds = date.toISOString().slice(0, 10);
          for (const key of ["meat", "seafood", "veg", "soup"] as const) {
            const info = (d as any)[key] as { id: string | null; name: string | null; image: string | null };
            if (info?.id && info.name) {
              rows.push({
                familyId: ctx.activeFamilyId,
                date: ds,
                mealType: "dinner",
                recipeId: info.id,
                recipeName: info.name,
                recipeImage: info.image,
                status: "confirmed",
                proposedByUserId: userId,
                proposedByName: ctx.user.name || "",
              });
            }
          }
        }
        if (rows.length > 0) await addMealPlanBatch(rows);
      }

      return {
        reasoning: parsed.reasoning,
        weather,
        days: enrichedDays,
        upgradeRequired: !isPaid,
      };
    }),
});
