import { randomUUID } from "node:crypto";
import {
  buildImportWarning,
  computeParseToken,
  mergeInferredIngredients,
  partitionIngredients,
  type ImportWarning,
  type WarningIngredient,
} from "./importWarning";

export const PARSE_TOKEN_TTL_MS = 30 * 60 * 1000;
export const PARSE_TOKEN_MAX_ENTRIES = 5000;

export interface ParseTokenEntry {
  grounded: WarningIngredient[];
  inferred: WarningIngredient[];
  hash: string;
  createdAt: number;
}

const tokens = new Map<string, ParseTokenEntry>();

function cloneIngredients(list: WarningIngredient[]): WarningIngredient[] {
  return list.map((ingredient) => ({ ...ingredient }));
}

function purgeExpired(now: number): void {
  for (const [token, entry] of tokens) {
    if (now - entry.createdAt > PARSE_TOKEN_TTL_MS) tokens.delete(token);
  }
}

function enforceCap(): void {
  while (tokens.size >= PARSE_TOKEN_MAX_ENTRIES) {
    const oldest = tokens.keys().next().value;
    if (!oldest) break;
    tokens.delete(oldest);
  }
}

export function issueParseToken(
  grounded: WarningIngredient[] | null | undefined,
  inferred: WarningIngredient[] | null | undefined,
  now = Date.now(),
): string {
  purgeExpired(now);
  enforceCap();

  const groundedList = Array.isArray(grounded) ? grounded : [];
  const inferredList = Array.isArray(inferred) ? inferred : [];
  const token = randomUUID();

  tokens.set(token, {
    grounded: cloneIngredients(groundedList),
    inferred: cloneIngredients(inferredList),
    hash: computeParseToken(groundedList, inferredList),
    createdAt: now,
  });

  return token;
}

export function consumeParseToken(token: string, now = Date.now()): ParseTokenEntry | null {
  purgeExpired(now);
  const entry = tokens.get(token);
  if (!entry) return null;
  tokens.delete(token);
  if (now - entry.createdAt > PARSE_TOKEN_TTL_MS) return null;
  return entry;
}

export function clearParseTokensForTest(): void {
  tokens.clear();
}

export function parseTokenStoreSizeForTest(): number {
  return tokens.size;
}

export interface ApplyParseGroundingResult {
  ingredients: WarningIngredient[];
  importWarning?: ImportWarning;
  parseToken?: string;
}

export function applyParseGrounding(
  ingredients: WarningIngredient[] | null | undefined,
  sourceText: string,
  name: string,
  options: { enabled?: boolean; now?: number } = {},
): ApplyParseGroundingResult {
  const list = Array.isArray(ingredients) ? ingredients : [];
  if (options.enabled === false) return { ingredients: list };

  const partitioned = partitionIngredients(list, sourceText, name);
  const warning = buildImportWarning(list, sourceText, name);
  if (!warning) return { ingredients: partitioned.grounded };

  const parseToken = issueParseToken(
    partitioned.grounded,
    warning.inferredIngredients,
    options.now,
  );

  return {
    ingredients: partitioned.grounded,
    importWarning: warning,
    parseToken,
  };
}

export type ImportTokenStatus = "ignored" | "miss" | "mismatch" | "ok";

export interface ResolveImportIngredientsResult {
  ingredients: WarningIngredient[];
  inferredAdded: number;
  conflicts: number;
  droppedOverCap: number;
  tokenStatus: ImportTokenStatus;
  addAiTag: boolean;
}

export function resolveImportIngredients(
  groundedIngredients: WarningIngredient[] | null | undefined,
  options: {
    ackWarning?: boolean;
    parseToken?: string;
    inferredIngredients?: WarningIngredient[];
    now?: number;
  } = {},
): ResolveImportIngredientsResult {
  const grounded = Array.isArray(groundedIngredients) ? groundedIngredients : [];
  if (options.ackWarning !== true) {
    return {
      ingredients: grounded,
      inferredAdded: 0,
      conflicts: 0,
      droppedOverCap: 0,
      tokenStatus: "ignored",
      addAiTag: false,
    };
  }

  const entry = options.parseToken
    ? consumeParseToken(options.parseToken, options.now)
    : null;
  if (!entry) {
    return {
      ingredients: grounded,
      inferredAdded: 0,
      conflicts: 0,
      droppedOverCap: 0,
      tokenStatus: "miss",
      addAiTag: false,
    };
  }

  if (entry.hash !== computeParseToken(entry.grounded, entry.inferred)) {
    return {
      ingredients: grounded,
      inferredAdded: 0,
      conflicts: 0,
      droppedOverCap: 0,
      tokenStatus: "mismatch",
      addAiTag: false,
    };
  }

  const inferred = Array.isArray(options.inferredIngredients)
    ? options.inferredIngredients
    : entry.inferred;

  if (computeParseToken(grounded, inferred) !== entry.hash) {
    return {
      ingredients: grounded,
      inferredAdded: 0,
      conflicts: 0,
      droppedOverCap: 0,
      tokenStatus: "mismatch",
      addAiTag: false,
    };
  }

  const merged = mergeInferredIngredients(grounded, inferred);
  return {
    ingredients: merged.ingredients,
    inferredAdded: merged.addedInferred,
    conflicts: merged.conflicts,
    droppedOverCap: merged.droppedOverCap,
    tokenStatus: "ok",
    addAiTag: merged.addedInferred > 0,
  };
}
