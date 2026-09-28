import type { CookieOptions, Request } from "express";

export function getSessionCookieOptions(
  req: Request
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  // Web app support: when api.<domain> must share the session cookie with
  // app.<domain>, set COOKIE_DOMAIN=".kindcipe.com". Left undefined for
  // native-only / localhost (host-only cookie).
  const domain = process.env.COOKIE_DOMAIN?.trim() || undefined;

  return {
    domain,
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: true,
  };
}
