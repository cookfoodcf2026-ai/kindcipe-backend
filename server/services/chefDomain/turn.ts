import { planChefTurn, parseMealShape } from "../chefPlanner";
import { detectSafetyIntent, safetyQuestion } from "../chefSafety";
import { buildDomainQueryPlan } from "./queryPlan";
import { clearAsk, cloneState, withAsk, withMeal, withMiss } from "./state";
import { emptyTurnState } from "./types";
import type { DomainDishType, DomainRole, QueryPlan, RecipeCard, TurnCommand, TurnResult, TurnState } from "./types";
import type { RecipeRepository } from "./repository";

const TECHNIQUE_RE = /幾耐|點樣|如何|怎樣|秘訣|技巧|點解|溫度|幾多度|要幾耐|幾多分鐘|how\s*(long|to|many)|temperature/i;
const NON_FOOD_RE = /訂機票|订机票|機票|机票|flight|酒店|電郵|邮件|email|機械人|机器人|卡路里|營養|营养|medical|medicine/i;
const CLOSEST_RE = /最接近|有冇最接近|closest|nearest/i;

function typeForRole(role: DomainRole): DomainDishType | null {
  if (role === "any") return null;
  if (role === "noodle") return "carb";
  return role as DomainDishType;
}

function rolesForShape(shape: { dishes: number; soups: number }): DomainRole[] {
  const roles: DomainRole[] = [];
  if (shape.dishes >= 3) roles.push("meat", "seafood", "vegetable");
  else if (shape.dishes === 2) roles.push("meat", "any");
  else if (shape.dishes === 1) roles.push("any");
  while (roles.length < shape.dishes) roles.push("any");
  for (let i = 0; i < shape.soups; i++) roles.push("soup");
  return roles.slice(0, shape.dishes + shape.soups);
}

function pickForRoles(repo: RecipeRepository, roles: DomainRole[], plan: QueryPlan, familyId: number): RecipeCard[] {
  const picked: RecipeCard[] = [];
  const used = new Set<string>();
  for (const role of roles) {
    const type = typeForRole(role);
    const pool = repo.search({
      ...plan,
      dishTypes: type ? [type] : plan.dishTypes,
      text: plan.text,
    }, familyId);
    const card = pool.find((candidate) => !used.has(candidate.name));
    if (!card) return [];
    used.add(card.name);
    picked.push(card);
  }
  return picked;
}

function result(
  status: TurnResult["status"],
  text: string,
  recipes: RecipeCard[],
  command: TurnCommand,
  state: TurnState,
  clarifyReason: TurnResult["clarifyReason"] = null,
): TurnResult {
  return {
    status,
    recipes,
    // Domain M1 never calls AI. Credits are derived from AI cards only.
    ai: recipes.filter((recipe) => recipe.visibility === "private").length * 0,
    credits: 0,
    clarifyReason,
    text,
    command,
    state,
  };
}

export function runChefTurn(
  previous: TurnState | undefined,
  rawText: string,
  repo: RecipeRepository,
  familyId: number,
): TurnResult {
  const state = previous ? cloneState(previous) : emptyTurnState();
  const text = String(rawText ?? "").trim();

  const safety = detectSafetyIntent(text);
  if (safety) {
    const next = withAsk(state, `safety:${safety.kind}`);
    return result("ask", safetyQuestion("zh-TW", safety), [], { kind: "ask", question: "safety" }, next, "safety");
  }

  if (NON_FOOD_RE.test(text)) {
    return result("text", "我係煮食助手，只可以幫你搵食譜同煮食；其他嘢幫唔到。", [], { kind: "non_food" }, clearAsk(state), "non_food");
  }

  if (TECHNIQUE_RE.test(text)) {
    return result("text", "呢個係煮食技巧問題；我會用文字答，唔出卡。", [], { kind: "technique" }, clearAsk(state), null);
  }

  if (CLOSEST_RE.test(text) && state.lastMiss) {
    const cards = repo.byNames(state.lastMiss.alternatives.slice(0, 3), familyId);
    if (cards.length > 0) {
      return result("cards", `庫存冇「${state.lastMiss.label}」，以下係最接近嘅食譜。`, cards, {
        kind: "closest",
        target: state.lastMiss.label,
      }, withMeal(state, state.shape, cards.map((card) => card.name)), null);
    }
    return result("ask", `庫存冇「${state.lastMiss.label}」，暫時亦冇夠接近嘅食譜。`, [], {
      kind: "ask",
      question: "closest_empty",
    }, withAsk(state, "closest_empty"), "library_miss");
  }

  const planned = planChefTurn(text, {
    previousMeal: state.shape.dishes + state.shape.soups > 0 ? state.shape : undefined,
  });
  const queryPlan = buildDomainQueryPlan(text);

  if (planned && planned.kind === "meal") {
    const roles = planned.requested.roles as DomainRole[];
    const cards = pickForRoles(repo, roles, queryPlan, familyId);
    if (cards.length === planned.requested.total) {
      return result("cards", `我幫你揀咗 ${cards.length} 張食譜。`, cards, {
        kind: "meal",
        shape: planned.shape,
        roles,
        modifiers: planned.modifiers,
      }, withMeal(state, planned.shape, cards.map((card) => card.name)), null);
    }
    const firstLabel = queryPlan.text || text;
    const alternatives = repo.search({ ...queryPlan, text: "", dishTypes: [] }, familyId)
      .slice(0, 3).map((card) => card.name);
    const next = withMiss(state, { label: firstLabel, kind: "meal", alternatives });
    return result("ask", `庫存未夠「${firstLabel}」嘅食譜；最接近：${alternatives.join("、") || "暫時冇"}。`, [], {
      kind: "ask",
      question: "library_miss",
    }, withAsk(next, "library_miss"), "library_miss");
  }

  if (state.pendingAsk && state.pendingAsk.askedCount >= state.pendingAsk.maxAskCount) {
    const fallback = repo.search(buildDomainQueryPlan("家常"), familyId).slice(0, 3);
    if (fallback.length > 0) {
      return result("cards", "我先幫你揀 3 張預設；唔啱話我知，再幫你換。", fallback, {
        kind: "meal",
        shape: { dishes: fallback.length, soups: 0 },
      }, withMeal(state, { dishes: fallback.length, soups: 0 }, fallback.map((card) => card.name)), null);
    }
  }

  const seen = new Set(state.cardNames);
  const candidates = repo.search(queryPlan, familyId)
    .filter((card) => !seen.has(card.name) && !state.avoid.some((term) => card.ingredients.some((ingredient) => ingredient.includes(term))));
  if (candidates.length > 0 && (queryPlan.dishTypes.length > 0 || queryPlan.scenarios.length > 0)) {
    const cards = candidates.slice(0, 3);
    return result("cards", "我幫你搵到以下食譜。", cards, {
      kind: "recipe",
      shape: { dishes: cards.length, soups: 0 },
    }, withMeal(state, { dishes: cards.length, soups: 0 }, cards.map((card) => card.name), {
      avoid: queryPlan.avoid,
      scenarios: queryPlan.scenarios,
    }), null);
  }

  const next = withAsk(state, "clarify");
  return result("ask", "你想食咩類型？例如湯、粉麵、小炒，或者有咩食材？", [], {
    kind: "ask",
    question: "clarify",
  }, next, "ambiguous_food");
}
