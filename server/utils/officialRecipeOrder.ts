import crypto from "crypto";
import { asc, desc, sql, type SQL } from "drizzle-orm";
import { officialRecipes } from "../../drizzle/schema";

/**
 * Ordering for `recipes.listOfficial`.
 *
 * `daily` hashes the recipe id together with the current Hong Kong calendar
 * date, so the same recipe stays in the same position for the whole day and
 * the list rotates at midnight HKT. `id` is always the final key so offset
 * pagination has a total order even if two rows share a primary key value.
 */
export type OfficialOrder = "daily" | "fastest" | "newest";

export const OFFICIAL_ORDERS: readonly OfficialOrder[] = ["daily", "fastest", "newest"];

export function resolveOfficialSearchOrder(args: {
  source?: string | null;
  order?: OfficialOrder | null;
}): OfficialOrder | undefined {
  return args.source === "official" && args.order ? args.order : undefined;
}

// Mirrors HK_DATE_SQL below: YYYY-MM-DD in Asia/Hong_Kong.
export function dailyOrderKey(id: number, hkDate: string): string {
  return crypto.createHash("md5").update(`${id}${hkDate}`).digest("hex");
}

export function compareDailyOrder(
  a: { id: number },
  b: { id: number },
  hkDate: string,
): number {
  const ka = dailyOrderKey(a.id, hkDate);
  const kb = dailyOrderKey(b.id, hkDate);
  if (ka < kb) return -1;
  if (ka > kb) return 1;
  return a.id - b.id;
}

export function officialOrderBy(order: OfficialOrder): SQL[] {
  switch (order) {
    case "fastest":
      return [
        sql`${officialRecipes.cookTime} asc nulls last`,
        asc(officialRecipes.id),
      ];
    case "newest":
      return [
        desc(officialRecipes.createdAt),
        desc(officialRecipes.id),
      ];
    case "daily":
    default:
      return [
        sql`md5(concat(${officialRecipes.id}::text, (now() AT TIME ZONE 'Asia/Hong_Kong')::date::text))`,
        asc(officialRecipes.id),
      ];
  }
}
