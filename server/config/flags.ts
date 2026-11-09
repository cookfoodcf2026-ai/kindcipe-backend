/**
 * Backend feature flags.
 *
 * `RECIPE_REF_STRICT` defaults to ON: strict recipe-ref validation is the only
 * write mode. Write paths no longer branch on this flag; it is kept for
 * observability and the admin override. Unset (or empty) is treated as ON.
 *
 * Kill switch: change the env var (or set the admin override) and the next
 * call sees it — no restart and no cached value.
 */

export const RECIPE_REF_STRICT_ENV = "RECIPE_REF_STRICT";

export const KILL_SWITCH_TRIGGERS = [
  "canonical_rate < 95% for one day",
  "identity error rate > 1%",
  "daily orphan count rising for 2 consecutive days",
] as const;

let adminOverride: boolean | null = null;
let logged = false;

export function parseBoolFlag(value: string | null | undefined): boolean {
  return value === "true" || value === "1";
}

export function readRecipeRefStrict(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env[RECIPE_REF_STRICT_ENV];
  const envValue = raw === undefined || raw === "" ? true : parseBoolFlag(raw);
  return adminOverride ?? envValue;
}

export function getRecipeRefStrict(): boolean {
  const value = readRecipeRefStrict();
  if (!logged) {
    logged = true;
    console.log(`[flags] ${RECIPE_REF_STRICT_ENV}=${value ? "true" : "false"}`);
  }
  return value;
}

/** Admin override (null clears it and falls back to the env var). */
export function setRecipeRefStrictOverride(value: boolean | null): void {
  adminOverride = value;
}

export function resetRecipeRefFlagsForTests(): void {
  adminOverride = null;
  logged = false;
}

/** Logs the effective flag once at startup. */
export function logRecipeRefFlagsOnce(): void {
  getRecipeRefStrict();
}
