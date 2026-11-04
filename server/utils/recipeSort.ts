/**
 * Ordering for `recipes.search`.
 *
 * Every mode ends with `id` on purpose: `createdAt` alone is not unique (two
 * recipes imported in the same second), and a non-deterministic tie-break makes
 * cursor/offset pagination repeat or skip rows.
 */
export type RecipeSortMode = "popular" | "newest" | "updated";
export type RecipeSortKey = "popularity" | "createdAt" | "updatedAt" | "id";

export function recipeSortOrder(mode: RecipeSortMode): {
  official: RecipeSortKey[];
  custom: RecipeSortKey[];
} {
  switch (mode) {
    case "newest":
      // 最新新增：createdAt 先行，id 做 tiebreaker
      return { official: ["createdAt", "id"], custom: ["createdAt", "id"] };
    case "updated":
      // 最近編輯：official 冇編輯概念 → 用 createdAt
      return { official: ["createdAt", "id"], custom: ["updatedAt", "id"] };
    default:
      // popular（預設）= 舊行為 + id tiebreaker
      return { official: ["popularity", "createdAt", "id"], custom: ["popularity", "createdAt", "id"] };
  }
}
