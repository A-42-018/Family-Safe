import { assert, assertEquals, fakeJwt } from "../_shared/test_util.ts";
import { signDeviceJwt } from "../_shared/auth.ts";
import { resetRateLimits } from "../_shared/ratelimit.ts";
import type { DeviceInfo } from "../_shared/device-info.ts";
import { type Deps, type DeviceInfoOutcome, handler } from "./handler.ts";

const SECRET = "s".repeat(40);
const DEVICE = "d0000000-0000-4000-8000-0000000000aa";
const OTHER = "d0000000-0000-4000-8000-0000000000bb";
const CRED = "e0000000-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-09-30T12:00:00Z");
const INFO: DeviceInfo = { sdk_level: 36, security_patch: "2026-09-05", storage_total_mb: 128000, storage_free_mb: 64000 };

class Fake {
  active = new Set<string>([`${DEVICE}:${CRED}`, `${OTHER}:${CRED}`]);
  recorded: { deviceId: string; info: DeviceInfo }[] = [];
  authChecks = 0;
  outcome: DeviceInfoOutcome = { outcome: "recorded" };
  failRecord = false;
  failAuth = false;
  isActive = (d: string, c: string) => {
    this.authChecks++;
    if (this.failAuth) return Promise.reject(new Error("db down: secret detail"));
    return Promise.resolve(this.active.has(`${d}:${c}`));
  };
  record = (deviceId: string, info: DeviceInfo) => {
    if (this.failRecord) return Promise.reject(new Error("rpc_failed: password=hunter2"));
    this.recorded.push({ deviceId, info });
    return Promise.resolve(this.outcome);
  };
}

function setup() {
  resetRateLimits();
  const fake = new Fake();
  const deps: Deps = { deviceJwtSecret: SECRET, isActive: fake.isActive, record: fake.record, now: () => NOW };
  return { fake, deps };
}

// The handler pins JWT expiry checks to `now`, so tokens are signed relative to the same instant.
const token = (sub = DEVICE, cid: string | null = CRED) =>
  signDeviceJwt({ sub, ...(cid ? { cid } : {}), jti: crypto.randomUUID() }, SECRET, Math.floor(NOW / 1000));

async function call(deps: Deps, o: { token?: string | null; body?: unknown; raw?: string; ip?: string; method?: string } = {}) {
  const method = o.method ?? "POST";
  const t = o.token === undefined ? await token() : o.token;
  return handler(new Request("http://localhost/device-info", {
    method,
    headers: {
      "content-type": "application/json",
      ...(t ? { authorization: `Bearer ${t}` } : {}),
      ...(o.ip ? { "x-forwarded-for": o.ip } : {}),
    },
    body: method === "POST" ? (o.raw ?? JSON.stringify("body" in o ? o.body : INFO)) : undefined,
  }), deps);
}

Deno.test("device-info: valid upload -> 200, recorded for the device in the token, minimal response", async () => {
  const { fake, deps } = setup();
  const r = await call(deps);
  assertEquals(r.status, 200);
  assertEquals(r.headers.get("cache-control"), "no-store");
  const { data } = await r.json();
  assertEquals(data.next_interval_seconds, 86400);
  assertEquals(data.server_time, "2026-09-30T12:00:00.000Z");
  assertEquals(Object.keys(data).sort(), ["next_interval_seconds", "server_time"]);
  assertEquals(fake.recorded, [{ deviceId: DEVICE, info: INFO }]);
});

Deno.test("device-info: unknown patch and storage (explicit nulls) are accepted", async () => {
  const { fake, deps } = setup();
  const body = { sdk_level: 31, security_patch: null, storage_total_mb: null, storage_free_mb: null };
  assertEquals((await call(deps, { body })).status, 200);
  assertEquals(fake.recorded[0].info, body);
});

Deno.test("device-info: the live credential check runs on every request", async () => {
  const { fake, deps } = setup();
  await call(deps);
  await call(deps);
  assertEquals(fake.authChecks, 2);
});

Deno.test("device-info: no / malformed / forged / parent / cid-less tokens -> identical 401, nothing recorded", async () => {
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

Deno.test("device-info: revoked / unknown credential -> 401 and nothing recorded", async () => {
  const { fake, deps } = setup();
  fake.active.clear();
  const r = await call(deps);
  assertEquals(r.status, 401);
  assertEquals(fake.recorded.length, 0);
});

Deno.test("device-info: revoked between guard and write (record says inactive) -> the same 401 body", async () => {
  const a = setup();
  a.fake.active.clear();
  const first = await (await call(a.deps)).text();
  const b = setup();
  b.fake.outcome = { outcome: "inactive" };
  const r = await call(b.deps);
  assertEquals(r.status, 401);
  assertEquals(await r.text(), first);
});

Deno.test("device-info: the body can never name a device or add fields (strict)", async () => {
  const { fake, deps } = setup();
  for (const body of [{ ...INFO, device_id: OTHER }, { ...INFO, serial: "X" }, { ...INFO, imei: "1" }, { ...INFO, apps: [] }]) {
    resetRateLimits();
    assertEquals((await call(deps, { body })).status, 400);
  }
  assertEquals(fake.recorded.length, 0);
});

Deno.test("device-info: validation rejects bad values and bodies", async () => {
  const { fake, deps } = setup();
  const bad: unknown[] = [
    { ...INFO, sdk_level: 0 }, { ...INFO, sdk_level: 100 }, { ...INFO, sdk_level: 34.5 }, { ...INFO, sdk_level: "34" }, { ...INFO, sdk_level: null },
    { ...INFO, security_patch: "2026-13-01" }, { ...INFO, security_patch: "2026-02-30" }, { ...INFO, security_patch: "2026-9-5" },
    { ...INFO, security_patch: "2009-12-31" }, { ...INFO, security_patch: "2026-09-05T00:00:00Z" }, { ...INFO, security_patch: "" }, { ...INFO, security_patch: 20260905 },
    { ...INFO, storage_total_mb: 0 }, { ...INFO, storage_total_mb: 16777217 }, { ...INFO, storage_free_mb: -1 }, { ...INFO, storage_total_mb: 10.5 },
    { ...INFO, storage_free_mb: 128001 },
    { ...INFO, storage_total_mb: null }, { ...INFO, storage_free_mb: null },
    { sdk_level: 34, security_patch: null, storage_total_mb: null }, { sdk_level: 34 }, {}, [], null,
  ];
  for (const body of bad) {
    resetRateLimits(); // this test is about validation, not the per-device limit
    assertEquals((await call(deps, { body })).status, 400);
  }
  resetRateLimits();
  assertEquals((await call(deps, { raw: "{not json" })).status, 400);
  assertEquals(fake.recorded.length, 0);
});

Deno.test("device-info: a security patch more than a day in the future is rejected, one day ahead is fine", async () => {
  const { fake, deps } = setup();
  assertEquals((await call(deps, { body: { ...INFO, security_patch: "2026-10-02" } })).status, 400);
  assertEquals(fake.recorded.length, 0);
  assertEquals((await call(deps, { body: { ...INFO, security_patch: "2026-10-01" } })).status, 200);
  assertEquals(fake.recorded.length, 1);
});

Deno.test("device-info: free == total and the largest allowed values are accepted", async () => {
  const { fake, deps } = setup();
  assertEquals((await call(deps, { body: { ...INFO, storage_total_mb: 1, storage_free_mb: 1 } })).status, 200);
  resetRateLimits();
  assertEquals((await call(deps, { body: { sdk_level: 99, security_patch: "2010-01-01", storage_total_mb: 16777216, storage_free_mb: 0 } })).status, 200);
  assertEquals(fake.recorded.length, 2);
});

Deno.test("device-info: only POST", async () => {
  const { deps } = setup();
  assertEquals((await call(deps, { method: "GET" })).status, 400);
});

Deno.test("device-info: per-device limit is 6 per window; another device is unaffected", async () => {
  const { fake, deps } = setup();
  for (let i = 0; i < 6; i++) assertEquals((await call(deps, { ip: `10.0.0.${i}` })).status, 200);
  const limited = await call(deps, { ip: "10.0.1.1" });
  assertEquals(limited.status, 429);
  assert(Number(limited.headers.get("retry-after")) > 0);
  assertEquals(fake.recorded.length, 6);
  assertEquals((await call(deps, { token: await token(OTHER), ip: "10.0.1.2" })).status, 200);
});

Deno.test("device-info: the pre-auth IP limit stops floods before any token or database work", async () => {
  const { fake, deps } = setup();
  for (let i = 0; i < 60; i++) await call(deps, { token: null, ip: "203.0.113.9" });
  const checksBefore = fake.authChecks;
  const r = await call(deps, { token: await token(), ip: "203.0.113.9" });
  assertEquals(r.status, 429);
  assertEquals(fake.authChecks, checksBefore);
});

Deno.test("device-info: database failures are sanitized 500s that never leak details or read as valid", async () => {
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

Deno.test("device-info: logs never contain the token or the uploaded data", async () => {
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
  assert(!joined.includes(t) && !joined.includes("hunter2") && !joined.includes(DEVICE) && !joined.includes("2026-09-05"));
});
