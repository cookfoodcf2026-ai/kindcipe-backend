export type DomainRole = "meat" | "seafood" | "vegetable" | "soup" | "noodle" | "dessert" | "any";
export type DomainDishType = "soup" | "meat" | "seafood" | "vegetable" | "carb" | "appetizer" | "dessert" | "drink" | "other";
export type DomainScenario = "quick" | "healthy" | "ricecooker" | "kids" | "guest";

export type QueryPlan = {
  dishTypes: DomainDishType[];
  scenarios: DomainScenario[];
  tags: string[];
  avoid: string[];
  cookTimeMax?: number;
  text: string;
};

export type RecipeCard = {
  id: string;
  name: string;
  dishType: DomainDishType;
  ingredients: string[];
  tags: string[];
  scenarios?: string[];
  cookTime: number;
  visibility: "official" | "public" | "private";
  familyId: number;
};

export type LastMiss = { label: string; kind: string; alternatives: string[] };
export type PendingAsk = { key: string; askedCount: number; maxAskCount: number };
export type TurnAttributes = { spicy?: boolean; doneness?: string };

export type TurnState = {
  shape: { dishes: number; soups: number };
  cardNames: string[];
  avoid: string[];
  scenarios: DomainScenario[];
  attributes: TurnAttributes;
  lastMiss: LastMiss | null;
  pendingAsk: PendingAsk | null;
  updatedAt: number;
};

export type TurnCommand = {
  kind: "meal" | "recipe" | "closest" | "ask" | "technique" | "non_food";
  shape?: { dishes: number; soups: number };
  roles?: DomainRole[];
  modifiers?: Array<{ op: "remove" | "add"; kind: string }>;
  target?: string;
  question?: string;
};

export type TurnResult = {
  status: "cards" | "ask" | "text";
  recipes: RecipeCard[];
  ai: number;
  credits: number;
  clarifyReason: "safety" | "ambiguous_food" | "library_miss" | "ingredient_miss" | "non_food" | null;
  text: string;
  command: TurnCommand;
  state: TurnState;
};

export function emptyTurnState(): TurnState {
  return {
    shape: { dishes: 0, soups: 0 },
    cardNames: [],
    avoid: [],
    scenarios: [],
    attributes: {},
    lastMiss: null,
    pendingAsk: null,
    updatedAt: 0,
  };
}
