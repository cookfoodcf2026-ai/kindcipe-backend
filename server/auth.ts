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

async function verifyGoogleIdToken(idToken: string): Promise<{
  sub: string;
  email: string;
  name: string;
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

    return { sub, email: email || `${sub}@privaterelay.appleid.com` };
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
  }
) {
  // Resolve by identity (+ auto-link by verified email), else create — 令換機/換 provider 都搵返同一帳號
  const resolved = await resolveUserForIdentity({
    provider: params.provider,
    providerUserId: params.providerUserId,
    email: params.email,
    emailVerified: true,
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

/** Signed state carrying the nonce (防 CSRF / replay)。 */
async function makeAppleState(nonce: string): Promise<string> {
  const { SignJWT } = await import("jose");
  const secret = new TextEncoder().encode(ENV.cookieSecret || "kindcipe-apple-state-secret");
  return await new SignJWT({ nonce })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secret);
}

async function readAppleState(state: string): Promise<{ nonce: string } | null> {
  try {
    const { jwtVerify } = await import("jose");
    const secret = new TextEncoder().encode(ENV.cookieSecret || "kindcipe-apple-state-secret");
    const { payload } = await jwtVerify(state, secret);
    return { nonce: String((payload as any).nonce || "") };
  } catch {
    return null;
  }
}

/** Verify a web (Services ID audience) Apple id_token and check the nonce. */
async function verifyAppleWebIdToken(idToken: string, expectedNonce: string): Promise<{ sub: string; email: string } | null> {
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
    return { sub, email: email || `${sub}@privaterelay.appleid.com` };
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
    const state = await makeAppleState(nonce);
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

  // 回呼：收 Apple form_post → 換 token → 驗 id_token → 登入 → 深層連結返 app
  app.post("/api/auth/apple/callback", async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as { code?: string; state?: string; id_token?: string; user?: string };
      const statePayload = body.state ? await readAppleState(body.state) : null;
      if (!statePayload || !body.code) {
        res.redirect("kindcipe://apple-login?error=invalid_request");
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
        res.redirect("kindcipe://apple-login?error=token_exchange");
        return;
      }
      const tokenJson = (await tokenRes.json()) as { id_token?: string };
      const idToken = tokenJson.id_token || body.id_token || "";
      const info = idToken ? await verifyAppleWebIdToken(idToken, statePayload.nonce) : null;
      if (!info) {
        res.redirect("kindcipe://apple-login?error=invalid_token");
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
        name: appleName || fallbackName(info.email, "apple"),
        loginMethod: "apple",
      });
      if (!resolved?.user) {
        res.redirect("kindcipe://apple-login?error=login_failed");
        return;
      }
      const sessionToken = await sdk.createSessionToken(resolved.user.openId, {
        name: resolved.user.name || "",
        expiresInMs: ONE_YEAR_MS,
        passwordVersion: resolved.user.passwordVersion,
      });
      res.redirect(`kindcipe://apple-login?token=${encodeURIComponent(sessionToken)}`);
    } catch (err) {
      console.error("[AppleWebAuth] callback error:", (err as Error)?.message);
      res.redirect("kindcipe://apple-login?error=server");
    }
  });
}
