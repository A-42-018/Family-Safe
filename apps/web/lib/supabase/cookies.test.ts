import { createServerClient } from "@supabase/ssr";
import { expect, it, vi } from "vitest";
import { sessionCookieOptions } from "@/lib/supabase/cookies";

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
it("session cookies are written HttpOnly with no-store headers", async () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const access = `${b64({ alg: "HS256" })}.${b64({ sub: "u1", exp, role: "authenticated", aal: "aal1", session_id: "s" })}.sig`;
  const user = { id: "u1", aud: "authenticated", email: "a@b.co", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01" };
  const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(String(url).includes("/user") ? user : {}), { status: 200, headers: { "content-type": "application/json" } }));
  const setAll = vi.fn();
  const sb = createServerClient("http://127.0.0.1:54321", "anon", { global: { fetch: fetchMock as unknown as typeof fetch }, cookieOptions: sessionCookieOptions, cookies: { getAll: () => [], setAll } });
  await sb.auth.setSession({ access_token: access, refresh_token: "r" });
  await new Promise((r) => setTimeout(r, 50));
  expect(setAll).toHaveBeenCalled();
  const [list, headers] = setAll.mock.calls[0]!;
  for (const c of list) { expect(c.options.httpOnly).toBe(true); expect(c.options.sameSite).toBe("lax"); }
  expect(String(headers["Cache-Control"] ?? headers["cache-control"])).toMatch(/no-store/);
});
