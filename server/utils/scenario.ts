/**
 * Scenario (hotkey) derivation — deterministic, LLM-free.
 *
 * "Scenarios" mirror the AI Chef hotkey buttons (quick / healthy / ricecooker /
 * kids / guest). They are NOT stored as a single-choice category: a recipe can
 * belong to several scenarios, so this returns a multi-label list derived purely
 * from existing attributes (cookTime / difficulty / dishType / recipeCategory /
 * tags / ingredients / steps / name).
 *
 * Used on write (import / custom / official create) to populate
 * `scenarioTags`, and by the backfill script. Hotkey queries then match on this
 * stable label instead of brittle free-text search, so every recipe (official
 * OR user-imported) is reliably reachable.
 */

export type Scenario = "quick" | "healthy" | "ricecooker" | "kids" | "guest";

export const ALL_SCENARIOS: Scenario[] = [
  "quick",
  "healthy",
  "ricecooker",
  "kids",
  "guest",
];

export interface ScenarioInput {
  name?: string | null;
  description?: string | null;
  cookTime?: number | null;
  difficulty?: string | null;
  dishType?: string | null;
  recipeCategory?: string | null;
  tags?: string[] | string | null;
  ingredients?: Array<{ name?: string | null }> | string | null;
  steps?: Array<string | { instruction?: string | null }> | string | null;
}

function toText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    return v
      .map((x) =>
        typeof x === "string"
          ? x
          : x && typeof x === "object"
            ? String((x as any).name ?? (x as any).instruction ?? "")
            : String(x ?? "")
      )
      .join(" ");
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function toTags(v: ScenarioInput["tags"]): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((t) => String(t));
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p.map((t) => String(t)) : [];
  } catch {
    return String(v).split(/[,\s、]+/).filter(Boolean);
  }
}

const isQuick = (cookTime?: number | null, slowText = ""): boolean =>
  typeof cookTime === "number"
  && Number.isFinite(cookTime)
  && cookTime > 0
  && cookTime <= 30
  && !SLOW_COOK_RE.test(slowText);

const HEALTHY_TAGS = ["清淡", "少油", "低脂", "健康", "輕食", "轻食", "少鹽", "少盐", "蒸", "水煮", "清蒸", "白灼"];
const RICECOOKER_RE = /電飯煲|电饭煲|電子鍋|电子锅|一鍋|一锅|煲仔|燜|焖|炆|慢煮|慢燉|慢炖|壓力鍋|压力锅|氣炸|气炸/;
const SLOW_COOK_RE = /炆|燜|焖|燉|炖|煲|慢煮|醃過夜|腌过夜/;
const KIDS_TAGS = ["小朋友", "幼兒", "幼儿", "兒童", "儿童", "不辣", "親子", "亲子", "BB", "bb"];
const KIDS_NAME_RE = /兒童|儿童|親子|亲子/;
const GUEST_TAGS = ["宴客", "大菜", "喜慶", "喜庆", "節慶", "节庆", "招待", "過節", "过节", "party", "Party"];
const GUEST_RE = /宴客|大菜|喜慶|喜庆|節慶|节庆|招待|過節|过节/;
const SPICY_RE = /辣|麻辣|花椒|芥末|wasabi|chilli|chili/;
const FRIED_RE = /炸|油炸|deep.?fry|fried/;

/**
 * Derive the multi-label scenario list for a recipe.
 * Deterministic — safe to run on every write and to backfill.
 */
export function deriveScenarios(input: ScenarioInput): Scenario[] {
  const name = String(input.name ?? "");
  const dishType = String(input.dishType ?? "");
  const tags = toTags(input.tags);
  const tagsText = tags.join(" ");
  const stepsText = toText(input.steps);
  const bodyText = `${name} ${String(input.description ?? "")} ${stepsText} ${toText(input.ingredients)} ${tagsText}`;
  const out = new Set<Scenario>();

  if (isQuick(input.cookTime, `${name} ${stepsText}`)) out.add("quick");

  // healthy: explicit tags, OR a light cooking method, OR a plain steamed veg dish
  if (HEALTHY_TAGS.some((t) => tagsText.includes(t))) out.add("healthy");
  if (dishType === "vegetable" && !FRIED_RE.test(bodyText)) out.add("healthy");
  if (dishType === "seafood" && /蒸|灼|白灼|清蒸|水煮/.test(bodyText)) out.add("healthy");

  // ricecooker / one-pot: tags, name, steps, or a soup
  if (RICECOOKER_RE.test(bodyText)) out.add("ricecooker");
  if (dishType === "soup") out.add("ricecooker");

  // kids: explicit tags, kid-named dishes, or non-spicy dessert/drink.
  // Difficulty alone must never imply a kids meal.
  if (KIDS_TAGS.some((t) => tagsText.includes(t))) out.add("kids");
  if (KIDS_NAME_RE.test(name)) out.add("kids");
  if ((dishType === "dessert" || dishType === "drink") && !SPICY_RE.test(bodyText)) out.add("kids");

  // guest: explicit tags, or festive name
  if (GUEST_TAGS.some((t) => tagsText.includes(t))) out.add("guest");
  if (GUEST_RE.test(name)) out.add("guest");

  return ALL_SCENARIOS.filter((s) => out.has(s));
}

/** JSON string for storing in `scenario_tags` (empty array when none). */
export function computeScenarioTags(input: ScenarioInput): string {
  return JSON.stringify(deriveScenarios(input));
}

/** True if the recipe matches the given scenario (used by hotkey queries). */
export function matchesScenario(input: ScenarioInput, scenario: Scenario): boolean {
  return deriveScenarios(input).includes(scenario);
}

/** Serialize user-declared scenarios into `scenario_tags_user`. Empty array
 * stays `"[]"`, which the query layer treats as "fall back to derived". */
export function serializeUserScenarioTags(scenarios?: string[] | null): string | undefined {
  if (scenarios === undefined) return undefined;
  const unique = [...new Set((scenarios ?? []).map(String))].filter((scenario): scenario is Scenario =>
    (ALL_SCENARIOS as string[]).includes(scenario),
  );
  return JSON.stringify(unique);
}
