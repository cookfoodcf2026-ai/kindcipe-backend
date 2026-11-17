/**
 * Pure, deterministic card selector (logic v3, step 2B).
 *
 * No DB, no network, no mutation of the caller's constraints/pool. This module
 * is intentionally standalone: it is first wired in as a shadow compare behind
 * `AI_CHEF_SELECTOR_V2` (default OFF) and never changes the response.
 */

import { appendFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

export const SELECTOR_TOP_K = 20;
export const SELECTOR_TEMPERATURE = 0.35;
export const SELECTOR_EXPLORE_EVERY = 8;
export const SELECTOR_SEEN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type SeenEntry = {
  count?: number;
  lastSeenAt?: number | string | Date | null;
};

export type SelectorPoolCard = {
  id?: number | string | null;
  name: string;
  category?: string | null;
  dishType?: string | null;
  steps?: unknown[] | null;
  hasMedia?: boolean | null;
  image?: string | null;
  thumbnailUrl?: string | null;
  cookTime?: number | string | null;
  difficulty?: string | null;
  language?: string | null;
  tags?: string[] | null;
  useCount?: number | null;
  popularity?: number | null;
};

/**
 * `constraints` is passed as one object and never cloned/rebuilt. The selector
 * only reads it, which keeps the reference stable for shadow verification.
 */
export type SelectorConstraints = {
  category?: string | null;
  maxCookTime?: number | null;
  /** Maximum difficulty: easy < medium < hard. */
  difficulty?: string | null;
  language?: string | null;
  combo?: { mains: number; soups: number } | null;
};

export type SelectorInput = {
  pool: SelectorPoolCard[];
  n: number;
  constraints: SelectorConstraints;
  excludeIds?: Array<number | string>;
  seenIndex?: Record<string, SeenEntry>;
  now?: number | Date;
  seed?: number;
  /** 1-based draw counter. Every 8th draw spends the explore quota. */
  drawIndex?: number;
};

export type ScoreRow = {
  id: string;
  name: string;
  category: string | null;
  base: number;
  pop: number;
  media: number;
  jitter: number;
  seen: number;
  raw: number;
};

export type SelectorResult = {
  cards: SelectorPoolCard[];
  reason: "ok" | "exhausted";
  scores: ScoreRow[];
  seedUsed: number;
  poolSize: number;
  afterHard: number;
  countAfterStep1: number;
  countAfterStep2: number;
  countAfterStep3: number;
  countAfterStep4: number;
  countAfterStep5: number;
  explore: boolean;
};

const DIFFICULTY_RANK: Record<string, number> = { easy: 0, medium: 1, hard: 2 };

function norm(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function cardId(card: SelectorPoolCard): string {
  const id = card.id;
  if (id !== undefined && id !== null && String(id).trim()) return String(id);
  return card.name;
}

function categoryOf(card: SelectorPoolCard): string | null {
  const value = norm(card.category ?? card.dishType);
  return value ? value : null;
}

function hasMedia(card: SelectorPoolCard): boolean {
  if (typeof card.hasMedia === "boolean") return card.hasMedia;
  return Boolean(card.image || card.thumbnailUrl);
}

function useCount(card: SelectorPoolCard): number {
  const raw = Number(card.useCount ?? card.popularity ?? 0);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function cookTimeOf(card: SelectorPoolCard): number {
  const raw = Number(card.cookTime ?? 0);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function nowMs(value: number | Date | undefined): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return Date.now();
}

function seenEntryFor(card: SelectorPoolCard, index: Record<string, SeenEntry>): SeenEntry | undefined {
  const keys = [cardId(card), String(card.id ?? ""), card.name, norm(card.name)].filter(Boolean);
  for (const key of keys) {
    const hit = index[key] ?? index[norm(key)];
    if (hit) return hit;
  }
  return undefined;
}

function lastSeenMs(entry: SeenEntry | undefined): number {
  if (!entry) return Number.NEGATIVE_INFINITY;
  const value = entry.lastSeenAt;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.NEGATIVE_INFINITY;
}

function seenPenalty(card: SelectorPoolCard, index: Record<string, SeenEntry>, now: number): number {
  const entry = seenEntryFor(card, index);
  if (!entry) return 0;
  const seenAt = lastSeenMs(entry);
  if (Number.isFinite(seenAt) && now - seenAt > SELECTOR_SEEN_WINDOW_MS) return 0;
  const count = Number(entry.count ?? 0);
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.min(1, count / 3);
}

/** FNV-1a over stable parts; mirrored by tests via the same public function. */
export function hashSeed(parts: Array<string | number>): number {
  let hash = 2166136261 >>> 0;
  for (const part of parts) {
    const text = String(part);
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    hash ^= 0x1f;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function constraintsHash(constraints: SelectorConstraints): string {
  const combo = constraints.combo
    ? `${constraints.combo.mains}/${constraints.combo.soups}`
    : "none";
  return [
    norm(constraints.category) || "any",
    constraints.maxCookTime ?? "any",
    norm(constraints.difficulty) || "any",
    norm(constraints.language) || "any",
    combo,
  ].join("|");
}

function excludedHash(excludeIds: Array<number | string>): string {
  return excludeIds.map((id) => norm(id)).sort().join(",");
}

/** seeded inverse-CDF without replacement; `exp` values are static per draw. */
function sampleWithoutReplacement(
  rows: ScoreRow[],
  count: number,
  rng: () => number,
): ScoreRow[] {
  const remaining = [...rows];
  const picked: ScoreRow[] = [];
  // All score components (pop/media/seen) are already min-max normalised to
  // [0,1] in scorePool(). Keep the raw combined score on the same [0,1] scale
  // and let T=0.35 act as the temperature; rescaling the combined score to
  // [0,1] again would make the distribution 17x sharper and starve the tail.
  const max = Math.max(...remaining.map((row) => row.raw));
  const weights = new Map<string, number>();
  for (const row of remaining) {
    weights.set(row.id, Math.exp((row.raw - max) / SELECTOR_TEMPERATURE));
  }
  while (picked.length < count && remaining.length > 0) {
    let total = 0;
    for (const row of remaining) total += weights.get(row.id) ?? 0;
    let roll = rng() * total;
    let chosenIndex = remaining.length - 1;
    for (let i = 0; i < remaining.length; i++) {
      roll -= weights.get(remaining[i]!.id) ?? 0;
      if (roll <= 0) {
        chosenIndex = i;
        break;
      }
    }
    const [chosen] = remaining.splice(chosenIndex, 1);
    if (chosen) picked.push(chosen);
  }
  return picked;
}

function explorePick(
  rows: ScoreRow[],
  index: Record<string, SeenEntry>,
  rng: () => number,
): ScoreRow | null {
  if (rows.length === 0) return null;
  const scored = rows.map((row) => {
    const entry = index[row.id] ?? index[norm(row.name)];
    return {
      row,
      count: entry ? Number(entry.count ?? 0) || 0 : -1,
      lastSeen: lastSeenMs(entry),
      tie: rng(),
    };
  });
  scored.sort((a, b) => {
    if (a.count !== b.count) return a.count - b.count;
    if (a.lastSeen !== b.lastSeen) return a.lastSeen - b.lastSeen;
    if (a.tie !== b.tie) return a.tie - b.tie;
    return String(a.row.id).localeCompare(String(b.row.id));
  });
  return scored[0]?.row ?? null;
}

function applyHardFilters(input: SelectorInput): {
  afterHard: SelectorPoolCard[];
  counts: [number, number, number, number, number];
  comboOk: boolean;
} {
  const constraints = input.constraints;
  // Step 1: dedupe by id, keep the first occurrence.
  const seenIds = new Set<string>();
  const step1: SelectorPoolCard[] = [];
  for (const card of input.pool ?? []) {
    if (!card || !String(card.name ?? "").trim()) continue;
    const id = cardId(card);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    step1.push(card);
  }

  // Step 2: excludeIds (current card + other dishes on the table).
  const excluded = new Set((input.excludeIds ?? []).map((id) => norm(id)));
  const step2 = step1.filter((card) => {
    const keys = [cardId(card), String(card.id ?? ""), card.name, norm(card.name)];
    return !keys.some((key) => key && excluded.has(norm(key)));
  });

  // Step 3: category -> cook time -> difficulty -> language.
  const wantedCategory = norm(constraints.category);
  const categoryActive = Boolean(wantedCategory && wantedCategory !== "any" && wantedCategory !== "meal");
  const difficultyMax = DIFFICULTY_RANK[norm(constraints.difficulty)];
  const language = norm(constraints.language);
  const step3 = step2.filter((card) => {
    if (categoryActive && categoryOf(card) !== wantedCategory) return false;
    const maxCookTime = Number(constraints.maxCookTime);
    if (Number.isFinite(maxCookTime) && maxCookTime > 0 && cookTimeOf(card) > maxCookTime) return false;
    if (difficultyMax !== undefined) {
      const rank = DIFFICULTY_RANK[norm(card.difficulty)];
      if (rank !== undefined && rank > difficultyMax) return false;
    }
    const cardLanguage = norm(card.language);
    if (language && cardLanguage && cardLanguage !== language) return false;
    return true;
  });

  // Step 4: missing steps / hasMedia are NOT hard violations; they only score.
  const step4 = step3;

  // Step 5: combo-level check (3 mains + 1 soup by default).
  let comboOk = true;
  if (constraints.combo) {
    const needMains = Math.max(0, Number(constraints.combo.mains) || 0);
    const needSoups = Math.max(0, Number(constraints.combo.soups) || 0);
    const soups = step4.filter((card) => categoryOf(card) === "soup").length;
    const mains = step4.length - soups;
    comboOk = soups >= needSoups && mains >= needMains;
  }

  return {
    afterHard: step4,
    counts: [step1.length, step2.length, step3.length, step4.length, comboOk ? step4.length : 0],
    comboOk,
  };
}

/**
 * Score every surviving card. Missing steps/media deliberately still score;
 * they are never removed by the hard filter.
 */
function scorePool(
  cards: SelectorPoolCard[],
  index: Record<string, SeenEntry>,
  now: number,
  rng: () => number,
): ScoreRow[] {
  const maxUse = Math.max(0, ...cards.map(useCount));
  const logMax = Math.log1p(maxUse);
  return cards.map((card) => {
    const use = useCount(card);
    const pop = logMax > 0 ? Math.log1p(use) / logMax : 0;
    const media = hasMedia(card) ? 1 : 0;
    const jitter = rng();
    const seen = seenPenalty(card, index, now);
    const base = 0.5;
    const raw = 0.5 * base + 0.2 * pop + 0.1 * media + 0.1 * jitter - 0.2 * seen;
    return {
      id: cardId(card),
      name: card.name,
      category: categoryOf(card),
      base,
      pop,
      media,
      jitter,
      seen,
      raw,
    };
  });
}

/** Pure selector. Never mutates `input` or `input.constraints`. */
export function selectCards(input: SelectorInput): SelectorResult {
  const now = nowMs(input.now);
  const pool = Array.isArray(input.pool) ? input.pool : [];
  const seenIndex = input.seenIndex ?? {};
  const drawIndex = Number(input.drawIndex);
  const firedDraw = Number.isFinite(drawIndex) ? drawIndex : 0;
  const seedBase = input.seed !== undefined && Number.isFinite(Number(input.seed))
    ? Number(input.seed) >>> 0
    : hashSeed([
      now,
      constraintsHash(input.constraints),
      excludedHash(input.excludeIds ?? []),
      pool.length,
      firedDraw,
    ]);
  const explore = firedDraw > 0
    ? firedDraw % SELECTOR_EXPLORE_EVERY === 0
    : seedBase % SELECTOR_EXPLORE_EVERY === 0;

  const { afterHard, counts, comboOk } = applyHardFilters(input);
  const poolSize = pool.length;

  if (afterHard.length === 0 || !comboOk) {
    return {
      cards: [],
      reason: "exhausted",
      scores: [],
      seedUsed: seedBase,
      poolSize,
      afterHard: afterHard.length,
      countAfterStep1: counts[0],
      countAfterStep2: counts[1],
      countAfterStep3: counts[2],
      countAfterStep4: counts[3],
      countAfterStep5: counts[4],
      explore,
    };
  }

  const rng = makeRng(seedBase);
  const scored = scorePool(afterHard, seenIndex, now, rng)
    .sort((a, b) => b.raw - a.raw || a.id.localeCompare(b.id));

  const topK = scored.slice(0, SELECTOR_TOP_K);
  const byId = new Map(afterHard.map((card) => [cardId(card), card]));
  const wanted = Math.max(0, Math.floor(Number(input.n) || 0));
  const combo = input.constraints.combo;

  let pickedRows: ScoreRow[] = [];
  if (combo) {
    const needSoups = Math.max(0, Number(combo.soups) || 0);
    const needMains = Math.max(0, Number(combo.mains) || 0);
    const soups = topK.filter((row) => row.category === "soup");
    const mains = topK.filter((row) => row.category !== "soup");
    // Combo needs exact roles; fall back to the full eligible slice if top-k
    // starved one role (e.g. a small soup pool).
    const soupRows = soups.length >= needSoups ? soups : scored.filter((row) => row.category === "soup");
    const mainRows = mains.length >= needMains ? mains : scored.filter((row) => row.category !== "soup");
    let firstMains: ScoreRow[] = [];
    if (needMains > 0) {
      const forced = explore ? explorePick(mainRows, seenIndex, rng) : null;
      if (forced) {
        firstMains = [forced, ...sampleWithoutReplacement(
          mainRows.filter((row) => row.id !== forced.id),
          Math.max(0, needMains - 1),
          rng,
        )];
      } else {
        firstMains = sampleWithoutReplacement(mainRows, needMains, rng);
      }
    }
    const used = new Set(firstMains.map((row) => row.id));
    const freshSoups = soupRows.filter((row) => !used.has(row.id));
    let firstSoups: ScoreRow[] = [];
    if (needSoups > 0) {
      const forced = explore && firstMains.length === 0 ? explorePick(freshSoups, seenIndex, rng) : null;
      if (forced) {
        firstSoups = [forced, ...sampleWithoutReplacement(
          freshSoups.filter((row) => row.id !== forced.id),
          Math.max(0, needSoups - 1),
          rng,
        )];
      } else {
        firstSoups = sampleWithoutReplacement(freshSoups, needSoups, rng);
      }
    }
    pickedRows = [...firstMains, ...firstSoups];
  } else {
    const target = wanted;
    if (explore && target > 0) {
      // Explore from every eligible card, not just top-k, otherwise the tail
      // being protected by the coverage quota could never be forced in.
      const forced = explorePick(scored, seenIndex, rng);
      if (forced) {
        pickedRows.push(forced);
        const rest = topK.filter((row) => row.id !== forced.id);
        pickedRows.push(...sampleWithoutReplacement(rest, Math.max(0, target - 1), rng));
      } else {
        pickedRows = sampleWithoutReplacement(topK, target, rng);
      }
    } else {
      pickedRows = sampleWithoutReplacement(topK, target, rng);
    }
  }

  const cards = pickedRows
    .map((row) => byId.get(row.id))
    .filter((card): card is SelectorPoolCard => Boolean(card));

  if (isTraceEnabled("select")) {
    const perTypePicked: Record<string, number> = {};
    for (const card of cards) {
      const category = categoryOf(card) ?? "unknown";
      perTypePicked[category] = (perTypePicked[category] ?? 0) + 1;
    }
    console.log(`[AI Chef][select] K=${SELECTOR_TOP_K} pool=${poolSize} afterHard=${afterHard.length} picked=${cards.length} perTypePicked=${JSON.stringify(perTypePicked)} degraded=${afterHard.length < poolSize || cards.length < wanted} cache=na`);
  }

  return {
    cards,
    reason: "ok",
    scores: scored,
    seedUsed: seedBase,
    poolSize,
    afterHard: afterHard.length,
    countAfterStep1: counts[0],
    countAfterStep2: counts[1],
    countAfterStep3: counts[2],
    countAfterStep4: counts[3],
    countAfterStep5: counts[4],
    explore,
  };
}

// ─── Trace gate (AI_CHEF_TRACE, default OFF) ───────────────────────────────
// off (default) = no output; pool = only library-pool lines; select = only
// selector-decision lines; all = both. Read at call time so tests/ops can flip
// it without a rebuild. Logs carry ids/hashes/numbers only (no names/steps).
export type TraceScope = "pool" | "select";

export function isTraceEnabled(scope: TraceScope): boolean {
  try {
    const raw = String(process.env.AI_CHEF_TRACE ?? "").trim().toLowerCase();
    if (!raw || raw === "off" || raw === "0" || raw === "false") return false;
    if (raw === "all" || raw === "1" || raw === "true") return true;
    return raw.split(",").map((part) => part.trim()).includes(scope);
  } catch {
    return false;
  }
}

// ─── Shadow compare (flag AI_CHEF_SELECTOR_V2, default OFF) ────────────────

export const SHADOW_MAX_LINES = 5000;
export const SHADOW_MAX_BYTES = 5 * 1024 * 1024;
// Measurement period is 100%: no decision may be silently skipped while the
// shadow flag is ON. AI_CHEF_SELECTOR_SHADOW_SAMPLE can still lower it.
export const SHADOW_DEFAULT_SAMPLE = 1;

type ShadowLogState = {
  bytes: number;
  lines: number;
  capped: boolean;
};

const shadowLogStates = new Map<string, ShadowLogState>();

export function isSelectorShadowEnabled(): boolean {
  try {
    const value = process.env.AI_CHEF_SELECTOR_V2;
    return value === "1" || value === "true";
  } catch {
    return false;
  }
}

function shadowSampleRate(): number {
  try {
    const raw = Number(process.env.AI_CHEF_SELECTOR_SHADOW_SAMPLE);
    if (!Number.isFinite(raw)) return SHADOW_DEFAULT_SAMPLE;
    return Math.min(1, Math.max(0, raw));
  } catch {
    return SHADOW_DEFAULT_SAMPLE;
  }
}

function shadowLogPath(explicit?: string): string {
  return explicit || process.env.AI_CHEF_SELECTOR_SHADOW_LOG || join(process.cwd(), "logs", "selector-shadow.jsonl");
}

function getShadowLogState(file: string): ShadowLogState {
  const cached = shadowLogStates.get(file);
  if (cached) return cached;
  const state: ShadowLogState = { bytes: 0, lines: 0, capped: false };
  try {
    const stat = statSync(file);
    state.bytes = stat.size;
    if (stat.size > 0) {
      const content = readFileSync(file, "utf8");
      let lines = 0;
      for (let i = 0; i < content.length; i++) {
        if (content.charCodeAt(i) === 10) lines += 1;
      }
      state.lines = lines;
    }
  } catch {
    state.bytes = 0;
    state.lines = 0;
  }
  state.capped = state.bytes >= SHADOW_MAX_BYTES || state.lines >= SHADOW_MAX_LINES;
  shadowLogStates.set(file, state);
  return state;
}

/** Synchronous append with a hard line/byte cap. Never throws. */
function appendShadowLogLine(file: string, line: string): boolean {
  try {
    const state = getShadowLogState(file);
    if (state.capped) return false;
    const payload = `${line}\n`;
    const size = Buffer.byteLength(payload, "utf8");
    if (state.lines >= SHADOW_MAX_LINES || state.bytes + size > SHADOW_MAX_BYTES) {
      state.capped = true;
      return false;
    }
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, payload, "utf8");
    state.lines += 1;
    state.bytes += size;
    return true;
  } catch {
    return false;
  }
}

function requestIdHash(requestId: string | undefined): string | null {
  if (!requestId) return null;
  try {
    return hashSeed([requestId]).toString(16);
  } catch {
    return null;
  }
}

function shouldSampleShadow(params: ShadowCompareParams): boolean {
  try {
    const rate = shadowSampleRate();
    if (rate >= 1) return true;
    if (rate <= 0) return false;
    const bucket = hashSeed([
      params.requestId ?? "",
      params.path,
      params.drawIndex ?? "",
      params.seed ?? "",
    ]) / 4294967296;
    return bucket < rate;
  } catch {
    return false;
  }
}

export type ShadowCompareParams = {
  requestId?: string;
  path: string;
  pool: SelectorPoolCard[];
  n: number;
  constraints: SelectorConstraints;
  excludeIds?: Array<number | string>;
  seenIndex?: Record<string, SeenEntry>;
  now?: number | Date;
  seed?: number;
  drawIndex?: number;
  legacyPickedIds: Array<number | string>;
  logFile?: string;
};

/**
 * Run the new selector for observation only. Never returns anything the caller
 * is allowed to serve; the response keeps using the legacy picked cards.
 * Flag OFF: returns before doing any work or writing any log line.
 * No user id/email/recipe steps are logged; only a hashed request id is kept.
 */
export function shadowCompareSelector(params: ShadowCompareParams): SelectorResult | null {
  try {
    if (!isSelectorShadowEnabled()) return null;
    if (!shouldSampleShadow(params)) return null;
    const startedAt = Date.now();
    const result = selectCards({
      pool: params.pool,
      n: params.n,
      constraints: params.constraints,
      excludeIds: params.excludeIds,
      seenIndex: params.seenIndex,
      now: params.now,
      seed: params.seed,
      drawIndex: params.drawIndex,
    });
    const legacyIds = (params.legacyPickedIds ?? []).map((id) => String(id));
    const newIds = result.cards.map((card) => cardId(card));
    const legacySet = new Set(legacyIds);
    const overlap = newIds.filter((id) => legacySet.has(id)).length;
    const line = {
      ts: new Date().toISOString(),
      requestIdHash: requestIdHash(params.requestId),
      path: params.path,
      seedUsed: result.seedUsed,
      poolSize: result.poolSize,
      afterHard: result.afterHard,
      picked: newIds.length,
      legacyPicked: legacyIds.length,
      overlap,
      countAfterStep1: result.countAfterStep1,
      countAfterStep2: result.countAfterStep2,
      countAfterStep3: result.countAfterStep3,
      countAfterStep4: result.countAfterStep4,
      countAfterStep5: result.countAfterStep5,
      excludedIdsCount: (params.excludeIds ?? []).length,
      topK: SELECTOR_TOP_K,
      T: SELECTOR_TEMPERATURE,
      reason: result.reason,
      elapsedMs: Date.now() - startedAt,
      legacyPickedIds: legacyIds,
      newPickedIds: newIds,
      overlapRatio: legacyIds.length === 0 ? 0 : Number((overlap / legacyIds.length).toFixed(4)),
      distinctRatio: newIds.length === 0 ? 0 : Number((new Set(newIds).size / newIds.length).toFixed(4)),
    };
    appendShadowLogLine(shadowLogPath(params.logFile), JSON.stringify(line));
    return result;
  } catch (error) {
    try {
      console.warn("[selector-shadow] compare failed (response unaffected):", (error as Error)?.message);
    } catch {
      // never let the shadow path affect the response
    }
    return null;
  }
}
