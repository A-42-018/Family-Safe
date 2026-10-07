import { assert, assertEquals, fakeJwt } from "../_shared/test_util.ts";
import { signDeviceJwt } from "../_shared/auth.ts";
import { resetRateLimits } from "../_shared/ratelimit.ts";
import { type DeviceConfigRow, etagForConfigVersion, parseConfigEtag } from "../_shared/device-config.ts";
import { type Deps, type DeviceConfigResult, handler } from "./handler.ts";

const SECRET = "s".repeat(40);
const DEVICE = "d0000000-0000-4000-8000-0000000000aa";
const OTHER = "d0000000-0000-4000-8000-0000000000bb";
const CRED = "e0000000-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-10-01T12:00:00Z");
const CONFIG: DeviceConfigRow = {
  config_version: 3,
  daily_limit_minutes: 120,
  daily_limit_overrides: { "6": 240, "7": 0 },
  app_rules: [
    { package_name: "com.example.game", blocked: true, daily_limit_minutes: null },
    { package_name: "com.example.video", blocked: false, daily_limit_minutes: 45 },
  ],
  timezone: "Asia/Dhaka",
  schedules: [
    { id: "a0000000-0000-4000-8000-000000000001", name: "Bedtime", type: "BEDTIME", days: [1, 2, 3, 4, 5], start_time: "21:00", end_time: "07:00" },
    { id: "a0000000-0000-4000-8000-000000000002", name: "School", type: "SCHOOL", days: [1, 2, 3, 4, 5], start_time: "08:00", end_time: "15:00" },
  ],
};

class Fake {
  active = new Set<string>([`${DEVICE}:${CRED}`, `${OTHER}:${CRED}`]);
  reads: string[] = [];
  authChecks = 0;
  result: DeviceConfigResult = { outcome: "ok", config: CONFIG };
  failRead = false;
  failAuth = false;
  isActive = (d: string, c: string) => {
    this.authChecks++;
    if (this.failAuth) return Promise.reject(new Error("db down: secret detail"));
    return Promise.resolve(this.active.has(`${d}:${c}`));
  };
  getConfig = (deviceId: string) => {
    if (this.failRead) return Promise.reject(new Error("rpc_failed: password=hunter2"));
    this.reads.push(deviceId);
    return Promise.resolve(this.result);
  };
}

function setup() {
  resetRateLimits();
  const fake = new Fake();
  const deps: Deps = { deviceJwtSecret: SECRET, isActive: fake.isActive, getConfig: fake.getConfig, now: () => NOW };
  return { fake, deps };
}

const token = (sub = DEVICE, cid: string | null = CRED) =>
  signDeviceJwt({ sub, ...(cid ? { cid } : {}), jti: crypto.randomUUID() }, SECRET, Math.floor(NOW / 1000));

async function call(deps: Deps, o: { token?: string | null; ifNoneMatch?: string; ip?: string; method?: string; body?: string } = {}) {
  const t = o.token === undefined ? await token() : o.token;
  return handler(new Request("http://localhost/device-config", {
    method: o.method ?? "GET",
    headers: {
      ...(t ? { authorization: `Bearer ${t}` } : {}),
      ...(o.ifNoneMatch ? { "if-none-match": o.ifNoneMatch } : {}),
      ...(o.ip ? { "x-forwarded-for": o.ip } : {}),
      ...(o.body ? { "content-type": "application/json" } : {}),
    },
    body: o.body,
  }), deps);
}

Deno.test("device-config: 200 returns the config of the device in the token, ETag, no-store", async () => {
  const { fake, deps } = setup();
  const r = await call(deps);
  assertEquals(r.status, 200);
  assertEquals(r.headers.get("etag"), '"v3"');
  assertEquals(r.headers.get("cache-control"), "no-store");
  const { data } = await r.json();
  assertEquals(data, { ...CONFIG, server_time: "2026-10-01T12:00:00.000Z", next_interval_seconds: 21600 });
  assertEquals(fake.reads, [DEVICE]);
});

Deno.test("device-config: matching If-None-Match -> 304, empty body, ETag kept", async () => {
  const { deps } = setup();
  for (const h of ['"v3"', 'W/"v3"', '  "v3"  ']) {
    resetRateLimits();
    const r = await call(deps, { ifNoneMatch: h });
    assertEquals(r.status, 304);
    assertEquals(r.headers.get("etag"), '"v3"');
    assertEquals(await r.text(), "");
  }
});

Deno.test("device-config: stale, junk, list or wildcard If-None-Match -> full 200", async () => {
  const { deps } = setup();
  for (const h of ['"v2"', '"v4"', "v3", '"v03"', '"v0"', '"3"', "*", '"v3", "v2"', '"v3"x', '"v1234567890"']) {
    resetRateLimits();
    assertEquals((await call(deps, { ifNoneMatch: h })).status, 200);
  }
});

Deno.test("device-config: a 304 still requires a valid device (auth before the ETag)", async () => {
  const { fake, deps } = setup();
  fake.active.clear();
  assertEquals((await call(deps, { ifNoneMatch: '"v3"' })).status, 401);
  assertEquals(fake.reads.length, 0);
});

Deno.test("device-config: each device gets its own config, never another's", async () => {
  const { fake, deps } = setup();
  await call(deps);
  await call(deps, { token: await token(OTHER), ip: "10.0.0.2" });
  assertEquals(fake.reads, [DEVICE, OTHER]);
});

Deno.test("device-config: nothing in the request can name a device", async () => {
  const { fake, deps } = setup();
  const r = await handler(new Request(`http://localhost/device-config?device_id=${OTHER}`, {
    method: "GET", headers: { authorization: `Bearer ${await token()}`, "x-device-id": OTHER },
  }), deps);
  assertEquals(r.status, 200);
  assertEquals(fake.reads, [DEVICE]);
});

Deno.test("device-config: a null limit and empty overrides pass through", async () => {
  const { fake, deps } = setup();
  fake.result = { outcome: "ok", config: { ...CONFIG, daily_limit_minutes: null, daily_limit_overrides: {} } };
  const { data } = await (await call(deps)).json();
  assertEquals(data.daily_limit_minutes, null);
  assertEquals(data.daily_limit_overrides, {});
  assertEquals("bedtime_start" in data, false);
});

Deno.test("device-config: app_rules pass through unchanged (order, blocked, limit, null) and carry no label", async () => {
  const { deps } = setup();
  const { data } = await (await call(deps)).json();
  assertEquals(data.app_rules, CONFIG.app_rules);
  for (const rule of data.app_rules) assertEquals(Object.keys(rule).sort(), ["blocked", "daily_limit_minutes", "package_name"]);
});

Deno.test("device-config: an empty app_rules list stays an empty array (never null or absent)", async () => {
  const { fake, deps } = setup();
  fake.result = { outcome: "ok", config: { ...CONFIG, app_rules: [] } };
  const { data } = await (await call(deps)).json();
  assertEquals(data.app_rules, []);
  assert("app_rules" in data);
});

Deno.test("device-config: app rules of one device are never served to another", async () => {
  const { fake, deps } = setup();
  const mine = { ...CONFIG, app_rules: [{ package_name: "com.mine.app", blocked: true, daily_limit_minutes: null }] };
  const theirs = { ...CONFIG, app_rules: [{ package_name: "com.theirs.app", blocked: false, daily_limit_minutes: 10 }] };
  const perDevice: Deps = {
    ...deps,
    getConfig: (id: string) => {
      fake.reads.push(id);
      return Promise.resolve({ outcome: "ok" as const, config: id === DEVICE ? mine : theirs });
    },
  };
  const a = await (await call(perDevice)).json();
  const b = await (await call(perDevice, { token: await token(OTHER), ip: "10.0.0.9" })).json();
  assertEquals(a.data.app_rules, mine.app_rules);
  assertEquals(b.data.app_rules, theirs.app_rules);
});

Deno.test("device-config: timezone and schedules pass through unchanged (order, overnight, days) with exactly the wire keys", async () => {
  const { deps } = setup();
  const { data } = await (await call(deps)).json();
  assertEquals(data.timezone, "Asia/Dhaka");
  assertEquals(data.schedules, CONFIG.schedules);
  for (const s of data.schedules) assertEquals(Object.keys(s).sort(), ["days", "end_time", "id", "name", "start_time", "type"]);
});

Deno.test("device-config: no time zone stays null and no schedules stay an empty array (never absent)", async () => {
  const { fake, deps } = setup();
  fake.result = { outcome: "ok", config: { ...CONFIG, timezone: null, schedules: [] } };
  const { data } = await (await call(deps)).json();
  assertEquals(data.timezone, null);
  assertEquals(data.schedules, []);
  assert("timezone" in data);
  assert("schedules" in data);
});

Deno.test("device-config: schedules of one device are never served to another", async () => {
  const { fake, deps } = setup();
  const mine = { ...CONFIG, timezone: "Europe/Berlin", schedules: [CONFIG.schedules[0]!] };
  const theirs = { ...CONFIG, timezone: null, schedules: [] };
  const perDevice: Deps = {
    ...deps,
    getConfig: (id: string) => {
      fake.reads.push(id);
      return Promise.resolve({ outcome: "ok" as const, config: id === DEVICE ? mine : theirs });
    },
  };
  const a = await (await call(perDevice)).json();
  const b = await (await call(perDevice, { token: await token(OTHER), ip: "10.0.0.9" })).json();
  assertEquals(a.data.schedules, mine.schedules);
  assertEquals(a.data.timezone, "Europe/Berlin");
  assertEquals(b.data.schedules, []);
  assertEquals(b.data.timezone, null);
});

Deno.test("device-config: a schedule change (new config_version) changes the ETag; the old ETag then gets the full body", async () => {
  const { fake, deps } = setup();
  const first = await call(deps);
  assertEquals(first.headers.get("etag"), '"v3"');
  const same = await call(deps, { ifNoneMatch: '"v3"' });
  assertEquals(same.status, 304);
  fake.result = { outcome: "ok", config: { ...CONFIG, config_version: 4, schedules: [] } };
  const changed = await call(deps, { ifNoneMatch: '"v3"' });
  assertEquals(changed.status, 200);
  assertEquals(changed.headers.get("etag"), '"v4"');
  assertEquals((await changed.json()).data.schedules, []);
});

Deno.test("device-config: error bodies never contain schedule names or the time zone", async () => {
  const { fake, deps } = setup();
  fake.failRead = true;
  const text = await (await call(deps)).text();
  assert(!text.includes("Bedtime") && !text.includes("Asia/Dhaka") && !text.includes("a0000000"));
});

Deno.test("device-config: error bodies never contain app package names", async () => {
  const { fake, deps } = setup();
  fake.failRead = true;
  const r = await call(deps);
  assertEquals(r.status, 500);
  assert(!(await r.text()).includes("com.example"));
});

Deno.test("device-config: the live credential check runs on every request", async () => {
  const { fake, deps } = setup();
  await call(deps);
  await call(deps);
  assertEquals(fake.authChecks, 2);
});

Deno.test("device-config: no / malformed / forged / parent / cid-less tokens -> identical 401, nothing read", async () => {
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
  assertEquals(fake.reads.length, 0);
});

Deno.test("device-config: revoked between guard and read (getConfig says inactive) -> the same 401 body", async () => {
  const a = setup();
  a.fake.active.clear();
  const first = await (await call(a.deps)).text();
  const b = setup();
  b.fake.result = { outcome: "inactive" };
  const r = await call(b.deps);
  assertEquals(r.status, 401);
  assertEquals(await r.text(), first);
});

Deno.test("device-config: only GET", async () => {
  const { fake, deps } = setup();
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    resetRateLimits();
    const r = await call(deps, { method, body: method === "DELETE" ? undefined : "{}" });
    assertEquals(r.status, 400);
  }
  assertEquals(fake.reads.length, 0);
});

Deno.test("device-config: CORS preflight is answered without auth", async () => {
  const { fake, deps } = setup();
  const r = await handler(new Request("http://localhost/device-config", {
    method: "OPTIONS", headers: { origin: "http://localhost:3000", "access-control-request-method": "GET" },
  }), deps);
  assert(r.status === 204 || r.status === 200);
  assertEquals(fake.authChecks, 0);
});

Deno.test("device-config: per-device limit is 30 per window; another device is unaffected", async () => {
  const { fake, deps } = setup();
  for (let i = 0; i < 30; i++) assertEquals((await call(deps, { ip: `10.0.${i}.1` })).status, 200);
  const limited = await call(deps, { ip: "10.1.0.1" });
  assertEquals(limited.status, 429);
  assert(Number(limited.headers.get("retry-after")) > 0);
  assertEquals(fake.reads.length, 30);
  assertEquals((await call(deps, { token: await token(OTHER), ip: "10.1.0.2" })).status, 200);
});

Deno.test("device-config: the pre-auth IP limit stops floods before any token or database work", async () => {
  const { fake, deps } = setup();
  for (let i = 0; i < 60; i++) await call(deps, { token: null, ip: "203.0.113.9" });
  const checksBefore = fake.authChecks;
  const r = await call(deps, { token: await token(), ip: "203.0.113.9" });
  assertEquals(r.status, 429);
  assertEquals(fake.authChecks, checksBefore);
});

Deno.test("device-config: database failures are sanitized 500s that never leak details or read as valid", async () => {
  const a = setup();
  a.fake.failAuth = true;
  const ra = await call(a.deps);
  assertEquals(ra.status, 500);
  assert(!(await ra.text()).includes("secret detail"));

  const b = setup();
  b.fake.failRead = true;
  const rb = await call(b.deps);
  assertEquals(rb.status, 500);
  assert(!(await rb.text()).includes("hunter2"));
});

Deno.test("device-config: error bodies never contain the token or rule values", async () => {
  const { fake, deps } = setup();
  const t = await token();
  fake.failRead = true;
  const r = await call(deps, { token: t });
  const text = await r.text();
  assert(!text.includes(t));
  assert(!text.includes("21:00"));
});

Deno.test("device-config: ETag helpers", () => {
  assertEquals(etagForConfigVersion(7), '"v7"');
  assertEquals(parseConfigEtag(null), null);
  assertEquals(parseConfigEtag('"v7"'), 7);
  assertEquals(parseConfigEtag('W/"v7"'), 7);
  assertEquals(parseConfigEtag('"v999999999"'), 999999999);
  assertEquals(parseConfigEtag('"v1000000000"'), null);
  assertEquals(parseConfigEtag("*"), null);
});
