/**
 * Optional Sentry integration for the backend.
 *
 * Activated only when `SENTRY_DSN` is set — otherwise every call is a no-op, so
 * local dev / un-configured deploys are unaffected.
 *
 * Privacy: we never attach request bodies or user emails. We attach only the
 * numeric user id + family id (internal identifiers) as tags.
 */
import * as Sentry from "@sentry/node";
import { ENV } from "./env";

let initialised = false;

export function initSentry(): boolean {
  if (initialised) return true;
  if (!ENV.sentryDsn) return false;
  try {
    Sentry.init({
      dsn: ENV.sentryDsn,
      environment: ENV.isProduction ? "production" : "development",
      // Errors are the priority; light tracing to keep free-tier quota.
      tracesSampleRate: ENV.isProduction ? 0.1 : 0,
      // Never auto-collect PII (user info, cookies, bodies, query params).
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
        stackFrameVariables: false,
      },
    });
    initialised = true;
    console.log("[Sentry] backend error tracking initialised");
    return true;
  } catch (e) {
    console.warn("[Sentry] init failed (non-fatal):", (e as Error).message);
    return false;
  }
}

export function captureException(
  error: unknown,
  context?: { userId?: string | number | null; familyId?: number | null; path?: string },
): void {
  if (!initialised) return;
  try {
    Sentry.withScope((scope) => {
      if (context?.userId) scope.setTag("user_id", String(context.userId));
      if (context?.familyId) scope.setTag("family_id", String(context.familyId));
      if (context?.path) scope.setTag("trpc_path", context.path);
      Sentry.captureException(error);
    });
  } catch {
    /* never throw from error reporting */
  }
}
