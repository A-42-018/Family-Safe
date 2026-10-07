import { assert, assertEquals } from "../_shared/test_util.ts";
import { verifyDeviceJwt } from "../_shared/auth.ts";
import { hashRefreshToken } from "../_shared/enrollment.ts";
import { resetRateLimits } from "../_shared/ratelimit.ts";
import { type Deps, handler, type RefreshArgs, type RefreshOutcome } from "./handler.ts";

const SECRET = "s".repeat(40);
const DEVICE = "d0000000-0000-4000-8000-0000000000aa";
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const OLD = "A".repeat(43);

/** In-memory stand-in for `device_refresh`: one synchronous check-and-set per call, rotation chain, reuse -> family revoked
 *  (the SQL itself is pgTAP-tested and was raced on a real PostgreSQL). */
class FakeStore {
  creds = new Map<string, { id: string; rotated: boolean; revoked: boolean; expiresAt: number }>();
  calls: RefreshArgs[] = [];
  clock = Date.now();
  seq = 0;
  async add(token: string, expiresInMs = 30 * 24 * 3600_000) {
    this.creds.set(hex(await hashRefreshToken(token)), { id: `e0000000-0000-4000-8000-${String(++this.seq).padStart(12, "0")}`, rotated: false, revoked: false, expiresAt: this.clock + expiresInMs });
  }
  refresh = (a: RefreshArgs): Promise<RefreshOutcome> => {
    this.calls.push(a);
    const c = this.creds.get(hex(a.tokenHash));
    if (!c || c.revoked || c.expiresAt <= this.clock) return Promise.resolve({ outcome: "invalid" });
    if (c.rotated) { for (const x of this.creds.values()) x.revoked = true; return Promise.resolve({ outcome: "reused" }); }
    c.rotated = true;
    const id = `e0000000-0000-4000-8000-${String(++this.seq).padStart(12, "0")}`;
    this.creds.set(hex(a.newHash), { id, rotated: false, revoked: false, expiresAt: this.clock + a.ttlSeconds * 1000 });
    return Promise.resolve({ outcome: "rotated", deviceId: DEVICE, credentialId: id });
  };
}

async function setup() {
  resetRateLimits();
  const store = new FakeStore();
  await store.add(OLD);
  const deps: Deps = { deviceJwtSecret: SECRET, refresh: store.refresh, now: () => store.clock };
  return { store, deps };
}

const call = (deps: Deps, o: { body?: unknown; ip?: string; headers?: Record<string, string>; method?: string; raw?: string } = {}) => {
  const method = o.method ?? "POST";
  return handler(new Request("http://localhost/device-refresh", {
    method,
    headers: { "content-type": "application/json", ...(o.ip ? { "x-forwarded-for": o.ip } : {}), ...o.headers },
    body: method === "POST" ? (o.raw ?? JSON.stringify("body" in o ? o.body : { refresh_token: OLD })) : undefined,
  }), deps);
};

Deno.test("device-refresh: valid token -> 200 with new access JWT (cid = new credential, 15 min) and a NEW refresh token", async () => {
  const { store, deps } = await setup();
  const r = await call(deps);
  assertEquals(r.status, 200);
  assertEquals(r.headers.get("cache-control"), "no-store");
  const { data } = await r.json();
  assertEquals(data.device_id, DEVICE);
  assertEquals(data.token_type, "Bearer");
  assertEquals(data.access_expires_in, 900);
  const claims = await verifyDeviceJwt(data.access_token, SECRET, Math.floor(store.clock / 1000));
  assertEquals(claims.sub, DEVICE);
  assertEquals(claims.cid, store.creds.get(hex(await hashRefreshToken(data.refresh_token)))!.id);
  assertEquals(claims.exp - claims.iat, 900);
  assert(/^[A-Za-z0-9_-]{43}$/.test(data.refresh_token) && data.refresh_token !== OLD);
  assertEquals(Date.parse(data.refresh_expires_at), store.clock + 30 * 24 * 3600 * 1000);
});

Deno.test("device-refresh: store receives only hashes; the new hash matches the returned token", async () => {
  const { store, deps } = await setup();
  const { data } = await (await call(deps)).json();
  const a = store.calls[0];
  assertEquals(hex(a.tokenHash), hex(await hashRefreshToken(OLD)));
  assertEquals(hex(a.newHash), hex(await hashRefreshToken(data.refresh_token)));
  assertEquals(a.ttlSeconds, 30 * 24 * 3600);
  const serialized = JSON.stringify(a, (_k, v) => (v instanceof Uint8Array ? hex(v) : v));
  assert(!serialized.includes(OLD) && !serialized.includes(data.refresh_token));
});

Deno.test("device-refresh: the chain keeps working; the old token no longer does", async () => {
  const { deps } = await setup();
  const a = (await (await call(deps, { ip: "10.0.0.1" })).json()).data;
  const b = await call(deps, { ip: "10.0.0.2", body: { refresh_token: a.refresh_token } });
  assertEquals(b.status, 200);
  assertEquals((await call(deps, { ip: "10.0.0.3" })).status, 401); // OLD replayed
});

Deno.test("device-refresh: unknown, expired, revoked and replayed tokens fail identically (401, same body)", async () => {
  const { store, deps } = await setup();
  await store.add("B".repeat(43), 1000);
  await store.add("C".repeat(43));
  store.creds.get(hex(await hashRefreshToken("C".repeat(43))))!.revoked = true;
  store.clock += 5000;
  assertEquals((await call(deps, { ip: "10.1.0.1" })).status, 200); // rotate OLD once so it can be replayed
  const replay = await call(deps, { ip: "10.1.0.2" });
  const unknown = await call(deps, { ip: "10.1.0.3", body: { refresh_token: "Z".repeat(43) } });
  const expired = await call(deps, { ip: "10.1.0.4", body: { refresh_token: "B".repeat(43) } });
  const revoked = await call(deps, { ip: "10.1.0.5", body: { refresh_token: "C".repeat(43) } });
  const texts: string[] = [];
  for (const r of [replay, unknown, expired, revoked]) { assertEquals(r.status, 401); texts.push(await r.text()); }
  assert(texts.every((t) => t === texts[0]), "bodies must be identical");
  assert(!/reuse|replay|revoked|expired token|rotated/i.test(texts[0]));
});

Deno.test("device-refresh: replay revokes the family — even the newest token stops working", async () => {
  const { deps } = await setup();
  const fresh = (await (await call(deps, { ip: "10.2.0.1" })).json()).data.refresh_token;
  assertEquals((await call(deps, { ip: "10.2.0.2" })).status, 401); // OLD replayed -> family revoked
  assertEquals((await call(deps, { ip: "10.2.0.3", body: { refresh_token: fresh } })).status, 401);
});

Deno.test("device-refresh: reuse is logged without ids or token material", async () => {
  const { deps } = await setup();
  await call(deps, { ip: "10.3.0.1" });
  const logged: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => { logged.push(a.map(String).join(" ")); };
  try { await call(deps, { ip: "10.3.0.2" }); } finally { console.warn = orig; }
  assertEquals(logged, ["device_refresh_reuse"]);
});

Deno.test("device-refresh: concurrent refreshes of one token never mint two live tokens", async () => {
  const { store, deps } = await setup();
  const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => call(deps, { ip: `10.4.0.${i + 1}` })));
  assertEquals(rs.filter((r) => r.status === 200).length, 1);
  assertEquals(rs.filter((r) => r.status === 401).length, 19);
  const live = [...store.creds.values()].filter((c) => !c.rotated && !c.revoked).length;
  assertEquals(live, 0); // the 19 replays revoked the family, including the token the winner received
});

Deno.test("device-refresh: rate limit is per IP (60 / 5 min), counts failures and does not affect other IPs", async () => {
  const { deps } = await setup();
  for (let i = 0; i < 60; i++) assertEquals((await call(deps, { ip: "203.0.113.7", body: { refresh_token: "Z".repeat(43) } })).status, 401);
  const locked = await call(deps, { ip: "203.0.113.7", body: { refresh_token: "Z".repeat(43) } });
  assertEquals(locked.status, 429);
  assert(Number(locked.headers.get("retry-after")) > 0);
  assertEquals((await call(deps, { ip: "203.0.113.8" })).status, 200);
});

Deno.test("device-refresh: an Authorization header (parent or device JWT) is never read", async () => {
  const { deps } = await setup();
  const r = await call(deps, { ip: "10.5.0.1", headers: { authorization: "Bearer not.a.jwt" } });
  assertEquals(r.status, 200);
});

Deno.test("device-refresh: malformed bodies -> 400 and never reach the store", async () => {
  const { store, deps } = await setup();
  const bodies: unknown[] = [
    {}, { refresh_token: "" }, { refresh_token: "short" }, { refresh_token: "A".repeat(42) }, { refresh_token: "A".repeat(44) },
    { refresh_token: "A".repeat(42) + "=" }, { refresh_token: "A".repeat(42) + "+" }, { refresh_token: 123 }, { refresh_token: null },
    { refresh_token: OLD, device_id: DEVICE }, { refresh_token: OLD, extra: 1 }, [], "string", null,
  ];
  let i = 0;
  for (const body of bodies) assertEquals((await call(deps, { body, ip: `10.6.0.${++i}` })).status, 400);
  assertEquals((await call(deps, { raw: "{not json", ip: "10.6.1.1" })).status, 400);
  assertEquals((await call(deps, { headers: { "content-type": "text/plain" }, ip: "10.6.1.2" })).status, 400);
  assertEquals((await call(deps, { method: "GET", ip: "10.6.1.3" })).status, 400);
  assertEquals(store.calls.length, 0);
});

Deno.test("device-refresh: validation errors never echo the submitted token", async () => {
  const { deps } = await setup();
  const r = await call(deps, { body: { refresh_token: "SECRETSECRETSECRET" } });
  assertEquals(r.status, 400);
  assert(!(await r.text()).includes("SECRETSECRET"));
});

Deno.test("device-refresh: store failure -> sanitized 500, nothing sensitive logged, no token issued", async () => {
  const { deps } = await setup();
  deps.refresh = () => Promise.reject(new Error(`db exploded for ${OLD}`));
  const logged: string[] = [];
  const orig = { e: console.error, l: console.log, w: console.warn };
  console.error = (...a: unknown[]) => { logged.push(a.map(String).join(" ")); };
  console.log = (...a: unknown[]) => { logged.push(a.map(String).join(" ")); };
  console.warn = (...a: unknown[]) => { logged.push(a.map(String).join(" ")); };
  try {
    const r = await call(deps);
    assertEquals(r.status, 500);
    const text = await r.text();
    assert(!text.includes("exploded") && !text.includes(OLD) && !text.includes("access_token"));
  } finally { console.error = orig.e; console.log = orig.l; console.warn = orig.w; }
  assert(logged.length > 0 && logged.every((l) => !l.includes(OLD) && !l.includes("exploded")));
});

Deno.test("device-refresh: CORS preflight answered; no wildcard origin", async () => {
  const { deps } = await setup();
  const r = await handler(new Request("http://localhost/device-refresh", { method: "OPTIONS", headers: { origin: "https://evil.example" } }), deps);
  assertEquals(r.status, 204);
  assertEquals(r.headers.get("access-control-allow-origin"), null);
});
