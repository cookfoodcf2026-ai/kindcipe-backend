import type { RequestedRole } from "./chefIntent";

export type ChefResponseStatus =
  | "cards"
  | "partial_cards"
  | "no_cards"
  | "clarify"
  | "text";

export type ChefActionId =
  | "show_last_cards"
  | "add_dessert"
  | "swap_last"
  | "restart"
  | "ai_generate";

export interface ChefCardSnapshot {
  cardId: string;
  name: string;
  nameEn?: string;
  nameFil?: string;
  nameId?: string;
  description: string;
  cookTime: number;
  servings: number;
  difficulty: string;
  recipeCategory?: string;
  dishType?: string;
  ingredients: Array<{
    name: string;
    nameEn?: string;
    nameFil?: string;
    nameId?: string;
    quantity: string;
    unit: string;
  }>;
  steps: string[];
  stepsEn?: string[];
  stepsFil?: string[];
  stepsId?: string[];
  tags: string[];
  source: "official" | "custom" | "ai";
  role: RequestedRole;
  officialId?: number;
  customId?: number;
  image?: string;
  thumbnailUrl?: string;
}

export interface ChefQuickReply {
  actionId: ChefActionId;
  labelKey: string;
}

export interface ChefReply {
  requestId: string;
  chatId?: string;
  clientMessageId?: string;
  status: ChefResponseStatus;
  recipes: ChefCardSnapshot[];
  replyText: string;
  requested: { total: number; roles: RequestedRole[] };
  served: number;
  missingRoles: RequestedRole[];
  sources: { library: number; ai: number };
  quickReplies: ChefQuickReply[];
  stateVersion?: number;
}

const CLAIM_RE = /\b(here is|here are|here you go|i found|i've found|i recommend|try this|perfect)\b|以下係|呢個就係|推介|推薦|為你推薦|我幫你搵到|為你準備|我搵到|我找到/i;

/**
 * Ship 1 contract validator. The response is valid only when its status,
 * cards, counts, missing roles, and user-visible text agree.
 */
export function validateChefReply(reply: ChefReply): string[] {
  const errors: string[] = [];
  const cards = Array.isArray(reply.recipes) ? reply.recipes : [];
  const requestedTotal = Number(reply.requested?.total ?? 0);
  const served = Number(reply.served ?? 0);
  const missingRoles = Array.isArray(reply.missingRoles) ? reply.missingRoles : [];

  if (served !== cards.length) {
    errors.push(`served (${served}) must equal recipes.length (${cards.length})`);
  }

  if (reply.status === "cards") {
    if (cards.length === 0) errors.push("cards status requires at least one recipe");
    if (requestedTotal > 0 && served !== requestedTotal) {
      errors.push(`cards status must serve all requested cards (served=${served}, requested=${requestedTotal})`);
    }
    if (missingRoles.length > 0) errors.push("cards status cannot have missingRoles");
  } else if (reply.status === "partial_cards") {
    if (cards.length === 0) errors.push("partial_cards status requires at least one recipe");
    if (served >= requestedTotal) errors.push("partial_cards status requires served < requested");
    if (missingRoles.length === 0) errors.push("partial_cards status requires missingRoles");
  } else if (reply.status === "no_cards") {
    if (cards.length > 0) errors.push("no_cards status cannot include recipes");
    if (served !== 0) errors.push("no_cards status requires served=0");
    if (requestedTotal <= 0) errors.push("no_cards status requires requested.total > 0");
    if (CLAIM_RE.test(reply.replyText)) errors.push("no_cards replyText claims a recipe; use a deterministic no-card template");
  } else if (reply.status === "clarify") {
    if (cards.length > 0) errors.push("clarify status cannot include recipes");
    if (served !== 0) errors.push("clarify status requires served=0");
    if (CLAIM_RE.test(reply.replyText)) errors.push("clarify replyText claims a recipe; use a deterministic clarify template");
  } else if (reply.status === "text") {
    if (cards.length > 0) errors.push("text status cannot include recipes");
    if (served !== 0) errors.push("text status requires served=0");
  } else {
    errors.push(`invalid status: ${String((reply as { status?: unknown }).status)}`);
  }

  if (reply.status === "cards" || reply.status === "partial_cards") {
    const sourceTotal = Number(reply.sources?.library ?? 0) + Number(reply.sources?.ai ?? 0);
    if (sourceTotal !== cards.length) {
      errors.push(`sources total (${sourceTotal}) must equal recipes.length (${cards.length})`);
    }
  }

  return errors;
}
