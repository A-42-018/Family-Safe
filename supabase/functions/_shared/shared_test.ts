import { assert, assertEquals, assertRejects, assertThrows, fakeJwt } from "./test_util.ts";
import { z } from "zod";
import { ApiError, fail, ok, toErrorResponse } from "./errors.ts";
import { corsHeaders, handlePreflight, parseAllowedOrigins } from "./cors.ts";
import { parseJsonBody, parseWith } from "./validate.ts";
import { extractBearer, peekRole, rejectDeviceTokenOnParentSurface, requireActiveDevice, requireParent, signDeviceJwt, verifyDeviceJwt, type ParentTokenVerifier } from "./auth.ts";
import { checkRateLimit, enforceRateLimit, resetRateLimits } from "./ratelimit.ts";
import { envStatus, getEnv } from "./env.ts";

const SECRET = "x".repeat(40);
const req = (h: Record<string, string> = {}, init: RequestInit = {}) => new Request("http://localhost/x", { ...init, headers: h });

Deno.test("errors: envelope + status mapping", async () => {
  const r = fail(new ApiError("forbidden", "no"));
  assertEquals(r.status, 403);
  assertEquals(await r.json(), { error: { code: "forbidden", message: "no" } });
  assertEquals(await ok({ a: 1 }).json(), { data: { a: 1 } });
});

Deno.test("errors: unknown errors are sanitized", async () => {
  const r = toErrorResponse(new Error("secret db password"));
  assertEquals(r.status, 500);
  assert(!JSON.stringify(await r.json()).includes("secret"));
});

Deno.test("cors: allow-list, no wildcard", () => {
  const allowed = parseAllowedOrigins("https://a.com, https://b.com");
  assertEquals(corsHeaders(req({ origin: "https://a.com" }), allowed)["Access-Control-Allow-Origin"], "https://a.com");
  assertEquals(corsHeaders(req({ origin: "https://evil.com" }), allowed)["Access-Control-Allow-Origin"], undefined);
  assertEquals(handlePreflight(new Request("http://x", { method: "OPTIONS" }), allowed)?.status, 204);
  assertEquals(handlePreflight(req(), allowed), null);
});

Deno.test("validate: rejects bad input without echoing values", () => {
  const err = assertThrows(() => parseWith(z.object({ n: z.number() }), { n: "SECRET" }), ApiError);
  assertEquals(err.code, "validation_error");
  assert(!JSON.stringify(err.details).includes("SECRET"));
});

Deno.test("validate: json body checks", async () => {
  const S = z.object({ a: z.string() });
  const post = (body: string, ct = "application/json") => new Request("http://x", { method: "POST", headers: { "content-type": ct }, body });
  assertEquals(await parseJsonBody(post('{"a":"b"}'), S), { a: "b" });
  await assertRejects(() => parseJsonBody(post("{"), S), ApiError);
  await assertRejects(() => parseJsonBody(post('{"a":"b"}', "text/plain"), S), ApiError);
  await assertRejects(() => parseJsonBody(post(JSON.stringify({ a: "x".repeat(100) })), S, 50), ApiError);
});

Deno.test("auth: bearer extraction", () => {
  assertThrows(() => extractBearer(req()), ApiError);
  assertThrows(() => extractBearer(req({ authorization: "Basic abc" })), ApiError);
  assertEquals(extractBearer(req({ authorization: "Bearer a.b.c" })), "a.b.c");
});

Deno.test("auth: device JWT roundtrip, tamper, expiry, wrong secret", async () => {
  const now = 1_000_000;
  const t = await signDeviceJwt({ sub: "dev-1", cid: "c1" }, SECRET, now);
  const c = await verifyDeviceJwt(t, SECRET, now + 10);
  assertEquals([c.sub, c.role], ["dev-1", "device"]);
  await assertRejects(() => verifyDeviceJwt(t, SECRET, now + 901), ApiError); // expired
  await assertRejects(() => verifyDeviceJwt(t, "y".repeat(40), now + 10), ApiError); // wrong secret
  const [h, p, s] = t.split(".");
  const forged = btoa(JSON.stringify({ sub: "dev-2", role: "device", iat: now, exp: now + 900 })).replace(/=+$/, "");
  await assertRejects(() => verifyDeviceJwt(`${h}.${forged}.${s}`, SECRET, now + 10), ApiError); // tampered payload
  const none = btoa(JSON.stringify({ alg: "none" })).replace(/=+$/, "");
  await assertRejects(() => verifyDeviceJwt(`${none}.${p}.`, SECRET, now + 10), ApiError); // alg none
});

Deno.test("auth: trust-domain split", async () => {
  const dev = await signDeviceJwt({ sub: "d" }, SECRET);
  assertEquals(peekRole(dev), "device");
  assertThrows(() => rejectDeviceTokenOnParentSurface(req({ authorization: `Bearer ${dev}` })), ApiError);
  // parent-style token (role=authenticated) is not a valid device token
  const fake = `${btoa('{"alg":"HS256"}').replace(/=+$/, "")}.${btoa('{"role":"authenticated","sub":"u"}').replace(/=+$/, "")}.sig`;
  const deps = { secret: SECRET, isActive: () => Promise.resolve(true) };
  await assertRejects(() => requireActiveDevice(req({ authorization: `Bearer ${fake}` }), deps), ApiError);
});

Deno.test("requireActiveDevice: live credential required on every request", async () => {
  const seen: Array<[string, string]> = [];
  let active = true;
  const deps = { secret: SECRET, isActive: (d: string, c: string) => { seen.push([d, c]); return Promise.resolve(active); } };
  const tok = await signDeviceJwt({ sub: "dev-1", cid: "cred-1" }, SECRET);
  const r = req({ authorization: `Bearer ${tok}` });
  const p = await requireActiveDevice(r, deps);
  assertEquals([p.kind, p.deviceId, p.credentialId], ["device", "dev-1", "cred-1"]);
  assertEquals(seen, [["dev-1", "cred-1"]]);
  await requireActiveDevice(r, deps);
  assertEquals(seen.length, 2); // not cached: the lookup runs again
  active = false; // parent revokes the device: the very next call is refused although the JWT is still unexpired
  const e = await assertRejects(() => requireActiveDevice(r, deps), ApiError);
  assertEquals(e.status, 401);
});

Deno.test("requireActiveDevice: missing cid, bad signature and expiry never reach the lookup", async () => {
  let calls = 0;
  const deps = { secret: SECRET, isActive: () => { calls++; return Promise.resolve(true); } };
  const noCid = await signDeviceJwt({ sub: "dev-1" }, SECRET);
  const good = await signDeviceJwt({ sub: "dev-1", cid: "c" }, SECRET, 1_000);
  const wrongSecret = await signDeviceJwt({ sub: "dev-1", cid: "c" }, "z".repeat(40));
  await assertRejects(() => requireActiveDevice(req({ authorization: `Bearer ${noCid}` }), deps), ApiError);
  await assertRejects(() => requireActiveDevice(req({ authorization: `Bearer ${wrongSecret}` }), deps), ApiError);
  await assertRejects(() => requireActiveDevice(req({ authorization: `Bearer ${good}` }), { ...deps, now: 1_000 + 901 }), ApiError); // expired
  await assertRejects(() => requireActiveDevice(req({}), deps), ApiError); // no header
  assertEquals(calls, 0);
});

Deno.test("requireActiveDevice: lookup outage propagates (500), never reads as valid", async () => {
  const deps = { secret: SECRET, isActive: () => Promise.reject(new Error("device_authorize_unavailable")) };
  const tok = await signDeviceJwt({ sub: "dev-1", cid: "c" }, SECRET);
  const e = await assertRejects(() => requireActiveDevice(req({ authorization: `Bearer ${tok}` }), deps));
  assert(!(e instanceof ApiError));
});

Deno.test("ratelimit: window and reset", () => {
  resetRateLimits();
  const rule = { name: "t", limit: 2, windowSeconds: 10 };
  assert(checkRateLimit(rule, "ip", 0).allowed);
  assert(checkRateLimit(rule, "ip", 1).allowed);
  const blocked = checkRateLimit(rule, "ip", 2);
  assert(!blocked.allowed && blocked.retryAfterSeconds > 0);
  assert(checkRateLimit(rule, "ip", 10_001).allowed);
  assert(checkRateLimit(rule, "other", 2).allowed);
  resetRateLimits();
  enforceRateLimit({ name: "e", limit: 1, windowSeconds: 5 }, "k");
  assertThrows(() => enforceRateLimit({ name: "e", limit: 1, windowSeconds: 5 }, "k"), ApiError);
});

Deno.test("env: validates and never leaks values", () => {
  const bad = { SUPABASE_URL: "nope", DEVICE_JWT_SECRET: "short-SECRETVALUE" };
  assertEquals(envStatus(bad).ok, false);
  const e = assertThrows(() => getEnv(bad), Error);
  assert(!e.message.includes("SECRETVALUE"));
  const good = { SUPABASE_URL: "http://localhost:54321", SUPABASE_ANON_KEY: "a", SUPABASE_SERVICE_ROLE_KEY: "b", DEVICE_JWT_SECRET: SECRET, PAIRING_TOKEN_PEPPER: SECRET };
  assertEquals(envStatus(good).ok, true);
  assertEquals(getEnv(good).ALLOWED_ORIGINS, "http://localhost:3000");
});

// ---- Phase 5: parent (Supabase JWT) verification -------------------------------------------------------------
const NOW = 2_000_000;
const parentToken = (over: Record<string, unknown> = {}) =>
  fakeJwt({ sub: "user-1", role: "authenticated", aal: "aal1", session_id: "s-1", exp: NOW + 3600, iat: NOW, ...over });
const bearer = (t: string) => req({ authorization: `Bearer ${t}` });
const okVerifier = (calls: string[] = []): ParentTokenVerifier => (t) => { calls.push(t); return Promise.resolve({ id: "user-1", email: "p@example.com" }); };

Deno.test("requireParent: valid token resolves the verified principal", async () => {
  const calls: string[] = [];
  const p = await requireParent(bearer(parentToken()), okVerifier(calls), { now: NOW });
  assertEquals([p.kind, p.parentId, p.email, p.aal, p.sessionId], ["parent", "user-1", "p@example.com", "aal1", "s-1"]);
  assertEquals(calls.length, 1);
});

Deno.test("requireParent: device token is 403 and never reaches the verifier", async () => {
  const calls: string[] = [];
  const dev = await signDeviceJwt({ sub: "d1" }, SECRET, NOW);
  const e = await assertRejects(() => requireParent(bearer(dev), okVerifier(calls), { now: NOW }), ApiError);
  assertEquals((e as ApiError).code, "forbidden");
  assertEquals(calls.length, 0);
});

Deno.test("requireParent: missing/malformed bearer is 401", async () => {
  const e = await assertRejects(() => requireParent(req(), okVerifier(), { now: NOW }), ApiError);
  assertEquals((e as ApiError).code, "unauthorized");
  await assertRejects(() => requireParent(req({ authorization: "Bearer not-a-jwt" }), okVerifier(), { now: NOW }), ApiError);
});

Deno.test("requireParent: expired token is rejected before any network call", async () => {
  const calls: string[] = [];
  const e = await assertRejects(() => requireParent(bearer(parentToken({ exp: NOW - 1 })), okVerifier(calls), { now: NOW }), ApiError);
  assertEquals((e as ApiError).code, "unauthorized");
  assertEquals(calls.length, 0);
});

Deno.test("requireParent: tampered/forged token (verifier says invalid) is 401", async () => {
  const bad: ParentTokenVerifier = () => Promise.resolve(null);
  const e = await assertRejects(() => requireParent(bearer(parentToken()), bad, { now: NOW }), ApiError);
  assertEquals((e as ApiError).code, "unauthorized");
});

Deno.test("requireParent: token whose sub differs from the verified user is rejected (substitution)", async () => {
  const other: ParentTokenVerifier = () => Promise.resolve({ id: "someone-else" });
  await assertRejects(() => requireParent(bearer(parentToken()), other, { now: NOW }), ApiError);
});

Deno.test("requireParent: anon / service_role / custom roles are not user sessions", async () => {
  for (const role of ["anon", "service_role", "admin", undefined]) {
    const calls: string[] = [];
    await assertRejects(() => requireParent(bearer(parentToken({ role })), okVerifier(calls), { now: NOW }), ApiError);
    assertEquals(calls.length, 0);
  }
  await assertRejects(() => requireParent(bearer(parentToken({ sub: undefined })), okVerifier(), { now: NOW }), ApiError);
});

Deno.test("requireParent: infrastructure failure propagates (never treated as authenticated)", async () => {
  const down: ParentTokenVerifier = () => Promise.reject(new Error("auth_verify_unavailable"));
  await assertRejects(() => requireParent(bearer(parentToken()), down, { now: NOW }), Error);
  assertEquals(toErrorResponse(new Error("auth_verify_unavailable")).status, 500);
});

Deno.test("requireParent: requireAal2 enforces the second factor", async () => {
  const e = await assertRejects(() => requireParent(bearer(parentToken({ aal: "aal1" })), okVerifier(), { now: NOW, requireAal2: true }), ApiError);
  assertEquals((e as ApiError).code, "forbidden");
  const p = await requireParent(bearer(parentToken({ aal: "aal2" })), okVerifier(), { now: NOW, requireAal2: true });
  assertEquals(p.aal, "aal2");
});
