/**
 * Ingredient quality helpers applied to parsed (AI-extracted) ingredient lists.
 *
 * Two concerns, both purely deterministic:
 *  1. dedupeIngredients — merge duplicate ingredients that differ only by spelling
 *     (醬油 / しょうゆ / soy sauce). Quantities are NEVER summed: a duplicate must
 *     not inflate the shopping list. First non-empty quantity/unit wins.
 *  2. markQuantityProvenance — decide whether an AI-supplied quantity actually
 *     appears in the source text. `exact` when the quantity token is found near
 *     the ingredient name, otherwise `estimated` (the value is kept, but the UI
 *     must show it as an AI estimate).
 */
import { canonicalIngredientKey } from "./importGrounding";

export type QuantityStatus = "exact" | "estimated";

export interface QualityIngredient {
  name?: string;
  nameEn?: string;
  quantity?: string;
  unit?: string;
  quantityStatus?: QuantityStatus;
  [key: string]: unknown;
}

const CJK_DIGITS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 兩: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

const UNIT_PATTERN =
  "克|公克|公斤|千克|kg|g|gs|毫升|公升|ml|l|茶匙|湯匙|大匙|小匙|匙|杯|碗|個|隻|条|條|片|塊|块|粒|瓣|棵|把|束|包|罐|盒|滴|適量|少許|适量|少许|寸|磅|lb|oz";

/** Normalise a quantity token for substring search (full-width → half-width, trim). */
function normaliseAmount(value: string): string {
  return value
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, ".")
    .replace(/[～〜]/g, "-")
    .replace(/\s+/g, "");
}

/** Does `token` look like a quantity/amount we can search for? */
function isSearchableAmount(token: string): boolean {
  if (!token) return false;
  if (/^\d+(\.\d+)?$/.test(token)) return true; // 200, 1.5
  if (/^\d+(\.\d+)?-\d+(\.\d+)?$/.test(token)) return true; // 2-3
  if (/^\d+\/\d+$/.test(token)) return true; // 1/2
  if (Object.keys(CJK_DIGITS).some((d) => token.includes(d))) return true; // 兩條, 半個
  return false;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Look for the ingredient's quantity in a window around the ingredient name.
 * Returns true when the amount appears in the source text near the name.
 */
function quantityAppearsNear(sourceText: string, name: string, amount: string): boolean {
  const haystack = normaliseAmount(sourceText);
  const needle = normaliseAmount(amount);
  if (!needle) return false;
  if (!isSearchableAmount(needle)) {
    // Non-numeric descriptors (適量/少許) are acceptable when they appear anywhere.
    return haystack.includes(needle);
  }
  const nameNeedle = normaliseAmount(name);
  if (nameNeedle) {
    const idx = haystack.indexOf(nameNeedle);
    if (idx >= 0) {
      const window = haystack.slice(Math.max(0, idx - 40), idx + nameNeedle.length + 40);
      // Require the number to sit next to a unit (or to the name itself) — a stray
      // digit from a neighbouring ingredient must not validate this one.
      const unitWindow = new RegExp(`${escapeRegex(needle)}\\s*(?:${UNIT_PATTERN})`, "i");
      if (unitWindow.test(window)) return true;
      if (window.replace(/\s+/g, "").includes(`${nameNeedle}${needle}`)) return true;
      if (window.replace(/\s+/g, "").includes(`${needle}${nameNeedle}`)) return true;
    }
  }
  // Fall back to unit-adjacent matching only: "2-3 塊" must not validate a "2 隻" claim.
  const unitRegex = new RegExp(`${escapeRegex(needle)}\\s*(?:${UNIT_PATTERN})`, "i");
  return unitRegex.test(haystack);
}

/** Mark each ingredient's quantity as exact (verified in source) or estimated. */
export function markQuantityProvenance<T extends QualityIngredient>(
  list: T[],
  sourceText: string | null | undefined,
): T[] {
  if (!Array.isArray(list)) return [];
  const source = String(sourceText ?? "");
  if (!source.trim()) {
    return list.map((ing) => ({ ...ing, quantityStatus: (ing.quantityStatus ?? "estimated") as QuantityStatus }));
  }
  return list.map((ing) => {
    const amount = String(ing?.quantity ?? "").trim();
    if (!amount) return { ...ing, quantityStatus: "estimated" as QuantityStatus };
    const name = String(ing?.name ?? ing?.nameEn ?? "").trim();
    const verified = quantityAppearsNear(source, name, amount);
    return { ...ing, quantityStatus: (verified ? "exact" : "estimated") as QuantityStatus };
  });
}

/**
 * Merge duplicate ingredients by canonical key (醬油 / しょうゆ / soy sauce).
 * Quantities are never summed; the first non-empty quantity/unit wins.
 */
export function dedupeIngredients<T extends QualityIngredient>(list: T[]): T[] {
  if (!Array.isArray(list)) return [];
  const seen = new Map<string, T>();
  const out: T[] = [];
  for (const ing of list) {
    const rawName = String(ing?.name ?? "").trim();
    if (!rawName) {
      out.push(ing);
      continue;
    }
    // 生抽 / 老抽 / 豉油 are different seasonings — never merge them together.
    const TIGHT_KEEP = ["生抽", "老抽", "豉油", "頭抽", "頭道"];
    const isTight = TIGHT_KEEP.some((t) => rawName.includes(t));
    const key = isTight
      ? `tight:${rawName.toLowerCase()}`
      : canonicalIngredientKey(rawName) || canonicalIngredientKey(ing?.nameEn) || rawName.toLowerCase();
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, ing);
      out.push(ing);
      continue;
    }
    // Merge into the existing row without ever adding quantities together.
    const merged: T = { ...existing };
    if (!String(merged.quantity ?? "").trim() && String(ing?.quantity ?? "").trim()) {
      merged.quantity = ing.quantity;
    }
    if (!String(merged.unit ?? "").trim() && String(ing?.unit ?? "").trim()) {
      merged.unit = ing.unit;
    }
    if (!merged.nameEn && ing?.nameEn) merged.nameEn = ing.nameEn;
    const idx = out.indexOf(existing);
    if (idx >= 0) out[idx] = merged;
    seen.set(key, merged);
  }
  return out;
}
