import { TRPCError } from "@trpc/server";
import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { familyWriteProcedure, protectedProcedure, router } from "../_core/trpc";
import { customRecipes, mealPlans, officialRecipes, shoppingItems } from "../../drizzle/schema";
import { getDb } from "../db";
import { getFamilyEntitlements } from "../services/entitlements";
import { commitUsageInTransaction, reserveUsageInTransaction, usageLimitToTRPC } from "../services/usage";
import {
  PRO_REQUIRED_REASON,
  evaluatePlanItemGate,
  proRequiredError,
} from "../lib/mealPlanProGate";
import { categorizeIngredientName, hasUsableMainIngredient, isUsableIngredientName, normalizeRecipeIngredients } from "../utils/ingredientNormalize";
import { enforceDiversity } from "../utils/mealDiversity";
import {
  execSearchRecipes,
  getFamilySeenNamesSplit,
  mkExcludeSets,
  pickSoupMeal,
  recordFamilySeenNames,
  type SuggestedRecipe,
} from "./aiRecipe";

/** 以 familyId + 日期做種子的洗牌：每個廚房每日唔同，同一廚房同日重試穩定。 */
function seededShuffle<T>(arr: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  let state = h >>> 0;
  const rnd = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function recipeRef(recipe: SuggestedRecipe): string | null {
  if (recipe.officialId != null) return `official_${recipe.officialId}`;
  if (recipe.customId != null) return `user_${recipe.customId}`;
  return null;
}

/** onboarding 三組預先審核嘅新手餐單（湯 / 肉 / 海鮮或蛋 / 菜） */
const STARTER_SETS: string[][] = [
  ["粟米蛋花湯", "豉汁蒸排骨", "蝦仁炒蛋", "蒜蓉炒菜心"],
  ["紫菜豆腐魚蛋湯", "豉油雞翼", "勝瓜炒蝦仁", "白灼蠔油菜心"],
  ["生菜魚肉", "蒜蓉豆豉蒸雞髀肉", "花甲蒸水蛋", "魚香茄子"],
];

const STARTER_NAMES = new Set(STARTER_SETS.flat().map((name) => name.trim()));

const APP_TIMEZONE = process.env.APP_TIMEZONE ?? "Asia/Hong_Kong";

function isoDateInAppTimezone(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function isTodayOrTomorrow(dateStr: string): boolean {
  const today = isoDateInAppTimezone();
  return dateStr === today || dateStr === addDays(today, 1);
}

function parseRecipeRef(recipeId: string): { kind: "official" | "user"; id: number } | null {
  const match = /^(official|user)_(\d+)$/.exec(recipeId);
  if (!match) return null;
  return { kind: match[1] as "official" | "user", id: Number(match[2]) };
}

function toPlanRecipe(recipe: SuggestedRecipe) {
  return {
    recipeId: recipeRef(recipe),
    name: recipe.name,
    nameEn: recipe.nameEn,
    nameFil: recipe.nameFil,
    nameId: recipe.nameId,
    description: recipe.description,
    descriptionEn: recipe.descriptionEn,
    descriptionFil: recipe.descriptionFil,
    descriptionId: recipe.descriptionId,
    cookTime: recipe.cookTime,
    servings: recipe.servings,
    difficulty: recipe.difficulty,
    ingredients: recipe.ingredients.filter((ing) => isUsableIngredientName(ing.name)),
    steps: recipe.steps,
    stepsEn: recipe.stepsEn,
    stepsFil: recipe.stepsFil,
    stepsId: recipe.stepsId,
    tags: recipe.tags,
    source: recipe.source,
    officialId: recipe.officialId,
    customId: recipe.customId,
    thumbnailUrl: recipe.thumbnailUrl,
    image: recipe.image,
    dishType: recipe.dishType,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

export const quickPlanRouter = router({
  suggest: familyWriteProcedure
    .input(
      z.object({
        startDate: z.string().regex(DATE_RE),
        days: z.number().int().min(1).max(2).default(2),
        servings: z.number().int().min(1).max(12).default(4),
        exclusions: z.array(z.string().max(32)).max(20).optional(),
        /** 換一組時傳入上一組菜名，避免抽返相同 */
        excludeNames: z.array(z.string().max(128)).max(20).optional(),
        /** onboarding 新手餐單：固定一組港式三餸一湯（品質可控） */
        starter: z.boolean().optional(),
        /** 0/1/2 — 三組預先審核過嘅新手餐單（換組只會喺呢三組之間） */
        starterVariant: z.number().int().min(0).max(2).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const startedAt = Date.now();
      if (!ctx.activeFamilyId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      }
      if (ctx.activeFamilyRole !== "owner" && ctx.activeFamilyRole !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only family owner or admin can plan meals" });
      }
      const familyId = ctx.activeFamilyId;
      const userId = String(ctx.user.id);
      const ent = await getFamilyEntitlements(familyId, userId);
      if (!ent) throw new TRPCError({ code: "NOT_FOUND", message: "找不到家庭廚房" });
      if (ent.readOnly) throw new TRPCError({ code: "FORBIDDEN", message: "你目前只可檢視此廚房。" });

      try {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      }

      const blocked = (input.exclusions ?? []).map((x) => x.trim().toLowerCase()).filter(Boolean);
      let rows = (await withTimeout(
        execSearchRecipes(db, { query: "", limit: 800 }, ctx.activeFamilyId),
        12000,
        "quickPlan library search",
      )).recipes as Record<string, unknown>[];

      if (blocked.length > 0) {
        rows = rows.filter((row) => {
          const haystack = `${row.name ?? ""} ${row.tags ?? ""} ${row.ingredients ?? ""}`.toLowerCase();
          return !blocked.some((term) => haystack.includes(term));
        });
      }
      rows = rows.filter((row) => hasUsableMainIngredient(Array.isArray(row.ingredients) ? (row.ingredients as any) : []));

      const bannedNames = new Set((input.excludeNames ?? []).map((n) => n.trim().toLowerCase()).filter(Boolean));
      if (bannedNames.size > 0) {
        const filteredOut = rows.filter((row) => !bannedNames.has(String(row.name ?? "").trim().toLowerCase()));
        if (filteredOut.length >= 20) rows = filteredOut;
      }

      const seen = await getFamilySeenNamesSplit(ctx.activeFamilyId);
      const firstDate = input.startDate;
      // onboarding 新手餐單：3 組預先審核過（全部有相、港式、≤25 分鐘）
      if (input.starter) {
        const names = STARTER_SETS[input.starterVariant ?? 0] ?? STARTER_SETS[0];
        const byName = new Map(rows.map((r) => [String(r.name ?? "").trim(), r]));
        const picked = names.map((n) => byName.get(n)).filter(Boolean) as Record<string, unknown>[];
        if (picked.length === names.length) {
          rows = picked;
        } else {
          console.log(`[quickPlan] starter v${input.starterVariant ?? 0} incomplete (${picked.length}/${names.length}) → fallback`);
        }
      }
      // 每個廚房／每日唔同組合（否則所有新用戶見到一模一樣嘅三餸一湯）
      rows = seededShuffle(rows, `${ctx.activeFamilyId}:${firstDate}`);
      const dates = Array.from({ length: input.days }, (_, i) => addDays(firstDate, i));
      const allNames: string[] = [];
      const days: Array<{ date: string; recipes: ReturnType<typeof toPlanRecipe>[] }> = [];

      for (const date of dates) {
        const excludeSets = mkExcludeSets(
          [...seen.seen7d, ...allNames],
          [...seen.seen1d, ...allNames],
        );
        const picked = pickSoupMeal(rows, excludeSets, 3, 1);
        if (picked.length < 4) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `食譜庫不足，無法為 ${date} 安排 3 餸 1 湯`,
          });
        }
        // 結構規則：3 道餸唔可以撞蛋白 + 撞煮法（湯唔計）
        const isSoup = (r: any) => {
          const dt = String(r?.dishType ?? "").toLowerCase();
          return dt === "soup" || /湯|汤|soup/i.test(String(r?.name ?? ""));
        };
        const BANNED_TYPES = new Set(["soup", "dessert", "drink", "carb"]);
        const hasStepsRow = (r: any) => {
          const s = Array.isArray(r?.steps) ? r.steps : [];
          return s.length > 0;
        };
        const takenNames = new Set([
          ...seen.seen7d.map((n) => String(n)),
          ...seen.seen1d.map((n) => String(n)),
          ...allNames,
        ]);
        const dishes = picked.filter((r) => !isSoup(r));
        const soup = picked.find((r) => isSoup(r));
        const poolCandidates = rows.filter(
          (r: any) =>
            !isSoup(r) &&
            !BANNED_TYPES.has(String(r?.dishType ?? "").toLowerCase()) &&
            hasStepsRow(r) &&
            !takenNames.has(String(r?.name ?? "")),
        );
        const diversityEnabled = (process.env.MEAL_DIVERSITY_ENABLED ?? "false") !== "false";
        const div = diversityEnabled
          ? enforceDiversity(dishes as any[], poolCandidates as any[], 2)
          : { dishes: dishes as any[], swapped: 0, collisionsBefore: 0, collisionsAfter: 0, reasons: [] as string[] };
        console.log(
          `[quickPlan] diversity enabled=${diversityEnabled} swapped=${div.swapped} collisions=${div.collisionsBefore}->${div.collisionsAfter}`,
        );
        // 保留原本次序（湯原本位置）→ onboarding 逐道換用 index 對應，次序一變就會換錯角色
        let di = 0;
        const finalPicked = picked.map((r) => (isSoup(r) ? r : (div.dishes[di++] ?? r)));

        allNames.push(...finalPicked.map((r: any) => r.name));
        days.push({
          date,
          recipes: finalPicked.slice(0, 4).map((r: any) => toPlanRecipe(r)),
        });
      }

      console.log(`[quickPlan] suggestMs=${Date.now() - startedAt} family=${familyId} rows=${rows.length} days=${days.length}`);
      return {
        startDate: firstDate,
        requestedServings: input.servings,
        days,
        warnings: [],
      };
      } catch (error) {
        throw error;
      }
    }),
  /** 新手餐單 3 組完整資料（含食材），俾 onboarding 逐道換 */
  starterPool: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const rows = (await execSearchRecipes(db, { query: "", limit: 800 }, ctx.activeFamilyId ?? undefined)).recipes as Record<string, unknown>[];
    const byName = new Map(rows.map((r) => [String(r.name ?? "").trim(), r]));
    return STARTER_SETS.map((names) =>
      names
        .map((n) => byName.get(n))
        .filter(Boolean)
        .map((r) => toPlanRecipe(r as unknown as SuggestedRecipe)),
    );
  }),

  accept: familyWriteProcedure
    .input(
      z.object({
        clientRequestId: z.string().min(1).max(80),
        items: z.array(
          z.object({
            date: z.string().regex(DATE_RE),
            buyDate: z.string().regex(DATE_RE),
            recipeId: z.string().regex(/^(official|user)_\d+$/),
            recipeName: z.string().min(1).max(128),
            recipeNameEn: z.string().max(128).optional().nullable(),
            recipeNameFil: z.string().max(128).optional().nullable(),
            recipeNameId: z.string().max(128).optional().nullable(),
            recipeImage: z.string().optional().nullable(),
            ingredients: z.array(
              z.object({
                name: z.string().min(1).max(128),
                nameEn: z.string().max(128).optional(),
                nameFil: z.string().max(128).optional(),
                nameId: z.string().max(128).optional(),
                quantity: z.string().max(64).optional(),
                unit: z.string().max(32).optional(),
                category: z.string().max(64).optional(),
              }),
            ).max(60),
          }),
        ).min(1).max(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeFamilyId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Not in a family" });
      }
      if (ctx.activeFamilyRole !== "owner" && ctx.activeFamilyRole !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only family owner or admin can plan meals" });
      }
      if (input.items.some((item) => item.buyDate > item.date)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "買餸日期不可遲過用餐日期" });
      }

      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      }

      const familyId = ctx.activeFamilyId;
      const userId = String(ctx.user.id);
      const note = `quickPlan:${input.clientRequestId}`;

      if (input.items.some((item) => !isTodayOrTomorrow(item.date))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "只可以排今日或聽日" });
      }

      const ent = await getFamilyEntitlements(familyId, userId);
      if (!ent) throw new TRPCError({ code: "NOT_FOUND", message: "找不到家庭廚房" });

      const refs = input.items.map((item) => parseRecipeRef(item.recipeId));
      const officialIds = [...new Set(refs.filter((ref) => ref?.kind === "official").map((ref) => ref!.id))];
      const customIds = [...new Set(refs.filter((ref) => ref?.kind === "user").map((ref) => ref!.id))];
      const [officialRows, customRows] = await Promise.all([
        officialIds.length > 0
          ? db
              .select({ id: officialRecipes.id, name: officialRecipes.name })
              .from(officialRecipes)
              .where(and(inArray(officialRecipes.id, officialIds), eq(officialRecipes.isActive, true)))
          : Promise.resolve([] as Array<{ id: number; name: string }>),
        customIds.length > 0
          ? db
              .select({ id: customRecipes.id, name: customRecipes.name, sourceType: customRecipes.sourceType })
              .from(customRecipes)
              .where(and(
                inArray(customRecipes.id, customIds),
                eq(customRecipes.isDraft, false),
                or(
                  eq(customRecipes.familyId, familyId),
                  and(eq(customRecipes.familyId, 0), eq(customRecipes.visibility, "public")),
                ),
              ))
          : Promise.resolve([] as Array<{ id: number; name: string; sourceType: string | null }>),
      ]);
      const visibleNames = new Map<string, string>();
      officialRows.forEach((row) => visibleNames.set(`official_${row.id}`, row.name));
      customRows.forEach((row) => visibleNames.set(`user_${row.id}`, row.name));
      if (input.items.some((item) => !visibleNames.has(item.recipeId))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "所選食譜不存在或不在此廚房" });
      }

      // Same KOL gate as mealPlan.add/addBatch: free families cannot put a KOL
      // recipe into a plan. Skip blocked rows; reject only when nothing is left.
      const sourceTypeById = new Map(customRows.map((row) => [row.id, row.sourceType ?? null]));
      const gateDecisions = input.items.map((item) => {
        const ref = parseRecipeRef(item.recipeId);
        if (!ref) return { ok: true as const, skipped: false as const, reason: null };
        return evaluatePlanItemGate({
          ref: { type: ref.kind, id: ref.id },
          sourceType: ref.kind === "user" ? sourceTypeById.get(ref.id) ?? null : null,
          isPro: ent.isPaid,
        });
      });
      const allowedIndexes = gateDecisions
        .map((decision, index) => (decision.ok ? index : -1))
        .filter((index) => index >= 0);
      const proSkippedItems = input.items.flatMap((item, index) => {
        const decision = gateDecisions[index];
        if (decision.ok) return [];
        return [{
          index,
          date: item.date,
          recipeId: item.recipeId,
          recipeName: item.recipeName,
          ok: false as const,
          skipped: true as const,
          reason: PRO_REQUIRED_REASON,
        }];
      });
      if (allowedIndexes.length === 0) throw proRequiredError();
      const allowedItems = allowedIndexes.map((index) => input.items[index]);

      const starterFree = allowedItems.every((item) =>
        STARTER_NAMES.has(String(visibleNames.get(item.recipeId) ?? "").trim()),
      );
      const credits = ent.isPaid || starterFree ? 0 : 1;
      const idempotencyKey = `accept:${input.clientRequestId}`;

      const result = await db.transaction(async (tx) => {
        const reservation = await reserveUsageInTransaction(tx, {
          familyId,
          userId,
          kind: "ai_plan",
          limits: ent.limits,
          idempotencyKey,
          cost: { credits },
          metadata: { source: "quickPlan.accept", starter: starterFree },
        });

        if (reservation.status !== "reserved") {
          const existingPlans = await tx
            .select({ id: mealPlans.id })
            .from(mealPlans)
            .where(and(eq(mealPlans.familyId, familyId), eq(mealPlans.note, note)));
          return {
            mealPlanCount: existingPlans.length,
            shoppingCount: 0,
            newPlanIds: existingPlans.map((row) => row.id),
            proSkippedItems,
          };
        }

        const dates = [...new Set(allowedItems.map((item) => item.date))];
        const existing = await tx
          .select({ date: mealPlans.date })
          .from(mealPlans)
          .where(and(
            eq(mealPlans.familyId, familyId),
            eq(mealPlans.mealType, "dinner"),
            inArray(mealPlans.date, dates),
          ))
          .limit(1);
        if (existing.length > 0) {
          throw new TRPCError({ code: "CONFLICT", message: "所選日期已有排餐，請先喺 Planner 修改" });
        }

        const inserted = await tx.insert(mealPlans).values(
          allowedItems.map((item) => ({
            familyId,
            date: item.date,
            mealType: "dinner" as const,
            recipeId: item.recipeId,
            recipeName: item.recipeName,
            recipeNameEn: item.recipeNameEn ?? null,
            recipeNameFil: item.recipeNameFil ?? null,
            recipeNameId: item.recipeNameId ?? null,
            recipeImage: item.recipeImage ?? null,
            status: "confirmed" as const,
            proposedByUserId: userId,
            proposedByName: ctx.user.name || "",
            note,
          })),
        ).returning({ id: mealPlans.id });

        const purchased = new Map<string, {
          familyId: number;
          name: string;
          nameEn?: string | null;
          nameFil?: string | null;
          nameId?: string | null;
          category?: string | null;
          quantity?: string | null;
          unit?: string | null;
          status: "active";
          proposedByUserId: string;
          proposedByName: string;
          fromRecipeId: string;
          fromRecipeName: string;
          fromMealPlanId: number;
          plannedDate: string;
        }>();

        allowedItems.forEach((item, index) => {
          const planId = inserted[index]?.id;
          if (!planId) return;
          for (const ing of normalizeRecipeIngredients(item.ingredients)) {
            if (!isUsableIngredientName(ing.name)) continue;
            const category = ing.category || categorizeIngredientName(ing.name);
            if (category === "調味料") continue;
            if (/^(?:清水|水|滾水|熱水|凍水|開水|冰水|涼水)$/.test(ing.name.trim())) continue;
            const key = `${item.buyDate}|${ing.name}|${ing.unit}`;
            const current = purchased.get(key);
            if (current) {
              const a = parseFloat(current.quantity ?? "");
              const b = parseFloat(ing.quantity ?? "");
              if (!Number.isNaN(a) && !Number.isNaN(b)) {
                current.quantity = String(parseFloat((a + b).toFixed(2)));
              }
              continue;
            }
            purchased.set(key, {
              familyId: ctx.activeFamilyId!,
              name: ing.name.slice(0, 128),
              nameEn: (ing as any).nameEn ?? null,
              nameFil: (ing as any).nameFil ?? null,
              nameId: (ing as any).nameId ?? null,
              category: category.slice(0, 64),
              quantity: (ing.quantity ?? "").slice(0, 64),
              unit: (ing.unit ?? "").slice(0, 32),
              status: "active",
              proposedByUserId: String(ctx.user.id),
              proposedByName: ctx.user.name || "",
              fromRecipeId: item.recipeId,
              fromRecipeName: item.recipeName,
              fromMealPlanId: planId,
              plannedDate: item.buyDate,
            });
          }
        });

        const rows = [...purchased.values()];
        if (rows.length > 0) {
          await tx.insert(shoppingItems).values(rows);
        }
        await commitUsageInTransaction(tx, reservation.eventId);
        return {
          mealPlanCount: inserted.length,
          shoppingCount: rows.length,
          newPlanIds: inserted.map((row) => row.id),
          proSkippedItems,
        };
      }).catch((error) => usageLimitToTRPC(error));

      await recordFamilySeenNames(familyId, [...new Set(allowedItems.map((item) => item.recipeName))]);
      return result;
    }),

});
