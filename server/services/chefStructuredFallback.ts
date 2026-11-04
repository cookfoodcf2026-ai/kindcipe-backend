type FallbackRow = Record<string, unknown>;

export type StructuredFallbackSearch = {
  cookTimeMax?: number;
  scenario?: string;
};

export type IncompleteSetFallback = {
  content: string;
  recipes: never[];
  llmUsed: boolean;
  clarifyReason: "incomplete_set";
};

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Fallback pool filter for a structured library search that returned 0 rows.
 * Keeps the request's cookTimeMax and scenario constraints instead of padding
 * with unrelated library cards.
 */
export function filterStructuredFallbackRows(
  rows: FallbackRow[],
  search: StructuredFallbackSearch,
): FallbackRow[] {
  const cookTimeMax = search.cookTimeMax;
  const timeFilteredRows = typeof cookTimeMax === "number" && cookTimeMax > 0
    ? rows.filter((row) => {
        const raw = row.cookTime;
        if (raw === null || raw === undefined || raw === "") return false;
        const cookTime = Number(raw);
        return Number.isFinite(cookTime) && cookTime <= cookTimeMax;
      })
    : rows;
  const scenarioKey = String(search.scenario ?? "").trim();
  if (!scenarioKey) return timeFilteredRows;
  return timeFilteredRows.filter((row) => {
    const tags = [
      ...parseJsonArray(row.scenarioTagsUser),
      ...parseJsonArray(row.scenarioTags),
    ].map(String);
    return tags.includes(scenarioKey);
  });
}

/** Fail closed: 0 matching cards means 0 cards and 0 credits. */
export function buildIncompleteSetFallback(lang: string, llmUsed: boolean): IncompleteSetFallback {
  return {
    content: lang === "en"
      ? "I couldn't find matching recipes this time, so this request was not charged. Please try again or loosen the filters."
      : "今次搵唔到符合條件嘅食譜，所以呢次**唔會扣你額度**。可以再試一次，或者放寬限制。",
    recipes: [],
    llmUsed,
    clarifyReason: "incomplete_set",
  };
}
