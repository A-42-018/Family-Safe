import { assert, assertEquals, fakeJwt } from "../_shared/test_util.ts";
import { signDeviceJwt, type ParentTokenVerifier } from "../_shared/auth.ts";
import { resetRateLimits } from "../_shared/ratelimit.ts";
import { type AuditRow, type Deps, handler, normalizeIp } from "./handler.ts";

const now = () => Math.floor(Date.now() / 1000);
const token = (over: Record<string, unknown> = {}) => fakeJwt({ sub: "user-1", role: "authenticated", aal: "aal1", exp: now() + 3600, iat: now(), ...over });

function setup(verify?: ParentTokenVerifier) {
  resetRateLimits();
  const rows: AuditRow[] = [];
  const deps: Deps = {
    verify: verify ?? (() => Promise.resolve({ id: "user-1", email: "p@example.com" })),
    insertAudit: (r) => { rows.push(r); return Promise.resolve(); },
  };
  return { rows, deps };
}

const call = (deps: Deps, opts: { token?: string | null; body?: unknown; method?: string; ip?: string; contentType?: string } = {}) => {
  const headers: Record<string, string> = { "content-type": opts.contentType ?? "application/json" };
  if (opts.token !== null) headers.authorization = `Bearer ${opts.token ?? token()}`;
  if (opts.ip) headers["x-forwarded-for"] = opts.ip;
  return handler(new Request("http://localhost/auth-events", {
    method: opts.method ?? "POST",
    headers,
    body: (opts.method ?? "POST") === "POST" ? JSON.stringify(opts.body ?? { event: "LOGIN", method: "password" }) : undefined,
  }), deps);
};

Deno.test("auth-events: valid parent token writes a LOGIN row with parent id, method and ip", async () => {
  const { rows, deps } = setup();
  const r = await call(deps, { ip: "203.0.113.7, 10.0.0.1" });
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { data: { recorded: true } });
  assertEquals(rows, [{ parent_id: "user-1", action: "LOGIN", metadata: { method: "password" }, ip_address: "203.0.113.7" }]);
});

Deno.test("auth-events: mfa_totp method recorded; no PII in metadata", async () => {
  const { rows, deps } = setup();
  await call(deps, { body: { event: "LOGIN", method: "mfa_totp" } });
  assertEquals(rows[0].metadata, { method: "mfa_totp" });
  assert(!JSON.stringify(rows[0]).includes("p@example.com"));
});

Deno.test("auth-events: missing or malformed token -> 401, nothing written", async () => {
  const { rows, deps } = setup();
  assertEquals((await call(deps, { token: null })).status, 401);
  assertEquals((await call(deps, { token: "garbage" })).status, 401);
  assertEquals(rows.length, 0);
});

Deno.test("auth-events: device token -> 403", async () => {
  const { rows, deps } = setup();
  const dev = await signDeviceJwt({ sub: "d1" }, "x".repeat(40));
  assertEquals((await call(deps, { token: dev })).status, 403);
  assertEquals(rows.length, 0);
});

Deno.test("auth-events: expired / tampered (verifier rejects) -> 401", async () => {
  const a = setup();
  assertEquals((await call(a.deps, { token: token({ exp: now() - 10 }) })).status, 401);
  const b = setup(() => Promise.resolve(null));
  assertEquals((await call(b.deps)).status, 401);
  assertEquals(a.rows.length + b.rows.length, 0);
});

Deno.test("auth-events: anon key style token -> 401", async () => {
  const { rows, deps } = setup();
  assertEquals((await call(deps, { token: token({ role: "anon" }) })).status, 401);
  assertEquals(rows.length, 0);
});

Deno.test("auth-events: only POST, only LOGIN, JSON only, no extra event types", async () => {
  const { rows, deps } = setup();
  assertEquals((await call(deps, { method: "GET" })).status, 400);
  assertEquals((await call(deps, { body: { event: "DEVICE_REMOVED", method: "password" } })).status, 400);
  assertEquals((await call(deps, { body: { event: "LOGIN", method: "sms" } })).status, 400);
  assertEquals((await call(deps, { contentType: "text/plain" })).status, 400);
  assertEquals(rows.length, 0);
});

Deno.test("auth-events: per-parent rate limit -> 429 with Retry-After", async () => {
  const { rows, deps } = setup();
  let last!: Response;
  for (let i = 0; i < 11; i++) last = await call(deps, { ip: "198.51.100.1" });
  assertEquals(last.status, 429);
  assert(last.headers.get("retry-after") !== null);
  assertEquals(rows.length, 10);
});

Deno.test("auth-events: per-IP rate limit applies before auth", async () => {
  const { deps } = setup();
  let last!: Response;
  for (let i = 0; i < 31; i++) last = await call(deps, { token: null, ip: "198.51.100.2" });
  assertEquals(last.status, 429);
});

Deno.test("auth-events: infrastructure failures are sanitized 500s", async () => {
  const { deps } = setup(() => Promise.reject(new Error("auth_verify_unavailable secret")));
  const r = await call(deps);
  assertEquals(r.status, 500);
  assert(!JSON.stringify(await r.json()).includes("secret"));
  const d2 = setup().deps;
  d2.insertAudit = () => Promise.reject(new Error("audit_insert_failed db-password"));
  const r2 = await call(d2);
  assertEquals(r2.status, 500);
  assert(!JSON.stringify(await r2.json()).includes("db-password"));
});

Deno.test("auth-events: CORS preflight handled", async () => {
  const { deps } = setup();
  const r = await handler(new Request("http://x", { method: "OPTIONS", headers: { origin: "http://localhost:3000" } }), deps);
  assertEquals(r.status, 204);
});

Deno.test("normalizeIp: valid addresses pass, junk becomes null (never breaks the inet column)", () => {
  for (const ip of ["1.2.3.4", "255.255.255.255", "2001:db8::1", "::1"]) assertEquals(normalizeIp(ip), ip);
  for (const ip of ["unknown", "999.1.1.1", "1.2.3", "abc", "1.2.3.4; drop table", "", "::::::::::::::::::::::::::::::::::::::::::::::::"]) assertEquals(normalizeIp(ip), null);
});
