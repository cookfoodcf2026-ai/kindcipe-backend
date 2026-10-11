/**
 * Canonical difficulty normalisation.
 *
 * The LLM / clients may send English ("easy"/"medium"/"hard"), simplified
 * Chinese, numeric or empty values. Everything is mapped to the canonical
 * Chinese stored values used across the app so the UI chips highlight and the
 * value is never empty.
 */
export type Difficulty = "簡單" | "中等" | "困難";

const MAP: Record<string, Difficulty> = {
  easy: "簡單", medium: "中等", hard: "困難",
  "簡單": "簡單", "中等": "中等", "困難": "困難",
  "简单": "簡單", "困难": "困難",
  "1": "簡單", "2": "中等", "3": "困難",
  beginner: "簡單", intermediate: "中等", advanced: "困難",
};

export function normalizeDifficulty(v: unknown): Difficulty {
  const s = String(v ?? "").trim();
  return MAP[s] ?? MAP[s.toLowerCase()] ?? "中等";
}
