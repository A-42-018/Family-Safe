import type { CookieOptions } from "@supabase/ssr";

/**
 * Session cookies are HttpOnly: the browser never needs the tokens (all auth goes through server actions/middleware).
 * Phase 6+ note: if Realtime needs a browser-side token, hand out a short-lived one via a server endpoint instead.
 */
export const sessionCookieOptions: CookieOptions = {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
};
