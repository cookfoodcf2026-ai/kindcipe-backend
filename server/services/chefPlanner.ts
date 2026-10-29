import type { RequestedRole } from "./chefIntent";

export type MealShape = { dishes: number; soups: number };
export type PlannerModifier =
  | { op: "remove"; kind: "soup" }
  | { op: "add"; kind: "dish" }
  | { op: "remove"; kind: "ingredient" };

export type ChefTurnCommand = {
  kind: "meal" | "recipe";
  shape: MealShape;
  requested: { total: number; roles: RequestedRole[] };
  modifiers: PlannerModifier[];
  followUp: boolean;
  confidence: number;
  reason: "explicit_meal" | "meal_followup" | "remove_soup" | "add_dish" | "context_modifier";
};

const CN_NUM: Record<string, number> = {
  零: 0, 一: 1, 兩: 2, 二: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

function toNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const token = raw.trim();
  if (/^\d+$/.test(token)) return Number(token);
  return CN_NUM[token] ?? null;
}

function clamp(n: number | null, min: number, max: number): number | null {
  if (n === null || !Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

/** Structural meal parser. It intentionally does not understand food names. */
export function parseMealShape(text: string): MealShape | null {
  const raw = String(text ?? "").trim();
  const withSoup = raw.match(/(\d+|[一二兩两三四五六七八九十])\s*[送餸]\s*(?:(\d+|[一二兩两三四五六七八九十])\s*[湯汤]|[湯汤])/);
  if (withSoup) {
    const dishes = toNumber(withSoup[1]);
    const soups = withSoup[2] ? toNumber(withSoup[2]) : 1;
    if (dishes === null || soups === null) return null;
    return { dishes: Math.max(0, Math.min(10, dishes)), soups: Math.max(1, Math.min(5, soups)) };
  }
  const dishesOnly = raw.match(/(\d+|[一二兩两三四五六七八九十])\s*(?:[個个道款樣样份]\s*)?(?:餸|送)/)
    ?? raw.match(/(\d+|[一二兩两三四五六七八九十])\s*[樣样款]\s*(?:菜)?/)
    ?? raw.match(/(\d+|[一二兩两三四五六七八九十])\s*[個个道]\s*菜/);
  if (dishesOnly) {
    const dishes = clamp(toNumber(dishesOnly[1]), 1, 10);
    if (dishes === null) return null;
    return { dishes, soups: 0 };
  }
  return null;
}

export function isMealFollowUp(text: string): boolean {
  return /^(?:再|換|唔同|另一|第二|another|next|different)(?:\s|$|，|,|。|！|!|\?|？)|^(?:再|換|唔同|另一|第二)(?:一|兩|几|幾)?(?:套|組|份)|^(?:再|換|唔同|另一|第二).{0,6}嘅|(?:再|另一|換|唔同|第二|另一個|另一組|再嚟|再來|different|another|next)\s*.{0,10}(?:set|組|餐|批|款|round|one|meal)|\b(?:give me|i want|show me)\s+(?:another|a different)\b|比另一\s*set/i.test(String(text ?? "").trim());
}

function isRemoveSoup(text: string): boolean {
  return /^(?:唔要|不要|走|唔飲|no|without)\s*[湯汤]|[湯汤]\s*(?:唔要|不要|走|no|without)|(?:唔要|不要|走|冇|無|no|without)\s*soup/i.test(String(text ?? "").trim());
}

function isAddDish(text: string): boolean {
  return /^(?:加|多)\s*(?:多|一|1|兩|两|2|幾|几)?\s*(?:個|个|道|款|樣|样|份)?\s*(?:菜|餸|dish)/i.test(String(text ?? "").trim());
}

function isContextModifier(text: string): boolean {
  const raw = String(text ?? "").trim();
  return /^(?:快|快啲|快手|清淡|健康|辣|辣啲|小辣|少辣|多辣|唔好整|不要整|四個人|4個人|四人|4人|兩個人|2人)/i.test(raw)
    || /\bquick\b|快啲|辣啲|清淡|四個人|4個人|4人/i.test(raw);
}

function rolesForShape(shape: MealShape): RequestedRole[] {
  const dishes = Math.max(0, shape.dishes);
  const base: RequestedRole[] = dishes >= 3
    ? ["meat", "seafood", "vegetable"]
    : dishes === 2
      ? ["meat", "any"]
      : dishes === 1
        ? ["any"]
        : [];
  while (base.length < dishes) base.push("any");
  return [...base.slice(0, dishes), ...Array.from({ length: Math.max(0, shape.soups) }, () => "soup" as RequestedRole)];
}

function command(shape: MealShape, modifiers: PlannerModifier[], followUp: boolean, reason: ChefTurnCommand["reason"], confidence: number): ChefTurnCommand {
  const requestedRoles = rolesForShape(shape);
  return {
    kind: shape.dishes + shape.soups > 1 ? "meal" : "recipe",
    shape,
    requested: { total: requestedRoles.length, roles: requestedRoles },
    modifiers,
    followUp,
    confidence,
    reason,
  };
}

/**
 * First parser layer: structural meal commands only. Food names and semantic
 * attributes (spicy, cuisine, ingredients) must go to the dispatcher.
 */
export function planChefTurn(
  text: string,
  opts: { previousText?: string; previousTexts?: string[]; previousMeal?: MealShape } = {},
): ChefTurnCommand | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;

  const explicit = parseMealShape(raw);
  if (explicit) return command(explicit, [], false, "explicit_meal", 0.98);

  const peopleMeal = /(?:\d+|[一二兩两三四五六七八九十])\s*(?:個|个)?人/.test(raw)
    && !/(?:牛|豬|猪|雞|鸡|魚|鱼|蝦|虾|蟹|菜|豆腐|蛋|麵|面|飯|饭|湯|汤)/i.test(raw);
  if (peopleMeal) return command({ dishes: 3, soups: 0 }, [], false, "explicit_meal", 0.86);

  const previous = opts.previousMeal
    ?? (opts.previousText ? parseMealShape(opts.previousText) : null)
    ?? [...(opts.previousTexts ?? [])].reverse().map((item) => parseMealShape(item)).find(Boolean)
    ?? null;
  if (!previous) return null;

  if (isRemoveSoup(raw)) {
    return command({ dishes: previous.dishes, soups: 0 }, [{ op: "remove", kind: "soup" }], true, "remove_soup", 0.96);
  }
  if (isAddDish(raw)) {
    return command({ dishes: Math.min(10, previous.dishes + 1), soups: previous.soups }, [{ op: "add", kind: "dish" }], true, "add_dish", 0.94);
  }
  if (isMealFollowUp(raw)) {
    return command(previous, [], true, "meal_followup", 0.95);
  }
  if (isContextModifier(raw)) {
    return command(previous, [], true, "context_modifier", 0.88);
  }
  return null;
}

export function isStructuralShortFollowUp(text: string): boolean {
  const raw = String(text ?? "").trim();
  return raw.length <= 24 && (isMealFollowUp(raw) || isRemoveSoup(raw) || isAddDish(raw) || isContextModifier(raw));
}
