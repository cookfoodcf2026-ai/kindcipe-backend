/**
 * Food-term false-positive guards (deterministic).
 *
 * These guards prevent taste/compound words from being misread as proteins or
 * dish categories, e.g. 魚香茄子 ≠ fish, 牛油果 ≠ beef, 湯圓 ≠ soup,
 * 豬仔包 ≠ pork, 蟹味菇 ≠ crab, 家常菜 ≠ vegetable role.
 */

/** Tokens that contain a food word but do NOT imply that food. Longest first. */
const NEUTRAL_FOOD_TOKENS = [
  "牛油果", "牛油", "牛奶", "奶油", "牛肝菌",
  "羊肚菌",
  "魚香", "魚露",
  "湯圓", "湯丸",
  "豬仔包",
  "蟹味菇",
  "雞蛋果", "雞粉", "雞湯",
  "肉豆蔻", "肉桂",
].sort((a, b) => b.length - a.length);

/** Generic dish words must never resolve to a specific meal role. */
const GENERIC_DISH_RE = /(?:家常小菜|家常菜|宴客菜|開胃菜|小菜|菜式|菜色|菜譜|菜單)/g;
const GENERIC_DISH_EXACT_RE = /^(?:家常小菜|家常菜|宴客菜|開胃菜|小菜|菜式|菜色|菜譜|菜單)$/;

/**
 * Vegetable-ish name/ingredient signal.
 * Includes 南瓜/茄子/番茄/菇/青椒 etc., not only 菜/苗/蘭.
 */
export const VEGETABLE_NAME_RE = /(?:菜心|芥蘭|芥兰|時蔬|时蔬|青菜|蔬菜|豆苗|豆芽|豆角|四季豆|荷蘭豆|荷兰豆|甜豆|豌豆|青豆|毛豆|菠菜|生菜|通菜|白菜|椰菜|西蘭花|西兰花|浸菜|炒菜|南瓜|茄子|番茄|蕃茄|青椒|彩椒|辣椒|瓜|菇|菌|苗|蘭|兰|筍|笋|木耳|雲耳|云耳|洋蔥|洋葱|蘿蔔|萝卜|薯|蓮藕|莲藕|粟米|玉米|沙律|沙拉)/i;

/** Remove neutral tokens, longest first. */
export function stripFoodTermNeutral(text: string): string {
  let out = String(text ?? "");
  for (const token of NEUTRAL_FOOD_TOKENS) out = out.split(token).join(" ");
  return out.replace(/\s+/g, " ").trim();
}

/** Remove generic dish words (家常菜/小菜/菜式 …) before role detection. */
export function stripGenericDishWords(text: string): string {
  return String(text ?? "").replace(GENERIC_DISH_RE, " ").replace(/\s+/g, " ").trim();
}

/** True when the whole term is a generic dish word rather than a concrete food. */
export function isGenericDishTerm(text: string): boolean {
  const raw = String(text ?? "").trim().replace(/[?？!！。.,，、;；:：\s]+/g, "");
  return GENERIC_DISH_EXACT_RE.test(raw);
}

/** Combined cleanup used before protein/role regex checks. */
export function stripFoodTermNoise(text: string): string {
  return stripGenericDishWords(stripFoodTermNeutral(text));
}
