export const swapAllowReuse = (text: string): boolean => /可以重複/.test(text);

export function resolveSwapExplicitCount(params: {
  isSwapTurn: boolean;
  structuredEntry: boolean;
  askedCount: number;
  servedCount: number;
}): number {
  if (params.isSwapTurn) return Math.min(3, params.servedCount);
  return !params.structuredEntry && params.askedCount >= 2 ? Math.min(4, params.askedCount) : 1;
}
