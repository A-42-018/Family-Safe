import { assert, assertEquals, fakeJwt } from "../_shared/test_util.ts";
import { signDeviceJwt } from "../_shared/auth.ts";
import { resetRateLimits } from "../_shared/ratelimit.ts";
import { type Deps, handler, type RegisterOutcome } from "./handler.ts";

const SECRET = "s".repeat(40);
const DEVICE = "d0000000-0000-4000-8000-0000000000aa";
const OTHER = "d0000000-0000-4000-8000-0000000000bb";
const CRED = "e0000000-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-10-01T12:00:00Z");
const TOKEN = "fGh1:APA91bHx_-.abcdefghijklmnopqrstuvwxyz0123456789";
const BODY = { token: TOKEN };

class Fake {
  active = new Set<string>([`${DEVICE}:${CRED}`, `${OTHER}:${CRED}`]);
  registered: { deviceId: string; token: string }[] = [];
  authChecks = 0;
  outcome: RegisterOutcome = { outcome: "registered" };
  failRegister = false;
  isActive = (d: string, c: string) => {
    this.authChecks++;
    return Promise.resolve(this.active.has(`${d}:${c}`));
  };
  register = (deviceId: string, token: string) => {
    if (this.failRegister) return Promise.reject(new Error("rpc_failed: password=hunter2"));
    this.registered.push({ deviceId, token });
    return Promise.resolve(this.outcome);
  };
}

function setup() {
  resetRateLimits();
  const fake = new Fake();
  const deps: Deps = { deviceJwtSecret: SECRET, isActive: fake.isActive, register: fake.register, now: () => NOW };
  return { fake, deps };
}

const token = (sub = DEVICE, cid: string | null = CRED) =>
  signDeviceJwt({ sub, ...(cid ? { cid } : {}), jti: crypto.randomUUID() }, SECRET, Math.floor(NOW / 1000));

async function call(deps: Deps, o: { token?: string | null; body?: unknown; raw?: string; method?: string } = {}) {
  const method = o.method ?? "POST";
  const t = o.token === undefined ? await token() : o.token;
  return handler(new Request("http://localhost/device-fcm-token", {
    method,
    headers: { "content-type": "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}) },
    body: method === "POST" ? (o.raw ?? JSON.stringify("body" in o ? o.body : BODY)) : undefined,
  }), deps);
}

Deno.test("device-fcm-token: valid token -> 200, registered for the device in the token, minimal response", async () => {
  const { fake, deps } = setup();
  const r = await call(deps);
  assertEquals(r.status, 200);
  assertEquals(r.headers.get("cache-control"), "no-store");
  const { data } = await r.json();
  assertEquals(Object.keys(data), ["server_time"]);
  assertEquals(JSON.stringify(data).includes(TOKEN), false); // the token is never echoed
  assertEquals(fake.registered, [{ deviceId: DEVICE, token: TOKEN }]);
});

Deno.test("device-fcm-token: 'unchanged' is also a 200", async () => {
  const { fake, deps } = setup();
  fake.outcome = { outcome: "unchanged" };
  assertEquals((await call(deps)).status, 200);
});

Deno.test("device-fcm-token: only POST is accepted", async () => {
  const { fake, deps } = setup();
  assertEquals((await call(deps, { method: "GET" })).status, 400);
  assertEquals(fake.registered.length, 0);
});

Deno.test("device-fcm-token: token length and characters are enforced; extra keys and a device id are rejected", async () => {
  const { fake, deps } = setup();
  const bad: unknown[] = [
    { token: "a".repeat(19) }, { token: "a".repeat(4097) }, { token: `${TOKEN} x` }, { token: `${TOKEN}\n` }, { token: `${TOKEN}'` }, { token: `${TOKEN}/x` },
    { token: "" }, { token: null }, { token: 5 }, {}, [], null, "token", { token: TOKEN, device_id: OTHER }, { token: TOKEN, extra: 1 },
  ];
  for (const body of bad) {
    resetRateLimits();
    assertEquals((await call(deps, { body })).status, 400);
  }
  resetRateLimits();
  assertEquals((await call(deps, { raw: "{not json" })).status, 400);
  resetRateLimits();
  assertEquals((await call(deps, { body: { token: "a".repeat(20) } })).status, 200);
  resetRateLimits();
  assertEquals((await call(deps, { body: { token: "a".repeat(4096) } })).status, 200);
  assertEquals(fake.registered.length, 2);
});

Deno.test("device-fcm-token: the live credential check runs on every request", async () => {
  const { fake, deps } = setup();
  await call(deps);
  await call(deps);
  assertEquals(fake.authChecks, 2);
});

Deno.test("device-fcm-token: no / malformed / forged / parent / cid-less tokens -> identical 401, nothing registered", async () => {
  const { fake, deps } = setup();
  const forged = (await token()).slice(0, -3) + "AAA";
  const cases: (string | null)[] = [null, "not-a-jwt", forged, fakeJwt({ sub: DEVICE, role: "authenticated", exp: 9999999999, iat: 1 }), await token(DEVICE, null)];
  const bodies: string[] = [];
  for (const t of cases) {
    const r = await call(deps, { token: t });
    assertEquals(r.status, 401);
    bodies.push(JSON.stringify((await r.json()).error.code));
  }
  assert(bodies.every((b) => b === bodies[0]));
  assertEquals(fake.registered.length, 0);
});

Deno.test("device-fcm-token: revoked credential -> 401 before validation; revoked mid-request -> the same 401 body", async () => {
  const a = setup();
  a.fake.active.clear();
  const expected = await (await call(a.deps)).json();
  assertEquals((await call(a.deps, { body: {} })).status, 401);
  const b = setup();
  b.fake.outcome = { outcome: "inactive" };
  const r = await call(b.deps);
  assertEquals(r.status, 401);
  assertEquals(await r.json(), expected);
});

Deno.test("device-fcm-token: the device id comes from the token, never from the body", async () => {
  const { fake, deps } = setup();
  assertEquals((await call(deps, { token: await token(OTHER) })).status, 200);
  assertEquals(fake.registered[0]?.deviceId, OTHER);
});

Deno.test("device-fcm-token: per-device limit is 12 an hour", async () => {
  const { deps } = setup();
  for (let i = 0; i < 12; i++) assertEquals((await call(deps)).status, 200);
  const r = await call(deps);
  assertEquals(r.status, 429);
  assert(r.headers.get("retry-after") !== null);
  assertEquals((await call(deps, { token: await token(OTHER) })).status, 200);
});

Deno.test("device-fcm-token: a database failure is a sanitized 500 with no detail and no token", async () => {
  const { fake, deps } = setup();
  fake.failRegister = true;
  const r = await call(deps);
  assertEquals(r.status, 500);
  const text = JSON.stringify(await r.json());
  assert(!text.includes("hunter2") && !text.includes("rpc_failed") && !text.includes(TOKEN));
});
