// Pure routing rules (unit-tested). Middleware is the first gate; the (app) layout is defense in depth.
export type Aal = string | null; // "aal1" | "aal2" (supabase-js widens the type)

export interface SessionState {
  user: { id: string; emailConfirmed: boolean } | null;
  aal: { current: Aal; next: Aal };
}

const GUEST_ONLY = ["/login", "/signup", "/forgot-password"];

const matches = (path: string, base: string) => path === base || path.startsWith(base + "/");

/** Open-redirect-safe `next` handling: same-origin relative paths only, never auth pages. */
export function safeNext(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw || raw.length > 512) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || /[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  try {
    const u = new URL(raw, "http://internal.invalid");
    if (u.origin !== "http://internal.invalid") return fallback;
    const path = u.pathname;
    if (GUEST_ONLY.some((g) => matches(path, g)) || path.startsWith("/auth/") || matches(path, "/mfa") || matches(path, "/verify-email")) return fallback;
    return path + u.search;
  } catch {
    return fallback;
  }
}

export function needsMfa(s: SessionState): boolean {
  return s.aal.next === "aal2" && s.aal.current !== "aal2";
}

/** Returns the path to redirect to, or null to continue. */
export function decideRedirect(pathname: string, search: string, s: SessionState): string | null {
  if (matches(pathname, "/verify-email") || pathname.startsWith("/auth/")) return null;
  if (GUEST_ONLY.some((g) => matches(pathname, g))) return s.user ? "/dashboard" : null;

  const here = pathname + search;
  if (!s.user) {
    const next = safeNext(here, "");
    return next && pathname !== "/" ? `/login?next=${encodeURIComponent(next)}` : "/login";
  }
  if (!s.user.emailConfirmed) return "/verify-email";
  if (needsMfa(s)) {
    if (matches(pathname, "/mfa")) return null;
    const next = safeNext(here, "");
    return next && pathname !== "/" ? `/mfa?next=${encodeURIComponent(next)}` : "/mfa";
  }
  if (matches(pathname, "/mfa")) return "/dashboard"; // nothing to challenge
  if (pathname === "/") return "/dashboard";
  return null;
}
