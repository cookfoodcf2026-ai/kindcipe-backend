import { readFileSync } from "node:fs";
import { toChefLibraryRecipe, retrieveChefCards } from "../server/services/chefRetrieval";
const rows = JSON.parse(readFileSync(process.env.HOME + "/.hermes/cache/scratch/official_dump.json", "utf8"));
const pool = rows.map((r: any) => toChefLibraryRecipe({ ...r, ingredients: Array.isArray(r.ingredients) ? r.ingredients : JSON.parse(r.ingredients ?? "[]"), dishType: r.dish_type, cookTime: r.cook_time, difficulty: r.difficulty }));
for (const dt of ["noodle", "soup"] as const) {
  const res = retrieveChefCards({ wantsCards: true, dishType: dt }, pool, { count: 3 });
  console.log(dt, "cards:", res.cards.map((c) => c.name).join(" / ") || "NONE", "| relax", res.relaxLevel, "| stages", JSON.stringify(res.stageCandidates));
}
