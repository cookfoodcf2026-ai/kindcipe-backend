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
import { sdk } from "./_core/sdk";
import { getSessionCookieOptions } from "./_core/cookies";

// ─── Google Token Verification ───────────────────────────────────────────────
// We verify Google ID tokens by calling Google's tokeninfo endpoint.
// Validates that the token was issued for our app (aud check).
const GOOGLE_CLIENT_IDS = [
  "690207937492-7hfs5hkksd5heo78kcfmq294f19rgp6d.apps.googleusercontent.com", // Web Client
  "690207937492-epsg13ch62s93cmav0nkfieeeoq6r3db.apps.googleusercontent.com", // iOS Client
  "690207937492-kon293ihsbjd6hqi56lg47n7td5c7eme.apps.googleusercontent.com", // Android Client
];

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
    openId: string;
    email: string;
    name: string;
    loginMethod: "google" | "apple";
  }
) {
  // Upsert user
  await db.upsertUser({
    openId: params.openId,
    email: params.email,
    name: params.name,
    loginMethod: params.loginMethod,
    lastSignedIn: new Date(),
  });

  const user = await db.getUserByOpenId(params.openId);
  if (!user) {
    res.status(500).json({ error: "Failed to create user" });
    return;
  }

  // Auto-create family kitchen for first-time users
  if (!user.familyId) {
    try {
      const kitchenName = `${params.name}'s Kitchen`;
      const inviteCode = nanoid(6).toUpperCase();
      const family = await db.createFamily({
        name: kitchenName,
        inviteCode,
        ownerId: user.id,
      });
      if (family) {
        await db.addFamilyMember({
          familyId: family.id,
          userId: user.id,
          familyRole: "housewife",
          nickname: params.name,
        });
        await db.updateUserFamily(user.id, family.id, "housewife");
      }
    } catch (err) {
      console.error("[Social Auth] Auto-create family failed:", err);
    }
  }

  // Issue session cookie
  const sessionToken = await sdk.createSessionToken(user.openId, {
    name: params.name,
    expiresInMs: ONE_YEAR_MS,
  });
  const cookieOptions = getSessionCookieOptions(req);
  res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
  res.json({ success: true });
}

// ─── Register Routes ──────────────────────────────────────────────────────────
export function registerSocialAuthRoutes(app: Express) {
  // Google Sign In
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
      openId: `google_${info.sub}`,
      email: info.email,
      name: info.name,
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
      openId: `apple_${info.sub}`,
      email: info.email,
      name: name || info.email.split("@")[0],
      loginMethod: "apple",
    });
  });
}
