import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import { PLAN_LIMITS, limitsForStatus } from "../../services/entitlementPolicy";
import { LIMIT_REACHED_ERROR_CODE } from "../../services/limitPolicy";
import {
  assertCustomRecipeLimit,
  assertImportLimit,
  type LimitGateDeps,
} from "../../services/limitEnforcement";
import { quotaLedgerKey, type QuotaScope } from "../../services/recipeQuota";
import { getYearMonthKey } from "../../services/monthKey";
import {
  PRO_REQUIRED_REASON,
  evaluatePlanItemGate,
} from "../../lib/mealPlanProGate";

const FREE = limitsForStatus("free");
const PRO = limitsForStatus("active");

function isLimitReached(feature: string, limit: number, used: number) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof TRPCError);
    assert.equal(error.code, "FORBIDDEN");
    const cause = error.cause as
      | { code?: string; feature?: string; limit?: number; used?: number }
      | undefined;
    assert.equal(cause?.code, LIMIT_REACHED_ERROR_CODE);
    assert.equal(cause?.feature, feature);
    assert.equal(cause?.limit, limit);
    assert.equal(cause?.used, used);
    assert.match(error.message, /^LIMIT_REACHED:/);
    return true;
  };
}

/**
 * In-memory mirror of the production ledger. It uses the same pure
 * `quotaLedgerKey` (free → user+month, paid → family+month) and the same gates,
 * so scope/refund bugs fail here without touching a database.
 */
function makeLedger(startMonth = "2026-11") {
  const counts = new Map<string, number>();
  let currentMonth = startMonth;
  const key = (feature: "custom" | "import", scope: QuotaScope, yearMonth: string) =>
    `${feature}:${quotaLedgerKey(scope, yearMonth)}`;

  const deps: LimitGateDeps = {
    yearMonth: () => currentMonth,
    countCustomRecipes: async (scope, yearMonth) =>
      counts.get(key("custom", scope, yearMonth)) ?? 0,
    countImports: async (scope, yearMonth) =>
      counts.get(key("import", scope, yearMonth)) ?? 0,
  };

  const add = (feature: "custom" | "import", scope: QuotaScope) => {
    const k = key(feature, scope, currentMonth);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  };

  return {
    deps,
    setMonth(yearMonth: string) {
      currentMonth = yearMonth;
    },
    async createCustom(scope: QuotaScope, limits = FREE) {
      await assertCustomRecipeLimit(scope, limits, deps);
      add("custom", scope);
    },
    async importRecipe(scope: QuotaScope, limits = FREE) {
      await assertImportLimit(scope, limits, deps);
      await assertCustomRecipeLimit(scope, limits, deps);
      add("import", scope);
      add("custom", scope);
    },
    deleteRecipe() {
      // A delete never decrements the monthly ledger.
    },
  };
}

test("free user: 5 creates ok, 6th rejected; delete + recreate still rejected", async () => {
  const ledger = makeLedger();
  const scope: QuotaScope = { familyId: 1, userId: "free-user", plan: "free" };

  for (let i = 0; i < 5; i++) await ledger.createCustom(scope);
  await assert.rejects(
    () => ledger.createCustom(scope),
    isLimitReached("custom_recipes", 5, 5),
  );

  ledger.deleteRecipe();
  await assert.rejects(
    () => ledger.createCustom(scope),
    isLimitReached("custom_recipes", 5, 5),
  );
});

test("free user: 5 creates in kitchen A, switching to kitchen B does not reset", async () => {
  const ledger = makeLedger();
  const kitchenA: QuotaScope = { familyId: 10, userId: "switcher", plan: "free" };
  const kitchenB: QuotaScope = { familyId: 20, userId: "switcher", plan: "free" };

  for (let i = 0; i < 5; i++) await ledger.createCustom(kitchenA);
  await assert.rejects(
    () => ledger.createCustom(kitchenB),
    isLimitReached("custom_recipes", 5, 5),
  );
  assert.equal(quotaLedgerKey(kitchenA, "2026-11"), quotaLedgerKey(kitchenB, "2026-11"));
});

test("pro family: 50 creates ok even after deletes (shared family pool, no cap)", async () => {
  const ledger = makeLedger();
  const scope: QuotaScope = { familyId: 30, userId: "owner", plan: "pro" };

  for (let i = 0; i < 50; i++) await ledger.createCustom(scope, PRO);
  for (let i = 0; i < 25; i++) ledger.deleteRecipe();
  await assert.doesNotReject(() => ledger.createCustom(scope, PRO));
  await assert.doesNotReject(() =>
    ledger.createCustom({ ...scope, userId: "member" }, PRO),
  );
});

test("free user: 5 imports ok, 6th rejected; deleting the imported recipe never refunds", async () => {
  const ledger = makeLedger();
  const scope: QuotaScope = { familyId: 40, userId: "importer", plan: "free" };

  for (let i = 0; i < 5; i++) await ledger.importRecipe(scope);
  await assert.rejects(
    () => ledger.importRecipe(scope),
    isLimitReached("imports", 5, 5),
  );

  ledger.deleteRecipe();
  await assert.rejects(
    () => ledger.importRecipe(scope),
    isLimitReached("imports", 5, 5),
  );
});

test("cross-month: counter is keyed by getYearMonthKey and resets next month", async () => {
  const november = getYearMonthKey(new Date("2026-11-30T23:59:59.000Z"));
  const december = getYearMonthKey(new Date("2026-12-01T00:00:00.000Z"));
  assert.equal(november, "2026-11");
  assert.equal(december, "2026-12");

  const ledger = makeLedger(november);
  const scope: QuotaScope = { familyId: 50, userId: "monthly", plan: "free" };
  for (let i = 0; i < 5; i++) await ledger.createCustom(scope);
  await assert.rejects(
    () => ledger.createCustom(scope),
    isLimitReached("custom_recipes", 5, 5),
  );

  ledger.setMonth(december);
  await assert.doesNotReject(() => ledger.createCustom(scope));
});

test("quickPlan.accept: free family + KOL recipe → skipped pro_required (pro allowed)", () => {
  const free = evaluatePlanItemGate({
    ref: { type: "user", id: 701 },
    sourceType: "kol",
    isPro: false,
  });
  assert.deepEqual(free, { ok: false, skipped: true, reason: PRO_REQUIRED_REASON });

  const pro = evaluatePlanItemGate({
    ref: { type: "user", id: 701 },
    sourceType: "kol",
    isPro: true,
  });
  assert.deepEqual(pro, { ok: true, skipped: false, reason: null });

  const source = readFileSync(
    new URL("../../routers/quickPlan.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /evaluatePlanItemGate/);
  assert.match(source, /proSkippedItems/);
  assert.match(source, /proRequiredError/);
});

test("native saveKolRecipe: Pro gate applies and KOL provenance is preserved", () => {
  const source = readFileSync(
    new URL("../../routers/recipes.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("  saveKolRecipe: protectedProcedure");
  assert.notEqual(start, -1, "saveKolRecipe route must exist");
  const end = source.indexOf("  // ── KOL whitelist", start);
  assert.notEqual(end, -1, "saveKolRecipe block end must be found");
  const block = source.slice(start, end);

  assert.match(block, /assertProFeature\(/);
  assert.doesNotMatch(block, /clientPlatform/);
  assert.match(block, /sourceType:\s*"kol"/);
  assert.doesNotMatch(block, /sourceType:\s*"manual"/);
});

test("all monthly ledgers use the shared getYearMonthKey helper", () => {
  const dbSource = readFileSync(new URL("../../db.ts", import.meta.url), "utf8");
  assert.doesNotMatch(dbSource, /function getYearMonthKey/);
  assert.match(dbSource, /from "\.\/services\/monthKey"/);

  const usageSource = readFileSync(
    new URL("../../services/usage.ts", import.meta.url),
    "utf8",
  );
  assert.match(usageSource, /export \{ getYearMonthKey \} from "\.\/monthKey"/);

  const llmCostSource = readFileSync(
    new URL("../../services/llmCost.ts", import.meta.url),
    "utf8",
  );
  assert.match(llmCostSource, /export \{ getYearMonthKey \} from "\.\/monthKey"/);
});

test("limits come from PLAN_LIMITS, not hardcoded numbers in routers/services", () => {
  assert.deepEqual(PLAN_LIMITS.free, { aiCredits: 15, imports: 5, customRecipes: 5, members: 2 });
  assert.deepEqual(PLAN_LIMITS.trial, { aiCredits: 50, imports: 20, customRecipes: null, members: 4 });
  assert.deepEqual(PLAN_LIMITS.pro, { aiCredits: 150, imports: 100, customRecipes: null, members: 4 });

  const root = fileURLToPath(new URL("../..", import.meta.url));
  const dirs = ["services", "routers"].map((dir) => path.join(root, dir));
  const files = dirs.flatMap((dir) =>
    readdirSync(dir)
      .map((name) => path.join(dir, name))
      .filter((file) => statSync(file).isFile() && file.endsWith(".ts"))
  );
  const hardcoded: string[] = [];
  for (const file of files) {
    if (file.endsWith(".test.ts") || file.endsWith("entitlementPolicy.ts")) continue;
    const text = readFileSync(file, "utf8");
    const matches = text.match(/\b(imports|customRecipes|aiCredits)\s*:\s*(5|20|100|150)\b/g);
    if (matches) hardcoded.push(`${path.relative(root, file)}: ${matches.join(", ")}`);
  }
  assert.deepEqual(hardcoded, []);
});
