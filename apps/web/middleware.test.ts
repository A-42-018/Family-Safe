import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionState } from "@/lib/auth/routes";

const state: { session: SessionState; withCookie: boolean } = { session: { user: null, aal: { current: null, next: null } }, withCookie: false };
const seenHeaders: Headers[] = [];

vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: vi.fn(async (_req: NextRequest, requestHeaders: Headers) => {
    seenHeaders.push(requestHeaders);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    if (state.withCookie) {
      response.cookies.set("sb-refreshed", "1", { httpOnly: true });
      response.headers.set("cache-control", "private, no-store");
    }
    return { response, session: state.session };
  }),
}));

import { middleware, config } from "./middleware";

const req = (path: string) => new NextRequest(new URL(path, "http://localhost:3000"));
const anon: SessionState = { user: null, aal: { current: null, next: null } };
const authed: SessionState = { user: { id: "u", emailConfirmed: true }, aal: { current: "aal1", next: "aal1" } };

beforeEach(() => {
  state.session = anon;
  state.withCookie = false;
  seenHeaders.length = 0;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://p.supabase.co");
});

describe("middleware", () => {
  it("redirects unauthenticated users on protected routes to /login?next=", async () => {
    const res = await middleware(req("/dashboard"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search).toBe("/login?next=%2Fdashboard");
  });
  it("lets guests see /login and authenticated users skip it", async () => {
    expect((await middleware(req("/login"))).status).toBe(200);
    state.session = authed;
    expect(new URL((await middleware(req("/login"))).headers.get("location")!).pathname).toBe("/dashboard");
  });
  it("verified users reach /dashboard", async () => {
    state.session = authed;
    expect((await middleware(req("/dashboard"))).headers.get("location")).toBeNull();
  });
  it("sends aal1 users with a factor to /mfa and unverified users to /verify-email", async () => {
    state.session = { ...authed, aal: { current: "aal1", next: "aal2" } };
    expect(new URL((await middleware(req("/dashboard"))).headers.get("location")!).pathname).toBe("/mfa");
    state.session = { ...authed, user: { id: "u", emailConfirmed: false } };
    expect(new URL((await middleware(req("/dashboard"))).headers.get("location")!).pathname).toBe("/verify-email");
  });
  it("sets a nonce CSP on responses and forwards the same nonce to the app", async () => {
    const res = await middleware(req("/login"));
    const csp = res.headers.get("content-security-policy")!;
    const nonce = /'nonce-([^']+)'/.exec(csp)![1];
    expect(seenHeaders[0]!.get("x-nonce")).toBe(nonce);
    expect(seenHeaders[0]!.get("content-security-policy")).toBe(csp);
    expect(csp).toContain("https://p.supabase.co");
  });
  it("uses a fresh nonce per request", async () => {
    const a = (await middleware(req("/login"))).headers.get("content-security-policy");
    const b = (await middleware(req("/login"))).headers.get("content-security-policy");
    expect(a).not.toBe(b);
  });
  it("preserves refreshed session cookies and cache headers across redirects", async () => {
    state.withCookie = true;
    const res = await middleware(req("/dashboard"));
    expect(res.status).toBe(307);
    expect(res.cookies.get("sb-refreshed")?.value).toBe("1");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
  it("marks responses no-store by default", async () => {
    expect((await middleware(req("/login"))).headers.get("cache-control")).toBe("no-store");
  });
  it("matcher skips static assets", () => {
    const re = new RegExp("^" + config.matcher[0]!.replace(/\(\?!/, "(?!") + "$");
    expect(re.test("/_next/static/x.js")).toBe(false);
    expect(re.test("/logo.png")).toBe(false);
    expect(re.test("/dashboard")).toBe(true);
  });
});
