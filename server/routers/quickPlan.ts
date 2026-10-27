import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { familyWriteProcedure, router } from "../_core/trpc";
import { mealPlans, shoppingItems } from "../../drizzle/schema";
import { getDb } from "../db";
import { getFamilyEntitlements } from "../services/entitlements";
import { commitUsage, refundUsage, reserveUsage, usageLimitToTRPC } from "../services/usage";
import { categorizeIngredientName, hasUsableMainIngredient, isUsableIngredientName, normalizeRecipeIngredients } from "../utils/ingredientNormalize";
import {
  execSearchRecipes,
  getFamilySeenNamesSplit,
  mkExcludeSets,
  pickSoupMeal,
  recordFamilySeenNames,
  type SuggestedRecipe,
} from "./aiRecipe";

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

      let reservationId: number | undefined;
      const planCost = ent.isPaid ? 0 : 1;
      if (planCost > 0) {
        try {
          const reservation = await reserveUsage({
            familyId,
            userId,
            kind: "ai_plan",
            limits: ent.limits,
            idempotencyKey: `ai_plan:${familyId}:${userId}:${randomUUID()}`,
            cost: { credits: planCost },
          });
          reservationId = reservation.eventId;
        } catch (error) {
          usageLimitToTRPC(error);
        }
      }

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

      const seen = await getFamilySeenNamesSplit(ctx.activeFamilyId);
      const firstDate = input.startDate;
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
        allNames.push(...picked.map((r) => r.name));
        days.push({
          date,
          recipes: picked.slice(0, 4).map((r) => toPlanRecipe(r)),
        });
      }

      console.log(`[quickPlan] suggestMs=${Date.now() - startedAt} family=${familyId} rows=${rows.length} days=${days.length}`);
      if (reservationId) await commitUsage(reservationId);
      return {
        startDate: firstDate,
        requestedServings: input.servings,
        days,
        warnings: [],
      };
      } catch (error) {
        if (reservationId) await refundUsage(reservationId).catch(() => {});
        usageLimitToTRPC(error);
      }
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

      const dates = [...new Set(input.items.map((item) => item.date))];
      const existing = await db
        .select({ date: mealPlans.date })
        .from(mealPlans)
        .where(and(
          eq(mealPlans.familyId, ctx.activeFamilyId),
          eq(mealPlans.mealType, "dinner"),
          inArray(mealPlans.date, dates),
        ))
        .limit(1);
      if (existing.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "所選日期已有排餐，請先喺 Planner 修改" });
      }

      const result = await db.transaction(async (tx) => {
        const inserted = await tx.insert(mealPlans).values(
          input.items.map((item) => ({
            familyId: ctx.activeFamilyId!,
            date: item.date,
            mealType: "dinner" as const,
            recipeId: item.recipeId,
            recipeName: item.recipeName,
            recipeNameEn: item.recipeNameEn ?? null,
            recipeNameFil: item.recipeNameFil ?? null,
            recipeNameId: item.recipeNameId ?? null,
            recipeImage: item.recipeImage ?? null,
            status: "confirmed" as const,
            proposedByUserId: String(ctx.user.id),
            proposedByName: ctx.user.name || "",
            note: `quickPlan:${input.clientRequestId}`,
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

        input.items.forEach((item, index) => {
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
        return { mealPlanCount: inserted.length, shoppingCount: rows.length, newPlanIds: inserted.map((row) => row.id) };
      });

      await recordFamilySeenNames(ctx.activeFamilyId, [...new Set(input.items.map((item) => item.recipeName))]);
      return result;
    }),

});
