import { planChefTurn, parseMealShape } from "../chefPlanner";
import { detectSafetyIntent, safetyQuestion } from "../chefSafety";
import { buildDomainQueryPlan } from "./queryPlan";
import { clearAsk, cloneState, withAsk, withMeal, withMiss } from "./state";
import { emptyTurnState } from "./types";
import type { DomainDishType, DomainRole, QueryPlan, RecipeCard, TurnCommand, TurnResult, TurnState } from "./types";
import type { RecipeRepository } from "./repository";

const TECHNIQUE_RE = /幾耐|點樣|如何|怎樣|秘訣|技巧|點解|溫度|幾多度|要幾耐|幾多分鐘|蒸定|蒸籠|用鑊蒸|用鍋蒸|氣炸鍋|氣炸|air\s*fryer|how\s*(long|to|many)|temperature/i;
const NON_FOOD_RE = /訂機票|订机票|機票|机票|flight|酒店|電郵|邮件|email|機械人|机器人|卡路里|營養|营养|medical|medicine/i;
const POLITE_RE = /^(?:多謝|谢谢|唔該|thank\s*you|thanks|thx)[\s!！。.]*$/i;
const CONTEXT_RE = /^(?:唔要|不要|唔好|走|清淡|健康|辣|辣啲|小辣|少辣|我要七成熟|我要五成熟|我要全熟|七成熟|五成熟|全熟|配菜|快|快啲|再|多)/i;
const PANTRY_RE = /雪櫃|冰箱|pantry|剩|得/i;
const CLOSEST_RE = /最接近|有冇最接近|有邊幾款|有咩選擇|closest|nearest/i;

function normalize(value: string): string {
  return String(value ?? "").replace(/[\s，,。！？!?]/g, "").toLowerCase();
}

function typeForRole(role: DomainRole): DomainDishType | null {
  if (role === "any") return null;
  if (role === "noodle") return "carb";
  return role as DomainDishType;
}

function targetFacets(text: string): string[] {
  const facets: string[] = [];
  if (/牛|和牛|beef|steak/i.test(text)) facets.push("beef");
  if (!facets.includes("beef") && /雞|鸡|chicken/i.test(text)) facets.push("chicken");
  if (/魚|鱼|蝦|虾|蟹|海鮮|海鲜|扇貝|扇贝|帶子|带子|青口|花甲|蜆|蚬|蠔|蚝|蟶子|蛏子|seafood|fish|shrimp/i.test(text)) facets.push("seafood");
  if (/沙律|沙拉|salad/i.test(text)) facets.push("salad");
  if (/菜|蔬菜|veg/i.test(text)) facets.push("vegetable");
  return [...new Set(facets)];
}

function targetTerms(text: string): string[] {
  const terms: string[] = [];
  if (/魚|鱼|fish/i.test(text)) terms.push("魚");
  if (/蝦|虾|shrimp/i.test(text)) terms.push("蝦");
  if (/扇貝|扇贝/i.test(text)) terms.push("扇貝");
  else if (/帶子|带子/i.test(text)) terms.push("帶子");
  else if (/青口/i.test(text)) terms.push("青口");
  else if (/花甲/i.test(text)) terms.push("花甲");
  else if (/蜆|蚬/i.test(text)) terms.push("蜆");
  else if (/蟶子|蛏子/i.test(text)) terms.push("蟶子");
  else if (/蠔|蚝/i.test(text)) terms.push("蠔");
  if (/牛|beef|steak/i.test(text)) terms.push("牛");
  if (/雞|鸡|chicken/i.test(text)) terms.push("雞");
  if (/沙律|沙拉|salad/i.test(text)) terms.push("沙律");
  return [...new Set(terms)];
}

function cardHasTerm(card: RecipeCard, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const hay = `${card.name} ${card.ingredients.join(" ")}`;
  return terms.some((term) => hay.includes(term));
}

function nameMatchesFacet(name: string, facet: string): boolean {
  if (facet === "seafood") return /魚|鱼|蝦|虾|蟹|海鮮|海鲜|蠔|蚝|魷魚|鱿鱼|海參|海参|三文魚|鱸魚|紅衫魚|鯪魚|鰻魚|扇貝|扇贝|帶子|带子|青口|花甲|蜆|蚬|蟶子|蛏子/i.test(name) && !/魚香|鱼香/.test(name);
  if (facet === "beef") return /牛|beef/i.test(name) && !/牛奶|牛油|牛角|牛蒡/.test(name);
  if (facet === "chicken") return /雞|鸡|chicken/i.test(name) && !/雞蛋|鸡蛋/.test(name);
  if (facet === "salad") return /沙律|沙拉|salad/i.test(name);
  if (facet === "vegetable") return /菜|蔬|瓜|菇|菌|豆|茄|椒|薯|蘿蔔|萝卜|洋蔥|洋葱|南瓜/i.test(name);
  return true;
}

function avoidMatches(card: RecipeCard, terms: string[]): boolean {
  if (terms.length === 0) return false;
  const hay = `${card.name} ${card.ingredients.join(" ")}`;
  return terms.some((term) => {
    const value = term.trim();
    if (!value) return false;
    if (hay.includes(value)) return true;
    if (value.length < 2) return false;
    return [...value].every((char) => hay.includes(char));
  });
}

function tolerantNameTarget(text: string): string {
  let value = String(text ?? "").trim()
    .replace(/^(?:我想食|我想|想食|我要食|我要|要食|要|請|帮|幫我|幫我搵|搵|找)\s*/u, "")
    .replace(/[呀啦嘅啊呢囉喎呀嘛嗎？?！!。.，,\s]+$/u, "")
    .trim();
  if (!value || value.length < 2 || /[或者或同和及]|\band\b/i.test(value)) return "";
  return value;
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

function pickForRoles(repo: RecipeRepository, roles: DomainRole[], plan: QueryPlan, familyId: number, avoid: string[] = []): RecipeCard[] {
  const picked: RecipeCard[] = [];
  const used = new Set<string>();
  for (const role of roles) {
    const type = typeForRole(role);
    const pool = repo.search({
      ...plan,
      dishTypes: type ? [type] : [],
      text: "",
    }, familyId);
    const card = pool.find((candidate) => !used.has(candidate.name) && !avoidMatches(candidate, avoid));
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

  if (state.pendingAsk?.key.startsWith("safety") && /注意|安全|替代|點食|可以食/.test(text)) {
    const next = withAsk(state, "safety");
    return result("ask", "安全要緊：請先確認你嘅敏感原或身體狀況；確診前我唔會出卡。", [], {
      kind: "ask",
      question: "safety",
    }, next, "safety");
  }

  if (POLITE_RE.test(text)) {
    return result("text", "唔使客氣。想再搵食譜就話我知。", [], { kind: "non_food" }, clearAsk(state), "non_food");
  }

  if (NON_FOOD_RE.test(text)) {
    return result("text", "我係煮食助手，只可以幫你搵食譜同煮食；其他嘢幫唔到。", [], { kind: "non_food" }, clearAsk(state), "non_food");
  }

  if (TECHNIQUE_RE.test(text)) {
    return result("text", "呢個係煮食技巧問題；我會用文字答，唔出卡。", [], { kind: "technique" }, clearAsk(state), null);
  }

  if (CLOSEST_RE.test(text) && !state.lastMiss && state.cardNames.length > 0) {
    const cards = repo.byNames(state.cardNames.slice(0, 3), familyId);
    if (cards.length > 0) {
      return result("cards", "以下係上一輪最接近嘅食譜。", cards, { kind: "closest" }, withMeal(state, state.shape, cards.map((card) => card.name)), null);
    }
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

  const ambiguousModifier = !planned
    && state.shape.dishes + state.shape.soups === 0
    && !state.pendingAsk
    && /(?:豐富|簡單|清淡)\s*(?:啲|啲啦|點)/.test(text)
    && !/(?:小朋友|半個鐘|快煮|有咩|食材|人食)/.test(text)
    && !queryPlan.scenarios.includes("quick")
    && !queryPlan.scenarios.includes("kids")
    && queryPlan.dishTypes.length === 0;
  if (ambiguousModifier) {
    const next = withAsk(state, "clarify");
    return result("ask", "想食邊款？可以講食材、菜名，或者幾多人食。", [], { kind: "ask", question: "clarify" }, next, "ambiguous_food");
  }

  const preference = text.match(/^我唔食(.+)/);
  if (preference) {
    const avoidTerm = preference[1].replace(/[，,。；;！!？?\s]/g, "").slice(0, 12);
    const next = withAsk(state, "preference");
    next.avoid = [...new Set([...next.avoid, avoidTerm])].filter(Boolean);
    return result("ask", "明白你唔食呢樣。你想食邊類？", [], {
      kind: "ask",
      question: "preference",
    }, next, "ambiguous_food");
  }

  const targetlessModifier = !planned
    && !state.pendingAsk
    && state.shape.dishes + state.shape.soups === 0
    && /^(?:想食|想要|要|兩|2|四|4|一|1)/.test(text)
    && queryPlan.dishTypes.length === 0
    && (queryPlan.scenarios.length > 0 || CONTEXT_RE.test(text));
  if (targetlessModifier) {
    const next = withAsk(state, "clarify");
    return result("ask", "想食邊款？可以講食材、菜名，或者幾多人食。", [], {
      kind: "ask",
      question: "clarify",
    }, next, "ambiguous_food");
  }

  if (PANTRY_RE.test(text) && !planned) {
    const terms = text.match(/[\u4e00-\u9fff]{2,}/g)?.filter((term) => !/雪櫃|冰箱|有|同|和|剩|得/.test(term)) ?? [];
    const pantryPlan = { ...queryPlan, dishTypes: [], scenarios: [], text: "", avoid: [] };
    const candidates = repo.search(pantryPlan, familyId).filter((card) =>
      terms.some((term) => card.ingredients.some((ingredient) => ingredient.includes(term))),
    );
    const pantryCards = candidates.length > 0
      ? candidates.slice(0, 1)
      : repo.search({ ...pantryPlan, dishTypes: [], scenarios: [], text: "" }, familyId).slice(0, 1);
    if (pantryCards.length > 0) {
      const cards = pantryCards;
      return result("cards", "用你雪櫃有嘅食材，可以先試呢個：", cards, {
        kind: "recipe",
        shape: { dishes: cards.length, soups: 0 },
      }, withMeal(state, { dishes: cards.length, soups: 0 }, cards.map((card) => card.name)), null);
    }
  }

  const targetlessBeforePlan = !state.pendingAsk
    && state.shape.dishes + state.shape.soups === 0
    && /^(?:兩|2|四|4|一|1|想食|想要|要)/.test(text)
    && queryPlan.dishTypes.length === 0
    && (queryPlan.scenarios.length > 0 || CONTEXT_RE.test(text));
  if (targetlessBeforePlan) {
    const next = withAsk(state, "clarify");
    return result("ask", "想食邊款？可以講食材、菜名，或者幾多人食。", [], { kind: "ask", question: "clarify" }, next, "ambiguous_food");
  }

  if (!planned && /(?:今晚|今日).{0,6}(?:食咩好|煮咩好|食乜好)|^(?:食咩好|煮咩好|食乜好)/.test(text)) {
    const next = withAsk(state, "clarify");
    return result("ask", "想食邊類？可以講食材、菜名，或者幾多人食。", [], {
      kind: "ask",
      question: "clarify",
    }, next, "ambiguous_food");
  }

  if (planned && planned.kind === "meal") {
    const roles = planned.requested.roles as DomainRole[];
    const cards = pickForRoles(repo, roles, queryPlan, familyId, state.avoid);
    if (cards.length === planned.requested.total) {
      return result("cards", `我幫你揀咗 ${cards.length} 張食譜。`, cards, {
        kind: "meal",
        shape: planned.shape,
        roles,
        modifiers: planned.modifiers,
      }, withMeal(state, planned.shape, cards.map((card) => card.name)), null);
    }
    const firstLabel = queryPlan.text || text;
    const targetFacetList = targetFacets(text);
    const alternatives = (targetFacetList.length > 0
      ? repo.byFacets(targetFacetList, familyId)
      : repo.search({ ...queryPlan, text: queryPlan.text, dishTypes: [] }, familyId))
      .slice(0, 3).map((card) => card.name);
    const next = withMiss(state, { label: firstLabel, kind: "meal", alternatives });
    return result("ask", `庫存未夠「${firstLabel}」嘅食譜；最接近：${alternatives.join("、") || "暫時冇"}。`, [], {
      kind: "ask",
      question: "library_miss",
    }, withAsk(next, "library_miss"), "library_miss");
  }

  // A user can answer an open ask, or ask for a concrete dish, with a tolerant
  // name match. This runs before the pendingAsk guard so it also works when the
  // previous turn was not an ask.
  const nameTarget = tolerantNameTarget(text);
  if (nameTarget) {
    const all = repo.search({ dishTypes: [], scenarios: [], tags: [], avoid: [], text: "" }, familyId);
    const normalizedTarget = normalize(nameTarget);
    const matched = all.filter((card) => {
      const cardName = normalize(card.name);
      return cardName.includes(normalizedTarget) || normalizedTarget.includes(cardName);
    }).slice(0, 3);
    if (matched.length > 0) {
      return result("cards", "收到，幫你搵到呢個。", matched, {
        kind: "recipe",
        shape: { dishes: matched.length, soups: 0 },
      }, withMeal(state, { dishes: matched.length, soups: 0 }, matched.map((card) => card.name)), null);
    }
  }

  if (state.pendingAsk && state.pendingAsk.askedCount >= state.pendingAsk.maxAskCount) {
    // The user may answer an ask with one exact dish/ingredient. Name match wins
    // before carrying an older lastMiss or using the generic basket.
    const namedAnswer = repo.byNames([text.trim()], familyId);
    if (namedAnswer.length > 0) {
      return result("cards", "收到，幫你搵到呢個。", namedAnswer.slice(0, 3), {
        kind: "recipe",
        shape: { dishes: namedAnswer.length, soups: 0 },
      }, withMeal(state, { dishes: namedAnswer.length, soups: 0 }, namedAnswer.map((card) => card.name)), null);
    }
    if (queryPlan.dishTypes.length > 0 || queryPlan.scenarios.length > 0) {
      // A concrete new category/scenario answer should continue through the
      // normal target path, not the generic fallback.
    } else {
      // Preserve the target of the ask; only use the generic basket when there is
      // no prior miss/target to carry.
      const carried = state.lastMiss?.alternatives?.length
        ? repo.byNames(state.lastMiss.alternatives.slice(0, 3), familyId)
        : [];
    const fallback = carried.length > 0
      ? carried
      : repo.search(buildDomainQueryPlan("家常"), familyId).slice(0, 3);
    if (fallback.length > 0) {
      return result("cards", carried.length > 0 ? "我按你上一輪嘅目標再揀 3 張。" : "我先幫你揀 3 張預設；唔啱話我知，再幫你換。", fallback, {
        kind: "meal",
        shape: { dishes: fallback.length, soups: 0 },
      }, withMeal(state, { dishes: fallback.length, soups: 0 }, fallback.map((card) => card.name)), null);
    }
    }
  }

  if (state.shape.dishes + state.shape.soups > 0 && CONTEXT_RE.test(text)) {
    const roles = rolesForShape(state.shape);
    const contextPlan = {
      ...queryPlan,
      avoid: [...new Set([...state.avoid, ...queryPlan.avoid])],
    };
    const cards = pickForRoles(repo, roles, contextPlan, familyId, state.avoid);
    if (cards.length === roles.length) {
      let next = withMeal(state, state.shape, cards.map((card) => card.name), {
        avoid: contextPlan.avoid,
        scenarios: queryPlan.scenarios,
      });
      if (state.lastMiss) next = withMiss(next, state.lastMiss);
      return result("cards", "我按你今次嘅要求重新揀咗以下食譜。", cards, {
        kind: "meal",
        shape: state.shape,
        roles,
      }, next, null);
    }
  }

  const namedProtein = /魚|鱼|蝦|虾|牛|和牛|beef|steak|雞|鸡|pork|chicken|扇貝|扇贝|帶子|带子|青口|花甲|蜆|蚬|蠔|蚝|蟶子|蛏子/i.test(text)
    && !/(?:有咩|有乜|食咩好|雪櫃|冰箱)/.test(text)
    && !/唔食/.test(text);
  const specific = (/[\u4e00-\u9fff]{4,}/.test(text) || namedProtein)
    && !/^我要/.test(text)
    && !/(?:有咩|有乜|食咩好|有邊|款式|選擇|推薦|推介|再一套|唔要|唔食|不要|快煮|清淡|雪櫃|冰箱|多謝|唔該)/.test(text);
  if ((specific || namedProtein) && !planned) {
    const targetFacetList = targetFacets(text);
    const targetDishTypes: DomainDishType[] = /(?:麵|面|粉|飯|noodle|rice|pasta)/i.test(text) ? ["carb"] : [];
    const terms = targetTerms(text);
    let facetCards = repo.byFacets(targetFacetList, familyId, targetDishTypes)
      .filter((card) => targetFacetList.some((facet) => nameMatchesFacet(card.name, facet)))
      .filter((card) => cardHasTerm(card, terms))
      .filter((card) => !avoidMatches(card, state.avoid))
      .filter((card) => queryPlan.scenarios.length === 0 || queryPlan.scenarios.some((s) => (card.scenarios ?? card.tags).includes(s)));
    if (facetCards.length < 3) {
      const primary = targetFacetList.find((facet) => facet !== "vegetable" && facet !== "soup") ?? targetFacetList[0];
      if (primary && primary !== targetFacetList[0]) {
        facetCards = repo.byFacets([primary], familyId, targetDishTypes)
          .filter((card) => nameMatchesFacet(card.name, primary))
          .filter((card) => cardHasTerm(card, terms))
          .filter((card) => !avoidMatches(card, state.avoid));
      }
    }
    // Do not replace a relevant, short result with the unfiltered seafood pool.
    // An empty result falls through to a concrete ask.
    facetCards = facetCards.slice(0, 3);
    const hesitantSpecific = /魚|鱼/.test(text) && /菜/.test(text)
      && !/(?:麵|面|粉|飯|或者|或|同|and|或者)/i.test(text);
    if (facetCards.length > 0 && !hesitantSpecific) {
      return result("cards", "我幫你搵到以下食譜。", facetCards, {
        kind: "recipe",
        shape: { dishes: facetCards.length, soups: 0 },
      }, withMeal(state, { dishes: facetCards.length, soups: 0 }, facetCards.map((card) => card.name)), null);
    }
    const alternatives = facetCards.length > 0
      ? facetCards
      : repo.search({ ...queryPlan, text: "", dishTypes: [] }, familyId).slice(0, 3);
    const exact = alternatives.some((card) => normalize(card.name).includes(normalize(text)) || normalize(text).includes(normalize(card.name)));
    if (!exact) {
      const next = withMiss(state, { label: text, kind: "dish", alternatives: alternatives.map((card) => card.name) });
      return result("ask", `庫存冇「${text}」，以下係最接近嘅食譜：${alternatives.map((card) => card.name).join("、") || "暫時冇"}。`, [], {
        kind: "ask",
        question: "library_miss",
      }, withAsk(next, "library_miss"), "library_miss");
    }
  }

  const seen = new Set(state.cardNames);
  const candidates = repo.search(queryPlan, familyId)
    .filter((card) => !seen.has(card.name) && !avoidMatches(card, state.avoid));
  if (candidates.length > 0 && (queryPlan.dishTypes.length > 0 || queryPlan.scenarios.length > 0)) {
    const cards = candidates.slice(0, 3);
    let next = withMeal(state, { dishes: cards.length, soups: 0 }, cards.map((card) => card.name), {
      avoid: [...new Set([...state.avoid, ...queryPlan.avoid])],
      scenarios: queryPlan.scenarios,
    });
    if (queryPlan.text) {
      next = withMiss(next, { label: queryPlan.text, kind: "dish", alternatives: candidates.slice(0, 3).map((card) => card.name) });
    }
    return result("cards", "我幫你搵到以下食譜。", cards, {
      kind: "recipe",
      shape: { dishes: cards.length, soups: 0 },
    }, next, null);
  }

  const next = withAsk(state, "clarify");
  return result("ask", "你想食咩類型？例如湯、粉麵、小炒，或者有咩食材？", [], {
    kind: "ask",
    question: "clarify",
  }, next, "ambiguous_food");
}
