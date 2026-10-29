import type { DomainScenario, LastMiss, PendingAsk, TurnAttributes, TurnState } from "./types";
import { emptyTurnState } from "./types";

export function cloneState(state: TurnState = emptyTurnState()): TurnState {
  return {
    shape: { ...state.shape },
    cardNames: [...state.cardNames],
    avoid: [...state.avoid],
    scenarios: [...state.scenarios],
    attributes: { ...state.attributes },
    lastMiss: state.lastMiss ? { ...state.lastMiss, alternatives: [...state.lastMiss.alternatives] } : null,
    pendingAsk: state.pendingAsk ? { ...state.pendingAsk } : null,
    updatedAt: state.updatedAt,
  };
}

export function withMeal(
  state: TurnState,
  shape: { dishes: number; soups: number },
  cards: string[],
  extra: { avoid?: string[]; scenarios?: DomainScenario[]; attributes?: TurnAttributes } = {},
): TurnState {
  return {
    ...cloneState(state),
    shape,
    cardNames: cards,
    avoid: extra.avoid ?? state.avoid,
    scenarios: extra.scenarios ?? state.scenarios,
    attributes: extra.attributes ?? state.attributes,
    lastMiss: null,
    pendingAsk: null,
    updatedAt: Date.now(),
  };
}

export function withMiss(state: TurnState, miss: LastMiss | null): TurnState {
  return { ...cloneState(state), lastMiss: miss, updatedAt: Date.now() };
}

export function withAsk(state: TurnState, key: string): TurnState {
  const count = state.pendingAsk?.key === key ? state.pendingAsk.askedCount + 1 : 1;
  const pendingAsk: PendingAsk = { key, askedCount: count, maxAskCount: 1 };
  return { ...cloneState(state), pendingAsk, updatedAt: Date.now() };
}

export function clearAsk(state: TurnState): TurnState {
  return { ...cloneState(state), pendingAsk: null, updatedAt: Date.now() };
}
