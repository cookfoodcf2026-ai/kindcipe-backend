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
      // Capture errors thrown in Express route handlers/middleware automatically
      // (Sentry v11 uses the integration channel, not a manual error handler).
      integrations: [Sentry.expressIntegration()],
      // Privacy: strip request body / cookies / sensitive headers before send.
      // NOTE: do NOT use `dataCollection` here — on @sentry/node v11 it silently
      // dropped error events, which broke ingestion entirely.
      beforeSend(event) {
        try {
          if (event.request) {
            delete (event.request as any).data;
            delete (event.request as any).cookies;
            delete (event.request as any).query_string;
            const headers = (event.request as any).headers;
            if (headers) {
              for (const k of ["authorization", "cookie", "x-family-id"]) {
                if (headers[k]) delete headers[k];
              }
            }
          }
        } catch {
          /* never block the event */
        }
        return event;
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

/**
 * Flush pending events before the process exits (Railway restarts/redeploys).
 * Returns a promise that resolves once the queue is drained (or times out).
 */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!initialised) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    /* noop */
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
