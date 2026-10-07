import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicEnv } from "@/lib/env";
import type { SessionState } from "@/lib/auth/routes";
import { sessionCookieOptions } from "./cookies";

/**
 * Refreshes the session cookies and returns the verified session state.
 * `getUser()` revalidates the JWT with the Auth server on every request (never trust getSession() on the server).
 */
export async function updateSession(
  request: NextRequest,
  requestHeaders: Headers,
): Promise<{ response: NextResponse; session: SessionState }> {
  const env = getPublicEnv();
  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(env.supabaseUrl, env.anonKey, {
    cookieOptions: sessionCookieOptions,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list, headers) {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request: { headers: requestHeaders } });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
        for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v); // no-store on cookie writes
      },
    },
  });

  const { data, error } = await supabase.auth.getUser();
  const user = error || !data.user ? null : data.user;
  let aal: SessionState["aal"] = { current: null, next: null };
  if (user) {
    const r = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!r.error) aal = { current: r.data.currentLevel, next: r.data.nextLevel };
  }
  return {
    response,
    session: { user: user ? { id: user.id, emailConfirmed: Boolean(user.email_confirmed_at) } : null, aal },
  };
}
