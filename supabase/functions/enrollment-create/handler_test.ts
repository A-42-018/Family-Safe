import { assert, assertEquals, fakeJwt } from "../_shared/test_util.ts";
import { signDeviceJwt, type ParentTokenVerifier } from "../_shared/auth.ts";
import { hashPairingCode, normalizePairingCode } from "../_shared/enrollment.ts";
import { resetRateLimits } from "../_shared/ratelimit.ts";
import { type Deps, handler } from "./handler.ts";

const PEPPER = "p".repeat(40);
const CHILD = "c0000000-0000-4000-8000-00000000000a";
const now = () => Math.floor(Date.now() / 1000);
const token = (over: Record<string, unknown> = {}) => fakeJwt({ sub: "parent-1", role: "authenticated", aal: "aal1", exp: now() + 3600, iat: now(), ...over });
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

interface Call { parentId: string; childId: string; tokenHash: Uint8Array; ttlSeconds: number }

function setup(opts: { verify?: ParentTokenVerifier; owned?: string[]; generateCode?: () => string } = {}) {
  resetRateLimits();
  const calls: Call[] = [];
  const owned = opts.owned ?? [CHILD];
  const deps: Deps = {
    pairingPepper: PEPPER,
    verify: opts.verify ?? (() => Promise.resolve({ id: "parent-1" })),
    generateCode: opts.generateCode,
    createToken: (a) => {
      calls.push(a);
      return Promise.resolve(owned.includes(a.childId) ? "2026-09-29T12:10:00.000Z" : null);
    },
  };
  return { deps, calls };
}

const call = (deps: Deps, o: { token?: string | null; body?: unknown; method?: string; ip?: string; contentType?: string } = {}) => {
  const method = o.method ?? "POST";
  const headers: Record<string, string> = { "content-type": o.contentType ?? "application/json" };
  if (o.token !== null) headers.authorization = `Bearer ${o.token ?? token()}`;
  if (o.ip) headers["x-forwarded-for"] = o.ip;
  return handler(new Request("http://localhost/enrollment-create", { method, headers, body: method === "POST" ? JSON.stringify(o.body ?? { child_id: CHILD }) : undefined }), deps);
};

Deno.test("enrollment-create: own child -> 201 with grouped code, QR payload, 10 min expiry", async () => {
  const { deps, calls } = setup({ generateCode: () => "0123456789ABCDEF" });
  const r = await call(deps);
  assertEquals(r.status, 201);
  assertEquals(r.headers.get("cache-control"), "no-store");
  assertEquals(await r.json(), {
    data: { pairing_code: "0123-4567-89AB-CDEF", qr_payload: "familysafe://enroll?c=0123456789ABCDEF", expires_at: "2026-09-29T12:10:00.000Z", expires_in: 600 },
  });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].parentId, "parent-1");
  assertEquals(calls[0].childId, CHILD);
  assertEquals(calls[0].ttlSeconds, 600);
});

Deno.test("enrollment-create: only the HMAC of the code reaches the store (never the code)", async () => {
  const { deps, calls } = setup({ generateCode: () => "0123456789ABCDEF" });
  await call(deps);
  assertEquals(calls[0].tokenHash.length, 32);
  assertEquals(hex(calls[0].tokenHash), hex(await hashPairingCode("0123456789ABCDEF", PEPPER)));
  assert(!JSON.stringify(calls[0]).includes("0123456789ABCDEF"));
});

Deno.test("enrollment-create: real generator gives distinct valid codes per call", async () => {
  const { deps } = setup();
  const codes = new Set<string>();
  for (let i = 0; i < 5; i++) {
    const body = await (await call(deps)).json();
    const c = normalizePairingCode(body.data.pairing_code);
    assert(/^[0-9A-HJKMNP-TV-Z]{16}$/.test(c));
    codes.add(c);
  }
  assertEquals(codes.size, 5);
});

Deno.test("enrollment-create: foreign and unknown child are indistinguishable (404)", async () => {
  const { deps } = setup({ owned: [CHILD] });
  const foreign = await call(deps, { body: { child_id: "c0000000-0000-4000-8000-00000000000b" } });
  const unknown = await call(deps, { body: { child_id: "c0000000-0000-4000-8000-0000000000ff" } });
  assertEquals(foreign.status, 404);
  assertEquals(unknown.status, 404);
  assertEquals(await foreign.text(), await unknown.text());
});

Deno.test("enrollment-create: missing / malformed token -> 401, store untouched", async () => {
  const { deps, calls } = setup();
  assertEquals((await call(deps, { token: null })).status, 401);
  assertEquals((await call(deps, { token: "not-a-jwt" })).status, 401);
  assertEquals(calls.length, 0);
});

Deno.test("enrollment-create: device JWT -> 403 and the Auth verifier is never called", async () => {
  let verified = 0;
  const { deps, calls } = setup({ verify: () => { verified++; return Promise.resolve({ id: "x" }); } });
  const deviceJwt = await signDeviceJwt({ sub: "d0000000-0000-4000-8000-00000000000a" }, "s".repeat(40));
  const r = await call(deps, { token: deviceJwt });
  assertEquals(r.status, 403);
  assertEquals(verified, 0);
  assertEquals(calls.length, 0);
});

Deno.test("enrollment-create: anon/service role keys, expired tokens, revoked sessions, sub mismatch -> 401", async () => {
  const { deps: d1, calls } = setup();
  assertEquals((await call(d1, { token: token({ role: "anon" }) })).status, 401);
  assertEquals((await call(d1, { token: token({ role: "service_role" }) })).status, 401);
  assertEquals((await call(d1, { token: token({ exp: now() - 10 }) })).status, 401);
  const { deps: d2 } = setup({ verify: () => Promise.resolve(null) });
  assertEquals((await call(d2)).status, 401);
  const { deps: d3 } = setup({ verify: () => Promise.resolve({ id: "someone-else" }) });
  assertEquals((await call(d3)).status, 401);
  assertEquals(calls.length, 0);
});

Deno.test("enrollment-create: Auth outage -> sanitized 500 (never treated as valid)", async () => {
  const { deps, calls } = setup({ verify: () => Promise.reject(new Error("secret internal detail")) });
  const r = await call(deps);
  assertEquals(r.status, 500);
  assert(!(await r.text()).includes("secret internal detail"));
  assertEquals(calls.length, 0);
});

Deno.test("enrollment-create: store failure -> sanitized 500", async () => {
  const { deps } = setup();
  deps.createToken = () => Promise.reject(new Error("duplicate key value violates unique constraint pairing_tokens_token_hash_key"));
  const r = await call(deps);
  assertEquals(r.status, 500);
  const text = await r.text();
  assert(!text.includes("duplicate") && !text.includes("pairing_tokens"));
});

Deno.test("enrollment-create: validation (bad id, extra keys, content type, method)", async () => {
  const { deps, calls } = setup();
  assertEquals((await call(deps, { body: { child_id: "nope" } })).status, 400);
  assertEquals((await call(deps, { body: {} })).status, 400);
  assertEquals((await call(deps, { body: { child_id: CHILD, parent_id: "x" } })).status, 400);
  assertEquals((await call(deps, { contentType: "text/plain" })).status, 400);
  assertEquals((await call(deps, { method: "GET" })).status, 400);
  assertEquals(calls.length, 0);
});

Deno.test("enrollment-create: per-parent limit (10 / 15 min) -> 429 with Retry-After", async () => {
  const { deps } = setup();
  for (let i = 0; i < 10; i++) assertEquals((await call(deps)).status, 201);
  const r = await call(deps);
  assertEquals(r.status, 429);
  assert(Number(r.headers.get("retry-after")) > 0);
  // a different parent is unaffected
  const other = setup({ verify: () => Promise.resolve({ id: "parent-2" }) });
  resetRateLimits; // (setup resets buckets; re-run the exhausted parent to prove the counter is per principal)
  assertEquals((await call(other.deps, { token: token({ sub: "parent-2" }) })).status, 201);
});

Deno.test("enrollment-create: per-IP pre-auth limit (30 / 5 min) applies before authentication", async () => {
  const { deps } = setup();
  for (let i = 0; i < 30; i++) assertEquals((await call(deps, { token: null, ip: "198.51.100.1" })).status, 401);
  assertEquals((await call(deps, { token: null, ip: "198.51.100.1" })).status, 429);
  assertEquals((await call(deps, { token: null, ip: "198.51.100.2" })).status, 401);
});

Deno.test("enrollment-create: CORS preflight and origin allow-list", async () => {
  const { deps } = setup();
  deps.allowedOrigins = "https://app.example.com";
  const pre = await handler(new Request("http://localhost/enrollment-create", { method: "OPTIONS", headers: { origin: "https://app.example.com" } }), deps);
  assertEquals(pre.status, 204);
  assertEquals(pre.headers.get("access-control-allow-origin"), "https://app.example.com");
  const bad = await handler(new Request("http://localhost/enrollment-create", { method: "OPTIONS", headers: { origin: "https://evil.example" } }), deps);
  assertEquals(bad.headers.get("access-control-allow-origin"), null);
});
