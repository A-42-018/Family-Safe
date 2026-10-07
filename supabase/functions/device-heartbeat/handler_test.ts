import { assert, assertEquals } from "../_shared/test_util.ts";
import { fakeJwt } from "../_shared/test_util.ts";
import { signDeviceJwt } from "../_shared/auth.ts";
import { resetRateLimits } from "../_shared/ratelimit.ts";
import type { Heartbeat } from "../_shared/heartbeat.ts";
import { type Deps, handler, type HeartbeatOutcome } from "./handler.ts";

const SECRET = "s".repeat(40);
const DEVICE = "d0000000-0000-4000-8000-0000000000aa";
const OTHER = "d0000000-0000-4000-8000-0000000000bb";
const CRED = "e0000000-0000-4000-8000-000000000001";
const BEAT: Heartbeat = { app_version: "0.12.0", android_version: "16", battery_level: 80, is_charging: false, network_type: "WIFI" };

class Fake {
  active = new Set<string>([`${DEVICE}:${CRED}`, `${OTHER}:${CRED}`]);
  recorded: { deviceId: string; beat: Heartbeat }[] = [];
  authChecks = 0;
  outcome: HeartbeatOutcome = { outcome: "recorded" };
  failRecord = false;
  failAuth = false;
  isActive = (d: string, c: string) => {
    this.authChecks++;
    if (this.failAuth) return Promise.reject(new Error("db down: secret detail"));
    return Promise.resolve(this.active.has(`${d}:${c}`));
  };
  record = (deviceId: string, beat: Heartbeat) => {
    if (this.failRecord) return Promise.reject(new Error("rpc_failed: password=hunter2"));
    this.recorded.push({ deviceId, beat });
    return Promise.resolve(this.outcome);
  };
}

function setup() {
  resetRateLimits();
  const fake = new Fake();
  const deps: Deps = { deviceJwtSecret: SECRET, isActive: fake.isActive, record: fake.record };
  return { fake, deps };
}

const token = (sub = DEVICE, cid: string | null = CRED) => signDeviceJwt({ sub, ...(cid ? { cid } : {}), jti: crypto.randomUUID() }, SECRET);

async function call(deps: Deps, o: { token?: string | null; body?: unknown; raw?: string; ip?: string; method?: string } = {}) {
  const method = o.method ?? "POST";
  const t = o.token === undefined ? await token() : o.token;
  return handler(new Request("http://localhost/device-heartbeat", {
    method,
    headers: {
      "content-type": "application/json",
      ...(t ? { authorization: `Bearer ${t}` } : {}),
      ...(o.ip ? { "x-forwarded-for": o.ip } : {}),
    },
    body: method === "POST" ? (o.raw ?? JSON.stringify("body" in o ? o.body : BEAT)) : undefined,
  }), deps);
}

Deno.test("device-heartbeat: valid beat -> 200, recorded for the device in the token, minimal response", async () => {
  const { fake, deps } = setup();
  const r = await call(deps);
  assertEquals(r.status, 200);
  assertEquals(r.headers.get("cache-control"), "no-store");
  const { data } = await r.json();
  assertEquals(data.next_interval_seconds, 900);
  assert(!Number.isNaN(Date.parse(data.server_time)));
  assertEquals(Object.keys(data).sort(), ["next_interval_seconds", "server_time"]);
  assertEquals(fake.recorded, [{ deviceId: DEVICE, beat: BEAT }]);
});

Deno.test("device-heartbeat: the live credential check runs on every request", async () => {
  const { fake, deps } = setup();
  await call(deps);
  await call(deps);
  assertEquals(fake.authChecks, 2);
});

Deno.test("device-heartbeat: no / malformed / forged / parent / cid-less tokens -> identical 401, nothing recorded", async () => {
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

Deno.test("device-heartbeat: revoked / unknown credential -> 401 and nothing recorded", async () => {
  const { fake, deps } = setup();
  fake.active.clear();
  const r = await call(deps);
  assertEquals(r.status, 401);
  assertEquals(fake.recorded.length, 0);
});

Deno.test("device-heartbeat: revoked between guard and write (record says inactive) -> the same 401 body", async () => {
  const a = setup();
  a.fake.active.clear();
  const first = await (await call(a.deps)).text();
  const b = setup();
  b.fake.outcome = { outcome: "inactive" };
  const r = await call(b.deps);
  assertEquals(r.status, 401);
  assertEquals(await r.text(), first);
});

Deno.test("device-heartbeat: the body can never name a device or add fields (strict)", async () => {
  const { fake, deps } = setup();
  for (const body of [{ ...BEAT, device_id: OTHER }, { ...BEAT, latitude: 1 }, { ...BEAT, permissions: {} }]) {
    assertEquals((await call(deps, { body })).status, 400);
  }
  assertEquals(fake.recorded.length, 0);
});

Deno.test("device-heartbeat: validation rejects bad values and bodies", async () => {
  const { fake, deps } = setup();
  const bad: unknown[] = [
    { ...BEAT, battery_level: 101 }, { ...BEAT, battery_level: -1 }, { ...BEAT, battery_level: 50.5 }, { ...BEAT, battery_level: "80" },
    { ...BEAT, is_charging: "no" }, { ...BEAT, network_type: "5G" }, { ...BEAT, app_version: "" }, { ...BEAT, app_version: "x".repeat(33) },
    { ...BEAT, android_version: "" }, { app_version: "1", android_version: "16" }, {}, [], null,
  ];
  for (const body of bad) {
    resetRateLimits(); // 14 bodies exceed the per-device limit (8 / 15 min); this test is about validation only
    assertEquals((await call(deps, { body })).status, 400);
  }
  resetRateLimits();
  assertEquals((await call(deps, { raw: "{not json" })).status, 400);
  assertEquals(fake.recorded.length, 0);
});

Deno.test("device-heartbeat: every documented network type is accepted", async () => {
  const { fake, deps } = setup();
  for (const network_type of ["WIFI", "CELLULAR", "ETHERNET", "VPN", "NONE", "UNKNOWN"]) {
    resetRateLimits();
    assertEquals((await call(deps, { body: { ...BEAT, network_type } })).status, 200);
  }
  assertEquals(fake.recorded.length, 6);
});

Deno.test("device-heartbeat: only POST", async () => {
  const { deps } = setup();
  assertEquals((await call(deps, { method: "GET" })).status, 400);
});

Deno.test("device-heartbeat: per-device limit is 8 per window; another device is unaffected", async () => {
  const { fake, deps } = setup();
  for (let i = 0; i < 8; i++) assertEquals((await call(deps, { ip: `10.0.0.${i}` })).status, 200);
  const limited = await call(deps, { ip: "10.0.1.1" });
  assertEquals(limited.status, 429);
  assert(Number(limited.headers.get("retry-after")) > 0);
  assertEquals(fake.recorded.length, 8);
  assertEquals((await call(deps, { token: await token(OTHER), ip: "10.0.1.2" })).status, 200);
});

Deno.test("device-heartbeat: the pre-auth IP limit stops floods before any token or database work", async () => {
  const { fake, deps } = setup();
  for (let i = 0; i < 120; i++) await call(deps, { token: null, ip: "203.0.113.9" });
  const checksBefore = fake.authChecks;
  const r = await call(deps, { token: await token(), ip: "203.0.113.9" });
  assertEquals(r.status, 429);
  assertEquals(fake.authChecks, checksBefore);
});

Deno.test("device-heartbeat: database failures are sanitized 500s that never leak details or read as valid", async () => {
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

Deno.test("device-heartbeat: logs never contain the token or beat data", async () => {
  const { deps, fake } = setup();
  const seen: string[] = [];
  const orig = { e: console.error, w: console.warn, l: console.log };
  console.error = console.warn = console.log = (...a: unknown[]) => { seen.push(a.join(" ")); };
  const t = await token();
  try {
    fake.failRecord = true;
    await call(deps, { token: t });
  } finally {
    console.error = orig.e; console.warn = orig.w; console.log = orig.l;
  }
  const joined = seen.join("\n");
  assert(!joined.includes(t) && !joined.includes("hunter2") && !joined.includes(DEVICE));
});
