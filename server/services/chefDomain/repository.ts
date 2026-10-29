import { readFileSync } from "node:fs";
import type { DomainDishType, QueryPlan, RecipeCard } from "./types";

export interface RecipeRepository {
  search(plan: QueryPlan, familyId: number): RecipeCard[];
  byNames(names: string[], familyId: number): RecipeCard[];
  byFacets(facets: string[], familyId: number, dishTypes?: DomainDishType[]): RecipeCard[];
}

const TYPES: DomainDishType[] = ["meat", "seafood", "vegetable", "soup", "carb", "appetizer", "dessert", "drink", "other"];

export class FakeRepository implements RecipeRepository {
  private readonly cards: RecipeCard[];

  constructor(cards: RecipeCard[]) {
    this.cards = [...cards].sort((a, b) => a.id.localeCompare(b.id));
  }

  search(plan: QueryPlan, familyId: number): RecipeCard[] {
    return this.cards.filter((card) => {
      if (card.visibility === "private" && card.familyId !== familyId) return false;
      if (plan.dishTypes.length > 0 && !plan.dishTypes.includes(card.dishType)) return false;
      if (plan.scenarios.length > 0 && !plan.scenarios.some((scenario) => (card.scenarios ?? card.tags).includes(scenario))) return false;
      if (plan.cookTimeMax && card.cookTime > plan.cookTimeMax) return false;
      if (plan.avoid.some((term) => card.ingredients.some((ingredient) => ingredient.includes(term)))) return false;
      if (plan.text && !`${card.name} ${card.tags.join(" ")} ${card.ingredients.join(" ")}`.includes(plan.text)) {
        // Category-only plans (dishTypes/scenarios) ignore stale text.
        if (plan.dishTypes.length === 0 && plan.scenarios.length === 0) return false;
      }
      return true;
    });
  }

  static fromFile(file: string): FakeRepository {
    const rows = JSON.parse(readFileSync(file, "utf8")) as RecipeCard[];
    return new FakeRepository(rows);
  }

  byNames(names: string[], familyId: number): RecipeCard[] {
    const wanted = new Set(names);
    return this.cards.filter((card) => wanted.has(card.name) && (card.visibility !== "private" || card.familyId === familyId));
  }

  byFacets(facets: string[], familyId: number, dishTypes: DomainDishType[] = []): RecipeCard[] {
    return this.cards.filter((card) => (card.visibility !== "private" || card.familyId === familyId)
      && (dishTypes.length === 0 || dishTypes.includes(card.dishType))
      && (facets.length === 0 || facets.every((facet) => (card.facets ?? []).includes(facet))));
  }

  static standardCatalog(): RecipeCard[] {
    return [
      ...TYPES.map((type, i) => ({
        id: `official-${type}`,
        name: `${type} default`,
        dishType: type,
        ingredients: ["水"],
        tags: ["quick", "healthy", "kids"],
        cookTime: 10,
        visibility: "official" as const,
        familyId: 0,
      })),
      { id: "official-meat-2", name: "meat second", dishType: "meat", ingredients: ["水"], tags: [], cookTime: 20, visibility: "official", familyId: 0 },
      { id: "official-soup-2", name: "soup second", dishType: "soup", ingredients: ["水"], tags: [], cookTime: 20, visibility: "official", familyId: 0 },
      { id: "official-veg-2", name: "vegetable second", dishType: "vegetable", ingredients: ["水"], tags: [], cookTime: 20, visibility: "official", familyId: 0 },
      { id: "public-kol", name: "public kol", dishType: "vegetable", ingredients: ["水"], tags: [], cookTime: 15, visibility: "public", familyId: 0 },
      { id: "private-a", name: "private a", dishType: "meat", ingredients: ["水"], tags: [], cookTime: 15, visibility: "private", familyId: 5 },
      { id: "private-b", name: "private b", dishType: "vegetable", ingredients: ["水"], tags: [], cookTime: 15, visibility: "private", familyId: 6 },
    ];
  }
}
