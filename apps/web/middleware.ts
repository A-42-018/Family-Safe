import { NextResponse, type NextRequest } from "next/server";
import { decideRedirect } from "@/lib/auth/routes";
import { buildCsp, generateNonce } from "@/lib/security/csp";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const nonce = generateNonce();
  const csp = buildCsp({ nonce, isDev: process.env.NODE_ENV !== "production", supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const { response, session } = await updateSession(request, requestHeaders);

  const { pathname, search } = request.nextUrl;
  const target = decideRedirect(pathname, search, session);

  let out = response;
  if (target) {
    out = NextResponse.redirect(new URL(target, request.url));
    for (const c of response.cookies.getAll()) out.cookies.set(c); // keep refreshed/cleared session cookies
    const cc = response.headers.get("cache-control");
    if (cc) out.headers.set("cache-control", cc);
  }
  out.headers.set("content-security-policy", csp);
  if (!out.headers.has("cache-control")) out.headers.set("cache-control", "no-store");
  return out;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
