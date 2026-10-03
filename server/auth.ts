/**
 * Social Auth Routes
 * Handles Google OAuth and Apple Sign In token verification,
 * then issues a session cookie — same as the Manus OAuth flow.
 *
 * Endpoints:
 *   POST /api/auth/google   { idToken: string }
 *   POST /api/auth/apple    { idToken: string, name?: string }
 */
import type { Express, Request, Response } from "express";
import { nanoid } from "nanoid";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import * as db from "./db";
import { resolveUserForIdentity } from "./auth-identities";
import { ENV } from "./_core/env";
import { sdk } from "./_core/sdk";
import { getSessionCookieOptions } from "./_core/cookies";

// ─── Display name fallback ────────────────────────────────────────────────────
// Apple Sign-In uses a Private Relay email (xxxx@privaterelay.appleid.com) when
// the user hides their real email. The local-part is a random string, so using
// it as a display name shows "garbled" text. Prefer a stable, friendly label.
function fallbackName(email: string, provider: "google" | "apple"): string {
  const local = (email || "").split("@")[0]?.trim();
  if (!local) return provider === "apple" ? "Apple 用戶" : "Google 用戶";
  if (/privaterelay\.appleid\.com/i.test(email)) return "Apple 用戶";
  if (/^[a-z0-9]{8,12}$/i.test(local) && !/^(test|user|mavis|seed)/i.test(local)) {
    return provider === "apple" ? "Apple 用戶" : "Google 用戶";
  }
  return local;
}

// ─── Google Token Verification ───────────────────────────────────────────────
// We verify Google ID tokens by calling Google's tokeninfo endpoint.
// Validates that the token was issued for our app (aud check).
const GOOGLE_CLIENT_IDS = [
  "690207937492-7hfs5hkksd5heo78kcfmq294f19rgp6d.apps.googleusercontent.com", // Web Client
  "690207937492-epsg13ch62s93cmav0nkfieeeoq6r3db.apps.googleusercontent.com", // iOS Client
  "690207937492-kon293ihsbjd6hqi56lg47n7td5c7eme.apps.googleusercontent.com", // Android Client
];

// Apple ID tokens carry the iOS bundle identifier in their "aud" claim.
// Must match "ios.bundleIdentifier" in the Expo app config (app.json).
const APPLE_BUNDLE_ID = "com.kindcipe.app";

/** Apple returns `is_private_email` as a boolean or a "true"/"false" string. */
function parseIsPrivateEmail(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return false;
}

export async function verifyGoogleIdToken(idToken: string): Promise<{
  sub: string;
  email: string;
  name: string;
  emailVerified: boolean;
  picture?: string;
} | null> {
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, string>;
    if (!data.sub || !data.email) return null;

    // Security: verify the ID token was issued for one of our Google client IDs
    // to prevent attackers reusing tokens minted for a different app (account takeover).
    if (!GOOGLE_CLIENT_IDS.includes(data.aud)) {
      console.warn(`[Google Auth] Token audience mismatch: ${data.aud}`);
      return null;
    }

    return {
      sub: data.sub,
      email: data.email,
      name: data.name || data.email.split("@")[0],
      // 讀 provider 回報嘅 email_verified（唔再硬編碼 true）
      emailVerified: String(data.email_verified ?? "") === "true",
      picture: data.picture,
    };
  } catch {
    return null;
  }
}

// ─── Apple Token Verification ─────────────────────────────────────────────────
// Apple ID tokens are JWTs signed by Apple's public keys.
// We verify by fetching Apple's JWKS and validating the JWT.
async function verifyAppleIdToken(idToken: string): Promise<{
  sub: string;
  email: string;
  isPrivateEmail: boolean;
} | null> {
  try {
    // Decode JWT header to get kid
    const [headerB64] = idToken.split(".");
    const header = JSON.parse(Buffer.from(headerB64, "base64url").toString());

    // Fetch Apple's public keys
    const jwksRes = await fetch("https://appleid.apple.com/auth/keys");
    if (!jwksRes.ok) return null;
    const { keys } = (await jwksRes.json()) as { keys: Array<{ kid: string; n: string; e: string; kty: string; alg: string }> };
    const key = keys.find((k) => k.kid === header.kid);
    if (!key) return null;

    // Import the key and verify
    const { jwtVerify, importJWK } = await import("jose");
    const publicKey = await importJWK(key, key.alg);
    const { payload } = await jwtVerify(idToken, publicKey, {
      issuer: "https://appleid.apple.com",
      // Security: the "aud" of an Apple ID token is the iOS bundle ID. Verify it
      // matches our app so tokens minted for a different app are rejected.
      audience: APPLE_BUNDLE_ID,
    });

    const sub = payload.sub as string;
    const email = payload.email as string;
    if (!sub) return null;

    return {
      sub,
      email: email || `${sub}@privaterelay.appleid.com`,
      isPrivateEmail: parseIsPrivateEmail((payload as any).is_private_email),
    };
  } catch (err) {
    console.error("[Apple Auth] Token verification failed:", err);
    return null;
  }
}

// ─── Helper: create or find user + issue session ──────────────────────────────
async function handleSocialLogin(
  req: Request,
  res: Response,
  params: {
    provider: "google" | "apple";
    providerUserId: string;
    email: string;
    name: string;
    loginMethod: "google" | "apple";
    emailVerified?: boolean;
    isPrivateEmail?: boolean;
  }
) {
  // Resolve by identity (+ auto-link by verified email), else create — 令換機/換 provider 都搵返同一帳號
  const resolved = await resolveUserForIdentity({
    provider: params.provider,
    providerUserId: params.providerUserId,
    email: params.email,
    emailVerified: params.emailVerified ?? true,
    isPrivateEmail: params.isPrivateEmail,
    name: params.name,
    loginMethod: params.loginMethod,
  });
  if (!resolved?.user) {
    res.status(500).json({ error: "Failed to create user" });
    return;
  }
  const user = resolved.user;

  const sessionToken = await sdk.createSessionToken(user.openId, {
    name: params.name,
    expiresInMs: ONE_YEAR_MS,
    passwordVersion: user.passwordVersion,
  });
  const cookieOptions = getSessionCookieOptions(req);
  res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
  res.json({ success: true, token: sessionToken });
}

// ─── Sign in with Apple — Web / Android OAuth helpers ─────────────────────────

function isAppleWebConfigured(): boolean {
  return !!(ENV.appleTeamId && ENV.appleKeyId && ENV.appleServicesId && ENV.applePrivateKey && ENV.appleWebRedirectUri);
}

/** client secret JWT (ES256) signed with the Apple .p8 key (short-lived, regenerated each time). */
async function makeAppleClientSecret(): Promise<string> {
  const { SignJWT, importPKCS8 } = await import("jose");
  const key = await importPKCS8(ENV.applePrivateKey, "ES256");
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: ENV.appleKeyId })
    .setIssuer(ENV.appleTeamId)
    .setSubject(ENV.appleServicesId)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt(now)
    .setExpirationTime(now + 60 * 30)
    .sign(key);
}

/** Signed state carrying the nonce + optional web return URL (防 CSRF / replay)。 */
async function makeAppleState(nonce: string, redirect?: string): Promise<string> {
  const { SignJWT } = await import("jose");
  const secret = new TextEncoder().encode(ENV.cookieSecret || "kindcipe-apple-state-secret");
  return await new SignJWT(redirect ? { nonce, redirect } : { nonce })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secret);
}

async function readAppleState(state: string): Promise<{ nonce: string; redirect?: string } | null> {
  try {
    const { jwtVerify } = await import("jose");
    const secret = new TextEncoder().encode(ENV.cookieSecret || "kindcipe-apple-state-secret");
    const { payload } = await jwtVerify(state, secret);
    return {
      nonce: String((payload as any).nonce || ""),
      redirect: (payload as any).redirect ? String((payload as any).redirect) : undefined,
    };
  } catch {
    return null;
  }
}

/** Only allow redirecting back to origins explicitly listed in ALLOWED_ORIGINS. */
function isAllowedRedirect(url: string): boolean {
  try {
    const target = new URL(url);
    const allowed = new Set(
      (process.env.ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean)
    );
    return allowed.has(target.origin);
  } catch {
    return false;
  }
}

/** Verify a web (Services ID audience) Apple id_token and check the nonce. */
async function verifyAppleWebIdToken(idToken: string, expectedNonce: string): Promise<{ sub: string; email: string; isPrivateEmail: boolean } | null> {
  try {
    const [headerB64] = idToken.split(".");
    const header = JSON.parse(Buffer.from(headerB64, "base64url").toString());
    const jwksRes = await fetch("https://appleid.apple.com/auth/keys");
    if (!jwksRes.ok) return null;
    const { keys } = (await jwksRes.json()) as { keys: Array<{ kid: string; n: string; e: string; kty: string; alg: string }> };
    const key = keys.find((k) => k.kid === header.kid);
    if (!key) return null;
    const { jwtVerify, importJWK } = await import("jose");
    const publicKey = await importJWK(key, key.alg);
    const { payload } = await jwtVerify(idToken, publicKey, {
      issuer: "https://appleid.apple.com",
      audience: ENV.appleServicesId,
    });
    if (expectedNonce && String((payload as any).nonce || "") !== expectedNonce) return null;
    const sub = payload.sub as string;
    if (!sub) return null;
    const email = (payload as any).email as string | undefined;
    return {
      sub,
      email: email || `${sub}@privaterelay.appleid.com`,
      isPrivateEmail: parseIsPrivateEmail((payload as any).is_private_email),
    };
  } catch (err) {
    console.error("[AppleWebAuth] id_token verify failed:", (err as Error)?.message);
    return null;
  }
}

// ─── Register Routes ──────────────────────────────────────────────────────────
export function registerSocialAuthRoutes(app: Express) {
  app.post("/api/auth/google", async (req: Request, res: Response) => {
    const { idToken } = req.body as { idToken?: string };
    if (!idToken) {
      res.status(400).json({ error: "idToken is required" });
      return;
    }

    const info = await verifyGoogleIdToken(idToken);
    if (!info) {
      res.status(401).json({ error: "Invalid Google token" });
      return;
    }

    await handleSocialLogin(req, res, {
      provider: "google",
      providerUserId: info.sub,
      email: info.email,
      name: info.name || fallbackName(info.email, "google"),
      loginMethod: "google",
      emailVerified: info.emailVerified,
    });
  });

  // Apple Sign In
  app.post("/api/auth/apple", async (req: Request, res: Response) => {
    const { idToken, name } = req.body as { idToken?: string; name?: string };
    if (!idToken) {
      res.status(400).json({ error: "idToken is required" });
      return;
    }

    const info = await verifyAppleIdToken(idToken);
    if (!info) {
      res.status(401).json({ error: "Invalid Apple token" });
      return;
    }

    await handleSocialLogin(req, res, {
      provider: "apple",
      providerUserId: info.sub,
      email: info.email,
      name: name || fallbackName(info.email, "apple"),
      loginMethod: "apple",
      isPrivateEmail: info.isPrivateEmail,
    });
  });

  // ── Sign in with Apple — Web / Android OAuth ──────────────────────────────
  // 開始：302 去 Apple 授權頁（response_mode=form_post 會 POST 返 callback）
  app.get("/api/auth/apple/web/start", async (req: Request, res: Response) => {
    if (!isAppleWebConfigured()) {
      res.status(503).send("Apple web login not configured");
      return;
    }
    const nonce = nanoid(24);
    // Web app passes ?redirect=https://app.kindcipe.com/login to come back here;
    // native omits it and gets the kindcipe:// deep link instead.
    const rawRedirect = typeof req.query.redirect === "string" ? req.query.redirect : "";
    const redirect = rawRedirect && isAllowedRedirect(rawRedirect) ? rawRedirect : undefined;
    const state = await makeAppleState(nonce, redirect);
    const params = new URLSearchParams({
      response_type: "code",
      client_id: ENV.appleServicesId,
      redirect_uri: ENV.appleWebRedirectUri,
      scope: "name email",
      response_mode: "form_post",
      state,
      nonce,
    });
    res.redirect(`https://appleid.apple.com/auth/authorize?${params.toString()}`);
  });

  // 回呼：收 Apple form_post → 換 token → 驗 id_token → 登入 → 返 web 或深層連結返 app
  app.post("/api/auth/apple/callback", async (req: Request, res: Response) => {
    let stateRedirect: string | undefined;
    // Web callbacks land back on the web origin with ?apple=<status>; the session
    // cookie is set below. Native keeps the kindcipe:// deep link with the token.
    const finish = (qs: string) => {
      if (stateRedirect) {
        res.redirect(`${stateRedirect}?${qs}`);
      } else {
        res.redirect(`kindcipe://apple-login?${qs}`);
      }
    };
    try {
      const body = (req.body || {}) as { code?: string; state?: string; id_token?: string; user?: string };
      const statePayload = body.state ? await readAppleState(body.state) : null;
      stateRedirect = statePayload?.redirect;
      if (!statePayload || !body.code) {
        finish("error=invalid_request");
        return;
      }
      const clientSecret = await makeAppleClientSecret();
      const tokenRes = await fetch("https://appleid.apple.com/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: body.code,
          client_id: ENV.appleServicesId,
          client_secret: clientSecret,
          redirect_uri: ENV.appleWebRedirectUri,
        }),
      });
      if (!tokenRes.ok) {
        console.error("[AppleWebAuth] token exchange failed:", tokenRes.status);
        finish("error=token_exchange");
        return;
      }
      const tokenJson = (await tokenRes.json()) as { id_token?: string };
      const idToken = tokenJson.id_token || body.id_token || "";
      const info = idToken ? await verifyAppleWebIdToken(idToken, statePayload.nonce) : null;
      if (!info) {
        finish("error=invalid_token");
        return;
      }
      let appleName = "";
      if (body.user) {
        try {
          const u = JSON.parse(body.user);
          appleName = [u?.name?.firstName, u?.name?.lastName].filter(Boolean).join(" ");
        } catch { /* ignore */ }
      }
      const resolved = await resolveUserForIdentity({
        provider: "apple",
        providerUserId: info.sub,
        email: info.email,
        emailVerified: true,
        isPrivateEmail: info.isPrivateEmail,
        name: appleName || fallbackName(info.email, "apple"),
        loginMethod: "apple",
      });
      if (!resolved?.user) {
        finish("error=login_failed");
        return;
      }
      const sessionToken = await sdk.createSessionToken(resolved.user.openId, {
        name: resolved.user.name || "",
        expiresInMs: ONE_YEAR_MS,
        passwordVersion: resolved.user.passwordVersion,
      });
      if (stateRedirect) {
        // Web: set the httpOnly session cookie and bounce back to the app.
        // The cookie only works when the callback shares the app's registrable
        // domain (i.e. APPLE_WEB_REDIRECT_URI on https://api.kindcipe.com).
        // When the callback is served from a different site (e.g. *.railway.app)
        // browsers reject the third-party Set-Cookie, so we ALSO hand the token
        // back in the URL fragment — fragments are never sent to servers or
        // written to access logs, and the web client stores it in localStorage
        // (same as the Google web flow). Native keeps the kindcipe:// deep link.
        res.cookie(COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS });
        const redirectBase = stateRedirect;
        const hash = `#token=${encodeURIComponent(sessionToken)}`;
        res.redirect(`${redirectBase}${redirectBase.includes("?") ? "&" : "?"}apple=success${hash}`);
      } else {
        res.redirect(`kindcipe://apple-login?token=${encodeURIComponent(sessionToken)}`);
      }
    } catch (err) {
      console.error("[AppleWebAuth] callback error:", (err as Error)?.message);
      finish("error=server");
    }
  });
}
