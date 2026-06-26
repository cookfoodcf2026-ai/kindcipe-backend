import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getCommonIngredients, searchCommonIngredients } from "../db";

export const commonIngredientRouter = router({
  /**
   * Return all active common ingredients for frontend caching.
   * Frontend should cache this and filter locally.
   */
  list: protectedProcedure.query(async () => {
    return getCommonIngredients();
  }),

  /**
   * Search common ingredients by query across all language fields.
   * Used as fallback when frontend cache is empty.
   */
  suggestions: protectedProcedure
    .input(
      z.object({
        query: z.string().min(1).max(50),
        limit: z.number().int().min(1).max(20).default(10),
      })
    )
    .query(async ({ input }) => {
      return searchCommonIngredients(input.query, input.limit);
    }),
});
