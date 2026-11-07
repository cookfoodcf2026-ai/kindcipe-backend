/**
 * Audit / repair custom_recipes.steps.
 *
 * Dry-run by default:
 *   npx tsx scripts/repair-corrupted-custom-steps.ts
 *
 * Apply explicit repairs only (no user credit is used):
 *   npx tsx scripts/repair-corrupted-custom-steps.ts --apply --regenerate=346,313
 *   npx tsx scripts/repair-corrupted-custom-steps.ts --apply --mark-incomplete=346,313
 *
 * Regenerate uses the existing name + ingredients and must pass the same hard
 * structural gate as generated cards. If it fails, the row is marked incomplete.
 */
import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../server/db";
import { customRecipes } from "../drizzle/schema";
import { invokeLLM, extractJSON } from "../server/_core/llm";
import { hasJsonFragmentStepText, validateGeneratedRecipeSteps } from "../server/services/recipeStepQuality";
import { enqueueRecipeTranslation } from "../server/services/translationQueue";

const APPLY = process.argv.includes("--apply");
const REGENERATE_IDS = parseIds(process.argv.find((arg) => arg.startsWith("--regenerate=")));
const MARK_INCOMPLETE_IDS = parseIds(process.argv.find((arg) => arg.startsWith("--mark-incomplete=")));

type StepStatus = "json_fragment" | "zero_steps" | "short_steps" | "ok";

type Row = {
  id: number;
  familyId: number;
  name: string;
  description: string | null;
  ingredients: string | null;
  steps: string | null;
  stepsEn: string | null;
  stepsFil: string | null;
  stepsId: string | null;
  isDraft: boolean;
  isAiGenerated: boolean;
  sourceType: string | null;
};

type Audit = {
  row: Row;
  status: StepStatus;
  stepCount: number;
  reason: string;
};

function parseIds(arg: string | undefined): Set<number> {
  if (!arg) return new Set();
  return new Set(arg.split("=")[1]?.split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0) ?? []);
}

function parseSteps(raw: string | null): unknown {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function auditRow(row: Row): Audit {
  const parsed = parseSteps(row.steps);
  const values = Array.isArray(parsed) ? parsed : [];
  const malformed = values.some((step) => {
    if (typeof step === "string") return false;
    // Legacy rows store { instruction, duration }; that shape is valid.
    return !(step && typeof step === "object" && typeof (step as any).instruction === "string");
  });
  const stepTexts = values
    .map((step) => typeof step === "string" ? step : String((step as any)?.instruction ?? ""))
    .map((step) => step.trim())
    .filter(Boolean);
  const hasFragment = malformed || stepTexts.some((step) => hasJsonFragmentStepText(step));
  if (hasFragment) return { row, status: "json_fragment", stepCount: stepTexts.length, reason: "steps 含 JSON 碎片／非文字" };
  if (stepTexts.length === 0) return { row, status: "zero_steps", stepCount: 0, reason: "steps 係空陣列" };
  if (stepTexts.length < 3) return { row, status: "short_steps", stepCount: stepTexts.length, reason: `只有 ${stepTexts.length} 步` };
  return { row, status: "ok", stepCount: stepTexts.length, reason: "" };
}

function parseIngredients(raw: string | null): { name: string; quantity?: string; unit?: string }[] {
  try {
    const parsed = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function regenerateSteps(row: Row): Promise<string[] | null> {
  const ingredients = parseIngredients(row.ingredients);
  const ingredientText = ingredients.map((ing) => `${ing.name}${ing.quantity ? ` ${ing.quantity}` : ""}${ing.unit ? ` ${ing.unit}` : ""}`).join("、");
  const basePrompt = `你係食譜步驟修復器。請根據以下資料，只重寫中文做法，唔准加入新材料，唔准改材料清單。
菜名：${row.name}
簡介：${row.description ?? ""}
材料：${ingredientText}
只回傳 JSON：{"steps":["..."]}
規則：4–8 步；每步 15–80 個中文字；步驟只可以提及上面材料；唔准出現「適量」「煮至熟」「調味即可」整步空話；步驟文字唔准包含 : { } " 或 stepsEn/stepsFil/stepsId/instruction 等 JSON key。`;
  const promptFor = (issues?: string[]) => issues?.length
    ? `${basePrompt}\n上一次輸出唔合格：${issues.slice(0, 8).join("；")}。請完全重新生成。`
    : basePrompt;

  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await invokeLLM({
      messages: [{ role: "user", content: promptFor(attempt === 0 ? undefined : ["結構驗證失敗"]) }],
      maxTokens: 1800,
      temperature: 0.4,
      timeoutMs: 45_000,
      maxRetries: 1,
      responseFormat: { type: "json_object" },
    });
    const raw = resp.choices?.[0]?.message?.content || "";
    const parsed = extractJSON<any>(raw);
    const steps = Array.isArray(parsed?.steps)
      ? parsed.steps.filter((step: unknown): step is string => typeof step === "string" && step.trim().length > 0).map((step: string) => step.trim())
      : [];
    const check = validateGeneratedRecipeSteps({ ingredients, steps });
    if (check.ok) return steps;
    console.warn(`[repair-steps] id=${row.id} attempt=${attempt + 1} rejected: ${check.issues.join("；")}`);
  }
  return null;
}

async function markIncomplete(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, row: Row, reason: string): Promise<void> {
  if (!APPLY) {
    console.log(`[repair-steps] DRY-RUN mark id=${row.id} incomplete: ${reason}`);
    return;
  }
  await db.update(customRecipes)
    .set({ stepsIncomplete: true, stepsIncompleteReason: reason, updatedAt: new Date() })
    .where(eq(customRecipes.id, row.id));
  console.log(`[repair-steps] marked id=${row.id} incomplete: ${reason}`);
}

async function regenerate(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, row: Row): Promise<void> {
  const steps = await regenerateSteps(row);
  if (!steps) {
    await markIncomplete(db, row, "自動重生後仍未能通過步驟驗證");
    return;
  }
  if (!APPLY) {
    console.log(`[repair-steps] DRY-RUN regenerate id=${row.id} → ${steps.length} steps`);
    return;
  }
  await db.update(customRecipes)
    .set({
      steps: JSON.stringify(steps),
      stepsEn: null,
      stepsFil: null,
      stepsId: null,
      stepsIncomplete: false,
      stepsIncompleteReason: null,
      updatedAt: new Date(),
    })
    .where(eq(customRecipes.id, row.id));
  enqueueRecipeTranslation(row.id, row.familyId);
  console.log(`[repair-steps] regenerated id=${row.id} → ${steps.length} steps`);
}

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("[repair-steps] no database");
    process.exit(1);
  }

  const rows = (await db.select({
    id: customRecipes.id,
    familyId: customRecipes.familyId,
    name: customRecipes.name,
    description: customRecipes.description,
    ingredients: customRecipes.ingredients,
    steps: customRecipes.steps,
    stepsEn: customRecipes.stepsEn,
    stepsFil: customRecipes.stepsFil,
    stepsId: customRecipes.stepsId,
    isDraft: customRecipes.isDraft,
    isAiGenerated: customRecipes.isAiGenerated,
    sourceType: customRecipes.sourceType,
  }).from(customRecipes)) as Row[];

  const audits = rows.map(auditRow);
  const counts = {
    total: audits.length,
    json_fragment: audits.filter((a) => a.status === "json_fragment").length,
    zero_steps: audits.filter((a) => a.status === "zero_steps").length,
    short_steps: audits.filter((a) => a.status === "short_steps").length,
    less_than_3: audits.filter((a) => a.stepCount < 3).length,
  };
  console.log(`[repair-steps] total=${counts.total} json_fragment=${counts.json_fragment} zero_steps=${counts.zero_steps} short_steps=${counts.short_steps} less_than_3=${counts.less_than_3}`);

  const bad = audits.filter((a) => a.status !== "ok");
  for (const item of bad) {
    console.log(`  · id=${item.row.id} status=${item.status} steps=${item.stepCount} ai=${item.row.isAiGenerated} draft=${item.row.isDraft} source=${item.row.sourceType ?? "?"} name=${item.row.name} reason=${item.reason}`);
  }

  const explicitRegenerate = bad.filter((item) => REGENERATE_IDS.has(item.row.id));
  const explicitMark = bad.filter((item) => MARK_INCOMPLETE_IDS.has(item.row.id));
  for (const item of explicitRegenerate) await regenerate(db, item.row);
  for (const item of explicitMark) await markIncomplete(db, item.row, item.reason);

  if (!APPLY) {
    console.log("[repair-steps] dry-run only。先人手覆核上面清單，再用 --apply --regenerate=... 或 --apply --mark-incomplete=...");
  } else if (explicitRegenerate.length === 0 && explicitMark.length === 0) {
    console.log("[repair-steps] --apply 需要明確 --regenerate=... 或 --mark-incomplete=...，唔會批量改資料。");
  }
  process.exit(0);
}

main().catch((error) => {
  console.error("[repair-steps] failed:", error);
  process.exit(1);
});
