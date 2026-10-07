import { assert, assertEquals, fakeJwt } from "../_shared/test_util.ts";
import { signDeviceJwt } from "../_shared/auth.ts";
import { resetRateLimits } from "../_shared/ratelimit.ts";
import { PERMISSION_KEYS, PERMISSION_STATES, type PermissionSync } from "../_shared/permissions.ts";
import { type Deps, handler, type PermissionSyncOutcome } from "./handler.ts";

const SECRET = "s".repeat(40);
const DEVICE = "d0000000-0000-4000-8000-0000000000aa";
const OTHER = "d0000000-0000-4000-8000-0000000000bb";
const CRED = "e0000000-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-09-30T12:00:00Z");
const STATES: PermissionSync = {
  camera: "GRANTED", microphone: "DENIED", contacts: "NOT_REQUESTED", sms: "NOT_AVAILABLE",
  call_log: "NOT_AVAILABLE", location: "GRANTED", precise_location: "GRANTED", background_location: "REVOKED",
};

class Fake {
  active = new Set<string>([`${DEVICE}:${CRED}`, `${OTHER}:${CRED}`]);
  recorded: { deviceId: string; states: PermissionSync }[] = [];
  authChecks = 0;
  outcome: PermissionSyncOutcome = { outcome: "recorded", changed: 3 };
  failRecord = false;
  failAuth = false;
  isActive = (d: string, c: string) => {
    this.authChecks++;
    if (this.failAuth) return Promise.reject(new Error("db down: secret detail"));
    return Promise.resolve(this.active.has(`${d}:${c}`));
  };
  record = (deviceId: string, states: PermissionSync) => {
    if (this.failRecord) return Promise.reject(new Error("rpc_failed: password=hunter2"));
    this.recorded.push({ deviceId, states });
    return Promise.resolve(this.outcome);
  };
}

function setup() {
  resetRateLimits();
  const fake = new Fake();
  const deps: Deps = { deviceJwtSecret: SECRET, isActive: fake.isActive, record: fake.record, now: () => NOW };
  return { fake, deps };
}

const token = (sub = DEVICE, cid: string | null = CRED) =>
  signDeviceJwt({ sub, ...(cid ? { cid } : {}), jti: crypto.randomUUID() }, SECRET, Math.floor(NOW / 1000));

async function call(deps: Deps, o: { token?: string | null; body?: unknown; raw?: string; ip?: string; method?: string } = {}) {
  const method = o.method ?? "POST";
  const t = o.token === undefined ? await token() : o.token;
  return handler(new Request("http://localhost/device-permissions", {
    method,
    headers: {
      "content-type": "application/json",
      ...(t ? { authorization: `Bearer ${t}` } : {}),
      ...(o.ip ? { "x-forwarded-for": o.ip } : {}),
    },
    body: method === "POST" ? (o.raw ?? JSON.stringify("body" in o ? o.body : STATES)) : undefined,
  }), deps);
}

Deno.test("device-permissions: valid sync -> 200, recorded for the device in the token, minimal response", async () => {
  const { fake, deps } = setup();
  const r = await call(deps);
  assertEquals(r.status, 200);
  assertEquals(r.headers.get("cache-control"), "no-store");
  const { data } = await r.json();
  assertEquals(data.next_interval_seconds, 21600);
  assertEquals(data.server_time, "2026-09-30T12:00:00.000Z");
  assertEquals(Object.keys(data).sort(), ["next_interval_seconds", "server_time"]); // never says what changed
  assertEquals(fake.recorded, [{ deviceId: DEVICE, states: STATES }]);
});

Deno.test("device-permissions: every catalog state is accepted for every key", async () => {
  const { fake, deps } = setup();
  for (const key of PERMISSION_KEYS) {
    for (const state of PERMISSION_STATES) {
      resetRateLimits();
      assertEquals((await call(deps, { body: { ...STATES, [key]: state } })).status, 200);
    }
  }
  assertEquals(fake.recorded.length, PERMISSION_KEYS.length * PERMISSION_STATES.length);
});

Deno.test("device-permissions: the live credential check runs on every request", async () => {
  const { fake, deps } = setup();
  await call(deps);
  await call(deps);
  assertEquals(fake.authChecks, 2);
});

Deno.test("device-permissions: no / malformed / forged / parent / cid-less tokens -> identical 401, nothing recorded", async () => {
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
  assertEquals(fake.recorded.length, 0);
});

Deno.test("device-permissions: revoked / unknown credential -> 401 and nothing recorded", async () => {
  const { fake, deps } = setup();
  fake.active.clear();
  const r = await call(deps);
  assertEquals(r.status, 401);
  assertEquals(fake.recorded.length, 0);
});

Deno.test("device-permissions: revoked between guard and write (record says inactive) -> the same 401 body", async () => {
  const a = setup();
  a.fake.active.clear();
  const first = await (await call(a.deps)).text();
  const b = setup();
  b.fake.outcome = { outcome: "inactive", changed: 0 };
  const r = await call(b.deps);
  assertEquals(r.status, 401);
  assertEquals(await r.text(), first);
});

Deno.test("device-permissions: the body can never name a device or add fields (strict)", async () => {
  const { fake, deps } = setup();
  for (const body of [{ ...STATES, device_id: OTHER }, { ...STATES, notifications: "GRANTED" }, { ...STATES, imei: "1" }]) {
    resetRateLimits();
    assertEquals((await call(deps, { body })).status, 400);
  }
  assertEquals(fake.recorded.length, 0);
});

Deno.test("device-permissions: validation rejects bad values and bodies", async () => {
  const { fake, deps } = setup();
  const { sms: _sms, ...missingSms } = STATES;
  const bad: unknown[] = [
    { ...STATES, camera: "MAYBE" }, { ...STATES, camera: "granted" }, { ...STATES, camera: true }, { ...STATES, camera: null },
    { ...STATES, camera: 1 }, { ...STATES, camera: "" }, { ...STATES, camera: ["GRANTED"] }, { ...STATES, camera: { s: "GRANTED" } },
    missingSms, { camera: "GRANTED" }, {}, [], null, "GRANTED",
  ];
  for (const body of bad) {
    resetRateLimits();
    assertEquals((await call(deps, { body })).status, 400);
  }
  resetRateLimits();
  assertEquals((await call(deps, { raw: "{not json" })).status, 400);
  assertEquals(fake.recorded.length, 0);
});

Deno.test("device-permissions: only POST", async () => {
  const { deps } = setup();
  assertEquals((await call(deps, { method: "GET" })).status, 400);
});

Deno.test("device-permissions: per-device limit is 12 per window; another device is unaffected", async () => {
  const { fake, deps } = setup();
  for (let i = 0; i < 12; i++) assertEquals((await call(deps, { ip: `10.0.0.${i}` })).status, 200);
  const limited = await call(deps, { ip: "10.0.1.1" });
  assertEquals(limited.status, 429);
  assert(Number(limited.headers.get("retry-after")) > 0);
  assertEquals(fake.recorded.length, 12);
  assertEquals((await call(deps, { token: await token(OTHER), ip: "10.0.1.2" })).status, 200);
});

Deno.test("device-permissions: the pre-auth IP limit stops floods before any token or database work", async () => {
  const { fake, deps } = setup();
  for (let i = 0; i < 60; i++) await call(deps, { token: null, ip: "203.0.113.9" });
  const checksBefore = fake.authChecks;
  const r = await call(deps, { token: await token(), ip: "203.0.113.9" });
  assertEquals(r.status, 429);
  assertEquals(fake.authChecks, checksBefore);
});

Deno.test("device-permissions: database failures are sanitized 500s that never leak details or read as valid", async () => {
  const a = setup();
  a.fake.failAuth = true;
  const ra = await call(a.deps);
  assertEquals(ra.status, 500);
  assert(!(await ra.text()).includes("secret detail"));
  assertEquals(a.fake.recorded.length, 0);

  const b = setup();
  b.fake.failRecord = true;
  const rb = await call(b.deps);
  assertEquals(rb.status, 500);
  assert(!(await rb.text()).includes("hunter2"));
});

Deno.test("device-permissions: logs never contain tokens or permission states", async () => {
  const { deps } = setup();
  const seen: string[] = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  console.log = console.error = console.warn = console.info = (...a: unknown[]) => { seen.push(a.map(String).join(" ")); };
  try {
    const t = await token();
    await call(deps, { token: t });
    resetRateLimits();
    await call(deps, { token: t, body: { ...STATES, camera: "BAD" } });
    const joined = seen.join("\n");
    assert(!joined.includes(t));
    assert(!joined.includes("GRANTED"));
  } finally {
    Object.assign(console, orig);
  }
});
