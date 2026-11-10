/**
 * Single source of truth for monthly ledger keys ("YYYY-MM", UTC).
 *
 * Every monthly quota/ledger (usage, llm cost, recipe quota) must use this
 * helper so a row written by one subsystem is visible to every reader.
 */
export function getYearMonthKey(date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}
