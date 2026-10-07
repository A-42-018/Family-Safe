import { assert, assertEquals, fakeJwt } from "../_shared/test_util.ts";
import { verifyDeviceJwt } from "../_shared/auth.ts";
import { hashPairingCode, hashRefreshToken } from "../_shared/enrollment.ts";
import { resetRateLimits } from "../_shared/ratelimit.ts";
import { type Deps, handler, type RedeemArgs } from "./handler.ts";

const PEPPER = "p".repeat(40);
const SECRET = "s".repeat(40);
const CODE = "0123456789ABCDEF";
const DEVICE = "d0000000-0000-4000-8000-0000000000aa";
const CRED = "e0000000-0000-4000-8000-0000000000aa";
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

/** In-memory stand-in for `enrollment_redeem`: atomic check-and-set, expiry, single use (the SQL itself is pgTAP-tested). */
class FakeStore {
  tokens = new Map<string, { expiresAt: number; consumed: boolean; childId: string }>();
  redeemed: RedeemArgs[] = [];
  clock = Date.now();
  async add(code: string, ttlMs = 600_000, childId = "child-a") {
    this.tokens.set(hex(await hashPairingCode(code, PEPPER)), { expiresAt: this.clock + ttlMs, consumed: false, childId });
  }
  redeem = (a: RedeemArgs): Promise<{ deviceId: string; credentialId: string } | null> => {
    const t = this.tokens.get(hex(a.tokenHash));
    if (!t || t.consumed || t.expiresAt <= this.clock) return Promise.resolve(null);
    t.consumed = true; // synchronous: no await between check and set, like the single UPDATE ... WHERE consumed_at IS NULL
    this.redeemed.push(a);
    return Promise.resolve({ deviceId: DEVICE, credentialId: CRED });
  };
}

async function setup() {
  resetRateLimits();
  const store = new FakeStore();
  await store.add(CODE);
  const deps: Deps = { pairingPepper: PEPPER, deviceJwtSecret: SECRET, redeem: store.redeem, now: () => store.clock };
  return { store, deps };
}

const call = (deps: Deps, o: { body?: unknown; ip?: string; headers?: Record<string, string>; method?: string; raw?: string } = {}) => {
  const method = o.method ?? "POST";
  return handler(new Request("http://localhost/enrollment-redeem", {
    method,
    headers: { "content-type": "application/json", ...(o.ip ? { "x-forwarded-for": o.ip } : {}), ...o.headers },
    body: method === "POST" ? (o.raw ?? JSON.stringify("body" in o ? o.body : { code: CODE, device_name: "Pixel 8", manufacturer: "Google", model: "Pixel 8", android_version: "15", app_version: "0.1.0" })) : undefined,
  }), deps);
};

Deno.test("enrollment-redeem: valid code -> 201 with device id, access JWT (cid, 15 min) and refresh token", async () => {
  const { store, deps } = await setup();
  const r = await call(deps);
  assertEquals(r.status, 201);
  assertEquals(r.headers.get("cache-control"), "no-store");
  const { data } = await r.json();
  assertEquals(data.device_id, DEVICE);
  assertEquals(data.token_type, "Bearer");
  assertEquals(data.access_expires_in, 900);
  const claims = await verifyDeviceJwt(data.access_token, SECRET, Math.floor(store.clock / 1000));
  assertEquals(claims.sub, DEVICE);
  assertEquals(claims.cid, CRED);
  assertEquals(claims.role, "device");
  assertEquals(claims.exp - claims.iat, 900);
  assert(typeof claims.jti === "string" && claims.jti.length > 0);
  assert(/^[A-Za-z0-9_-]{43}$/.test(data.refresh_token));
  const expiresMs = Date.parse(data.refresh_expires_at);
  assertEquals(expiresMs, store.clock + 30 * 24 * 3600 * 1000);
});

Deno.test("enrollment-redeem: store receives only hashes; refresh hash matches the returned token", async () => {
  const { store, deps } = await setup();
  const { data } = await (await call(deps)).json();
  const a = store.redeemed[0];
  assertEquals(hex(a.tokenHash), hex(await hashPairingCode(CODE, PEPPER)));
  assertEquals(hex(a.refreshHash), hex(await hashRefreshToken(data.refresh_token)));
  assertEquals(a.refreshTtlSeconds, 30 * 24 * 3600);
  assertEquals([a.deviceName, a.manufacturer, a.model, a.androidVersion, a.appVersion], ["Pixel 8", "Google", "Pixel 8", "15", "0.1.0"]);
  const serialized = JSON.stringify(a, (_k, v) => (v instanceof Uint8Array ? hex(v) : v));
  assert(!serialized.includes(CODE) && !serialized.includes(data.refresh_token));
  assert(!data.access_token.includes(CODE));
});

Deno.test("enrollment-redeem: code accepted in formatted, lowercase and alias spellings", async () => {
  for (const spelling of ["0123-4567-89AB-CDEF", "0123-4567-89ab-cdef", " O123 4567 89ab cdef "]) {
    const { deps } = await setup();
    assertEquals((await call(deps, { body: { code: spelling, device_name: "P" } })).status, 201);
  }
});

Deno.test("enrollment-redeem: replay, unknown and expired codes fail identically (401, same body)", async () => {
  const { store, deps } = await setup();
  assertEquals((await call(deps, { ip: "10.0.0.1" })).status, 201);
  const replay = await call(deps, { ip: "10.0.0.2" });
  const unknown = await call(deps, { ip: "10.0.0.3", body: { code: "ZZZZZZZZZZZZZZZZ", device_name: "P" } });
  await store.add("ABCDEFGHJKMNPQRS", 1000);
  store.clock += 5000;
  const expired = await call(deps, { ip: "10.0.0.4", body: { code: "ABCDEFGHJKMNPQRS", device_name: "P" } });
  for (const r of [replay, unknown, expired]) assertEquals(r.status, 401);
  const [a, b, c] = [await replay.text(), await unknown.text(), await expired.text()];
  assertEquals(a, b);
  assertEquals(b, c);
  assert(!a.toLowerCase().includes("expired code") && !a.includes("consumed"));
  assertEquals(store.redeemed.length, 1);
});

Deno.test("enrollment-redeem: exactly one of many concurrent redeems wins", async () => {
  const { store, deps } = await setup();
  const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => call(deps, { ip: `10.1.0.${i + 1}` })));
  assertEquals(rs.filter((r) => r.status === 201).length, 1);
  assertEquals(rs.filter((r) => r.status === 401).length, 19);
  assertEquals(store.redeemed.length, 1);
});

Deno.test("enrollment-redeem: guessing lockout — 5 attempts / 5 min / IP, then even the right code is refused", async () => {
  const { deps } = await setup();
  for (let i = 0; i < 5; i++) {
    const r = await call(deps, { ip: "203.0.113.50", body: { code: `ABCDEFGHJKMNPQR${"STVWXYZ"[i]}`, device_name: "P" } });
    assertEquals(r.status, 401);
  }
  const locked = await call(deps, { ip: "203.0.113.50" }); // correct code, same IP
  assertEquals(locked.status, 429);
  assert(Number(locked.headers.get("retry-after")) > 0);
  assertEquals((await call(deps, { ip: "203.0.113.51" })).status, 201); // other IP unaffected
});

Deno.test("enrollment-redeem: a parent or device JWT in Authorization changes nothing (header is never read)", async () => {
  const { deps } = await setup();
  const parent = fakeJwt({ sub: "parent-1", role: "authenticated", exp: 9999999999 });
  const device = fakeJwt({ sub: DEVICE, role: "device", exp: 9999999999 });
  const bad = await call(deps, { ip: "10.2.0.1", headers: { authorization: `Bearer ${device}` }, body: { code: "ZZZZZZZZZZZZZZZZ", device_name: "P" } });
  assertEquals(bad.status, 401); // not 403: the header played no role
  const good = await call(deps, { ip: "10.2.0.2", headers: { authorization: `Bearer ${parent}` } });
  assertEquals(good.status, 201);
});

Deno.test("enrollment-redeem: validation errors never reach the store", async () => {
  const { store, deps } = await setup();
  const bodies: unknown[] = [
    {}, { code: CODE }, { device_name: "P" }, { code: "short", device_name: "P" }, { code: CODE, device_name: "   " },
    { code: CODE, device_name: "x".repeat(101) }, { code: CODE, device_name: "P", child_id: "c0000000-0000-4000-8000-00000000000b" },
    { code: CODE, device_name: "P", enrollment_status: "ENROLLED" }, { code: CODE, device_name: "P", device_id: DEVICE },
    { code: 1234567890123456, device_name: "P" }, [], "string", null,
  ];
  let i = 0;
  for (const body of bodies) assertEquals((await call(deps, { body, ip: `10.3.0.${++i}` })).status, 400);
  assertEquals((await call(deps, { raw: "{not json", ip: "10.3.1.1" })).status, 400);
  assertEquals((await call(deps, { raw: JSON.stringify({ code: CODE, device_name: "x".repeat(70_000) }), ip: "10.3.1.2" })).status, 400);
  assertEquals((await call(deps, { headers: { "content-type": "text/plain" }, ip: "10.3.1.3" })).status, 400);
  assertEquals((await call(deps, { method: "GET", ip: "10.3.1.4" })).status, 400);
  assertEquals(store.redeemed.length, 0);
});

Deno.test("enrollment-redeem: validation error details never echo the submitted code", async () => {
  const { deps } = await setup();
  const r = await call(deps, { body: { code: "SECRETSECRETSEC!", device_name: "P" } });
  assertEquals(r.status, 400);
  assert(!(await r.text()).includes("SECRETSECRETSEC"));
});

Deno.test("enrollment-redeem: store failure -> sanitized 500 and nothing sensitive is logged", async () => {
  const { deps } = await setup();
  deps.redeem = () => Promise.reject(new Error(`db exploded for ${CODE}`));
  const logged: string[] = [];
  const orig = { e: console.error, l: console.log, w: console.warn };
  console.error = (...a: unknown[]) => { logged.push(a.map(String).join(" ")); };
  console.log = (...a: unknown[]) => { logged.push(a.map(String).join(" ")); };
  console.warn = (...a: unknown[]) => { logged.push(a.map(String).join(" ")); };
  try {
    const r = await call(deps);
    assertEquals(r.status, 500);
    const text = await r.text();
    assert(!text.includes("exploded") && !text.includes(CODE));
  } finally {
    console.error = orig.e; console.log = orig.l; console.warn = orig.w;
  }
  assert(logged.length > 0, "the failure is logged (error name only)");
  assert(logged.every((l) => !l.includes(CODE) && !l.includes("exploded")), "logs must not contain the code or the error message");
});

Deno.test("enrollment-redeem: CORS preflight answered; no wildcard origin", async () => {
  const { deps } = await setup();
  const r = await handler(new Request("http://localhost/enrollment-redeem", { method: "OPTIONS", headers: { origin: "https://evil.example" } }), deps);
  assertEquals(r.status, 204);
  assertEquals(r.headers.get("access-control-allow-origin"), null);
});
