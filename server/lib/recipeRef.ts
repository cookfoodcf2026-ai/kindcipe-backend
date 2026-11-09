/**
 * Canonical recipe reference parser.
 *
 * Single source of truth for the backend. The only accepted on-the-wire form
 * is `official_<n>` / `user_<n>`. Legacy colon refs (`official:123`) are only
 * normalised by read-time repair; all write paths pass `strict: true`.
 *
 * Pure: no throw, no DB, no I/O.
 */

export type RecipeRefType = "official" | "user";

export interface RecipeRef {
  type: RecipeRefType;
  id: number;
}

export interface ParseRecipeRefOptions {
  /** When true, legacy colon refs are rejected instead of normalised. */
  strict?: boolean;
  /** Called once when a legacy colon ref is normalised. */
  onLegacy?: (input: { raw: unknown; ref: RecipeRef }) => void;
}

const CANONICAL_RE = /^(official|user)_([1-9][0-9]*)$/;
const LEGACY_RE = /^(official|user):([1-9][0-9]*)$/;

function toRef(type: RecipeRefType, digits: string): RecipeRef | null {
  const id = Number(digits);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return { type, id };
}

export function parseRecipeRef(raw: unknown, options: ParseRecipeRefOptions = {}): RecipeRef | null {
  if (typeof raw !== "string") return null;

  const canonical = CANONICAL_RE.exec(raw);
  if (canonical) return toRef(canonical[1] as RecipeRefType, canonical[2]);

  const legacy = LEGACY_RE.exec(raw);
  if (legacy) {
    if (options.strict) return null;
    const ref = toRef(legacy[1] as RecipeRefType, legacy[2]);
    if (!ref) return null;
    options.onLegacy?.({ raw, ref });
    return ref;
  }

  return null;
}

export function formatRecipeRef(ref: RecipeRef): string {
  return `${ref.type}_${ref.id}`;
}

export function isRecipeRef(raw: unknown, options: ParseRecipeRefOptions = {}): boolean {
  return parseRecipeRef(raw, options) !== null;
}

export function isCanonicalRecipeRef(raw: unknown): boolean {
  return typeof raw === "string" && CANONICAL_RE.test(raw) && parseRecipeRef(raw) !== null;
}

/** Returns the canonical string, or null when the input is not a valid ref. */
export function canonicalizeRecipeRef(raw: unknown, options: ParseRecipeRefOptions = {}): string | null {
  const ref = parseRecipeRef(raw, options);
  return ref ? formatRecipeRef(ref) : null;
}
