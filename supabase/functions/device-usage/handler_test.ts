import { assert, assertEquals, fakeJwt } from "../_shared/test_util.ts";
import { signDeviceJwt } from "../_shared/auth.ts";
import { resetRateLimits } from "../_shared/ratelimit.ts";
import { DEVICE_USAGE_MAX_APPS, type DeviceUsage } from "../_shared/device-usage.ts";
import { type Deps, type DeviceUsageOutcome, handler } from "./handler.ts";

const SECRET = "s".repeat(40);
const DEVICE = "d0000000-0000-4000-8000-0000000000aa";
const OTHER = "d0000000-0000-4000-8000-0000000000bb";
const CRED = "e0000000-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-10-01T12:00:00Z");
const DAY = "2026-10-01";
const USAGE = {
  day: DAY,
  total_screen_minutes: 120,
  unlock_count: 15,
  apps: [
    { package_name: "com.android.chrome", foreground_minutes: 70, launch_count: 6 },
    { package_name: "org.example.notes", foreground_minutes: 30, launch_count: 4 },
  ],
};

class Fake {
  active = new Set<string>([`${DEVICE}:${CRED}`, `${OTHER}:${CRED}`]);
  uploaded: { deviceId: string; usage: DeviceUsage }[] = [];
  authChecks = 0;
  outcome: DeviceUsageOutcome = { outcome: "recorded" };
  failUpload = false;
  failAuth = false;
  isActive = (d: string, c: string) => {
    this.authChecks++;
    if (this.failAuth) return Promise.reject(new Error("db down: secret detail"));
    return Promise.resolve(this.active.has(`${d}:${c}`));
  };
  upload = (deviceId: string, usage: DeviceUsage) => {
    if (this.failUpload) return Promise.reject(new Error("rpc_failed: password=hunter2"));
    this.uploaded.push({ deviceId, usage });
    return Promise.resolve(this.outcome);
  };
}

function setup() {
  resetRateLimits();
  const fake = new Fake();
  const deps: Deps = { deviceJwtSecret: SECRET, isActive: fake.isActive, upload: fake.upload, now: () => NOW };
  return { fake, deps };
}

const token = (sub = DEVICE, cid: string | null = CRED) =>
  signDeviceJwt({ sub, ...(cid ? { cid } : {}), jti: crypto.randomUUID() }, SECRET, Math.floor(NOW / 1000));

async function call(deps: Deps, o: { token?: string | null; body?: unknown; raw?: string; ip?: string; method?: string } = {}) {
  const method = o.method ?? "POST";
  const t = o.token === undefined ? await token() : o.token;
  return handler(new Request("http://localhost/device-usage", {
    method,
    headers: {
      "content-type": "application/json",
      ...(t ? { authorization: `Bearer ${t}` } : {}),
      ...(o.ip ? { "x-forwarded-for": o.ip } : {}),
    },
    body: method === "POST" ? (o.raw ?? JSON.stringify("body" in o ? o.body : USAGE)) : undefined,
  }), deps);
}

const app = (i: number, fg = 1) => ({ package_name: `com.example.app${i}`, foreground_minutes: fg, launch_count: 1 });

Deno.test("device-usage: valid report -> 200, uploaded for the device in the token, minimal response", async () => {
  const { fake, deps } = setup();
  const r = await call(deps);
  assertEquals(r.status, 200);
  assertEquals(r.headers.get("cache-control"), "no-store");
  const { data } = await r.json();
  assertEquals(data.next_interval_seconds, 21600);
  assertEquals(data.server_time, "2026-10-01T12:00:00.000Z");
  assertEquals(Object.keys(data).sort(), ["next_interval_seconds", "server_time"]); // never echoes stored values
  assertEquals(fake.uploaded, [{ deviceId: DEVICE, usage: USAGE }]);
});

Deno.test("device-usage: an empty app list and zero values are valid", async () => {
  const { fake, deps } = setup();
  assertEquals((await call(deps, { body: { day: DAY, total_screen_minutes: 0, unlock_count: 0, apps: [] } })).status, 200);
  assertEquals(fake.uploaded[0].usage.apps, []);
});

Deno.test("device-usage: the upper bounds themselves are accepted", async () => {
  const { fake, deps } = setup();
  const body = { day: DAY, total_screen_minutes: 1440, unlock_count: 10000, apps: [{ package_name: "com.max.app", foreground_minutes: 1440, launch_count: 10000 }] };
  assertEquals((await call(deps, { body })).status, 200);
  assertEquals(fake.uploaded.length, 1);
});

Deno.test("device-usage: exactly 200 apps is accepted, 201 -> 400 (never truncated)", async () => {
  const { fake, deps } = setup();
  const ok = Array.from({ length: DEVICE_USAGE_MAX_APPS }, (_, i) => app(i));
  assertEquals((await call(deps, { body: { day: DAY, total_screen_minutes: 500, unlock_count: 1, apps: ok } })).status, 200);
  resetRateLimits();
  const tooMany = Array.from({ length: DEVICE_USAGE_MAX_APPS + 1 }, (_, i) => app(i));
  assertEquals((await call(deps, { body: { day: DAY, total_screen_minutes: 500, unlock_count: 1, apps: tooMany } })).status, 400);
  assertEquals(fake.uploaded.length, 1);
});

Deno.test("device-usage: day window is today-14 .. today+1 (UTC), inclusive", async () => {
  const { fake, deps } = setup();
  const send = async (day: string) => {
    resetRateLimits();
    return (await call(deps, { body: { ...USAGE, day } })).status;
  };
  assertEquals(await send("2026-09-17"), 200); // 14 days back
  assertEquals(await send("2026-10-02"), 200); // tomorrow
  assertEquals(await send("2026-09-16"), 400); // 15 days back
  assertEquals(await send("2026-10-03"), 400); // 2 days ahead
  assertEquals(fake.uploaded.length, 2);
});

Deno.test("device-usage: validation rejects bad values and bodies", async () => {
  const { fake, deps } = setup();
  const good = USAGE;
  const a0 = USAGE.apps[0];
  const { day: _d, ...noDay } = good;
  const { unlock_count: _u, ...noUnlock } = good;
  const bad: unknown[] = [
    { ...good, day: "2026-10-1" }, { ...good, day: "2026-02-30" }, { ...good, day: "20261001" }, { ...good, day: 20261001 },
    { ...good, day: "" }, { ...good, day: null }, { ...good, day: "2026-10-01T00:00:00Z" },
    { ...good, total_screen_minutes: -1 }, { ...good, total_screen_minutes: 1441 }, { ...good, total_screen_minutes: 1.5 },
    { ...good, total_screen_minutes: "5" }, { ...good, total_screen_minutes: null },
    { ...good, unlock_count: -1 }, { ...good, unlock_count: 10001 }, { ...good, unlock_count: 0.5 }, { ...good, unlock_count: "1" },
    { ...good, apps: null }, { ...good, apps: {} }, { ...good, apps: "x" }, { ...good, apps: [null] }, { ...good, apps: ["com.a.b"] },
    { ...good, apps: [{ ...a0, package_name: "nodots" }] }, { ...good, apps: [{ ...a0, package_name: "1com.example" }] },
    { ...good, apps: [{ ...a0, package_name: "com..example" }] }, { ...good, apps: [{ ...a0, package_name: "com.ex-ample.x" }] },
    { ...good, apps: [{ ...a0, package_name: "" }] }, { ...good, apps: [{ ...a0, package_name: 5 }] },
    { ...good, apps: [{ ...a0, foreground_minutes: -1 }] }, { ...good, apps: [{ ...a0, foreground_minutes: 1441 }] },
    { ...good, apps: [{ ...a0, foreground_minutes: 1.5 }] }, { ...good, apps: [{ ...a0, launch_count: -1 }] },
    { ...good, apps: [{ ...a0, launch_count: 10001 }] }, { ...good, apps: [{ ...a0, launch_count: null }] },
    { ...good, apps: [{ package_name: a0.package_name, foreground_minutes: 1 }] }, // missing launch_count
    { ...good, apps: [{ ...a0, label: "Chrome" }] }, { ...good, apps: [{ ...a0, icon: "x" }] }, // extra keys
    { ...good, apps: [a0, { ...a0 }] }, // duplicate package
    { ...good, apps: [{ ...a0, foreground_minutes: 1000 }, { package_name: "com.b.app", foreground_minutes: 441, launch_count: 1 }] }, // sum > 1440
    noDay, noUnlock, { ...good, extra: 1 }, {}, [], null, "usage", 1,
  ];
  for (const body of bad) {
    resetRateLimits();
    assertEquals((await call(deps, { body })).status, 400);
  }
  resetRateLimits();
  assertEquals((await call(deps, { raw: "{not json" })).status, 400);
  assertEquals(fake.uploaded.length, 0);
});

Deno.test("device-usage: app minutes summing to exactly one day are accepted", async () => {
  const { fake, deps } = setup();
  const apps = [
    { package_name: "com.a.app", foreground_minutes: 1000, launch_count: 1 },
    { package_name: "com.b.app", foreground_minutes: 440, launch_count: 1 },
  ];
  assertEquals((await call(deps, { body: { ...USAGE, apps } })).status, 200);
  assertEquals(fake.uploaded.length, 1);
});

Deno.test("device-usage: the body can never name a device", async () => {
  const { fake, deps } = setup();
  assertEquals((await call(deps, { body: { ...USAGE, device_id: OTHER } })).status, 400);
  assertEquals((await call(deps, { body: { ...USAGE, apps: [{ ...USAGE.apps[0], device_id: OTHER }] } })).status, 400);
  assertEquals(fake.uploaded.length, 0);
});

Deno.test("device-usage: wrong content type -> 400", async () => {
  const { deps } = setup();
  const t = await token();
  const r = await handler(new Request("http://localhost/device-usage", {
    method: "POST", headers: { "content-type": "text/plain", authorization: `Bearer ${t}` }, body: JSON.stringify(USAGE),
  }), deps);
  assertEquals(r.status, 400);
});

Deno.test("device-usage: the live credential check runs on every request", async () => {
  const { fake, deps } = setup();
  await call(deps);
  await call(deps);
  assertEquals(fake.authChecks, 2);
});

Deno.test("device-usage: no / malformed / forged / parent / cid-less tokens -> identical 401, nothing uploaded", async () => {
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
  assertEquals(fake.uploaded.length, 0);
});

Deno.test("device-usage: revoked / unknown credential -> 401 and nothing uploaded", async () => {
  const { fake, deps } = setup();
  fake.active.clear();
  assertEquals((await call(deps)).status, 401);
  assertEquals(fake.uploaded.length, 0);
});

Deno.test("device-usage: an invalid body from an inactive device is still the 401, not a 400 (auth first)", async () => {
  const { fake, deps } = setup();
  fake.active.clear();
  assertEquals((await call(deps, { body: { day: "x" } })).status, 401);
});

Deno.test("device-usage: revoked between guard and write (upload says inactive) -> the same 401 body", async () => {
  const a = setup();
  a.fake.active.clear();
  const first = await (await call(a.deps)).text();
  const b = setup();
  b.fake.outcome = { outcome: "inactive" };
  const r = await call(b.deps);
  assertEquals(r.status, 401);
  assertEquals(await r.text(), first);
});

Deno.test("device-usage: only POST", async () => {
  const { deps } = setup();
  assertEquals((await call(deps, { method: "GET" })).status, 400);
});

Deno.test("device-usage: per-device limit is 12 per window; another device is unaffected", async () => {
  const { fake, deps } = setup();
  for (let i = 0; i < 12; i++) assertEquals((await call(deps, { ip: `10.0.0.${i}` })).status, 200);
  const limited = await call(deps, { ip: "10.0.1.1" });
  assertEquals(limited.status, 429);
  assert(Number(limited.headers.get("retry-after")) > 0);
  assertEquals(fake.uploaded.length, 12);
  assertEquals((await call(deps, { token: await token(OTHER), ip: "10.0.1.2" })).status, 200);
});

Deno.test("device-usage: the pre-auth IP limit stops floods before any token or database work", async () => {
  const { fake, deps } = setup();
  for (let i = 0; i < 60; i++) await call(deps, { token: null, ip: "203.0.113.9" });
  const checksBefore = fake.authChecks;
  const r = await call(deps, { token: await token(), ip: "203.0.113.9" });
  assertEquals(r.status, 429);
  assertEquals(fake.authChecks, checksBefore);
});

Deno.test("device-usage: database failures are sanitized 500s that never leak details or read as valid", async () => {
  const a = setup();
  a.fake.failAuth = true;
  const ra = await call(a.deps);
  assertEquals(ra.status, 500);
  assert(!(await ra.text()).includes("secret detail"));
  assertEquals(a.fake.uploaded.length, 0);

  const b = setup();
  b.fake.failUpload = true;
  const rb = await call(b.deps);
  assertEquals(rb.status, 500);
  assert(!(await rb.text()).includes("hunter2"));
});

Deno.test("device-usage: logs and error bodies never contain tokens or package names", async () => {
  const { deps } = setup();
  const seen: string[] = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  console.log = console.error = console.warn = console.info = (...a: unknown[]) => { seen.push(a.map(String).join(" ")); };
  try {
    const t = await token();
    await call(deps, { token: t });
    resetRateLimits();
    const bad = await call(deps, { token: t, body: { ...USAGE, total_screen_minutes: -1, apps: [{ package_name: "secret.package", foreground_minutes: 1, launch_count: 1 }] } });
    const badText = await bad.text();
    resetRateLimits();
    const joined = seen.join("\n");
    assert(!joined.includes(t));
    assert(!joined.includes("chrome") && !joined.includes("secret.package"));
    assert(!badText.includes("secret.package"));
  } finally {
    Object.assign(console, orig);
  }
});
