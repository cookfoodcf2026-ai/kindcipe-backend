/**
 * Resolve a recipe card's canonical reference from whatever shape it reached
 * the router in. Pure: no throw, no DB, no I/O.
 *
 * Only positive safe integers are accepted, so callers can never render
 * `official_0` / `user_NaN`.
 */

export interface CardRefInput {
  source?: unknown;
  id?: unknown;
  officialId?: unknown;
  customId?: unknown;
}

export interface CardRef {
  officialId?: number;
  customId?: number;
}

function toPositiveInt(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!/^[0-9]+$/.test(trimmed)) return null;
    const value = Number(trimmed);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  return null;
}

function refFor(type: unknown, id: unknown): CardRef | null {
  const value = toPositiveInt(id);
  if (value == null) return null;
  const kind = String(type ?? "").trim().toLowerCase();
  if (kind === "official") return { officialId: value };
  if (kind === "custom" || kind === "user") return { customId: value };
  return null;
}

export function toCardRef(card: CardRefInput | null | undefined): CardRef | null {
  if (!card || typeof card !== "object") return null;

  const officialId = toPositiveInt(card.officialId);
  if (officialId != null) return { officialId };
  const customId = toPositiveInt(card.customId);
  if (customId != null) return { customId };

  const id = card.id;
  if (typeof id === "string") {
    const prefixed = /^(official|user|custom)\s*[_:\-]\s*([0-9]+)$/i.exec(id.trim());
    if (prefixed) return refFor(prefixed[1], prefixed[2]);
  }

  return refFor(card.source, id);
}
