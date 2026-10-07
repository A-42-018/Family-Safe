import { assert, assertEquals, fakeJwt } from "../_shared/test_util.ts";
import { signDeviceJwt } from "../_shared/auth.ts";
import { resetRateLimits } from "../_shared/ratelimit.ts";
import { DEVICE_APPS_MAX, type DeviceApp } from "../_shared/device-apps.ts";
import { type Deps, type DeviceAppsOutcome, handler } from "./handler.ts";

const SECRET = "s".repeat(40);
const DEVICE = "d0000000-0000-4000-8000-0000000000aa";
const OTHER = "d0000000-0000-4000-8000-0000000000bb";
const CRED = "e0000000-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-10-01T12:00:00Z");
const APPS = [
  { package_name: "com.android.chrome", label: "Chrome", version_name: "141.0.1", is_system: true },
  { package_name: "org.example.notes", label: "Notes", version_name: null, is_system: false },
];

class Fake {
  active = new Set<string>([`${DEVICE}:${CRED}`, `${OTHER}:${CRED}`]);
  synced: { deviceId: string; apps: DeviceApp[] }[] = [];
  authChecks = 0;
  outcome: DeviceAppsOutcome = { outcome: "recorded" };
  failSync = false;
  failAuth = false;
  isActive = (d: string, c: string) => {
    this.authChecks++;
    if (this.failAuth) return Promise.reject(new Error("db down: secret detail"));
    return Promise.resolve(this.active.has(`${d}:${c}`));
  };
  sync = (deviceId: string, apps: DeviceApp[]) => {
    if (this.failSync) return Promise.reject(new Error("rpc_failed: password=hunter2"));
    this.synced.push({ deviceId, apps });
    return Promise.resolve(this.outcome);
  };
}

function setup() {
  resetRateLimits();
  const fake = new Fake();
  const deps: Deps = { deviceJwtSecret: SECRET, isActive: fake.isActive, sync: fake.sync, now: () => NOW };
  return { fake, deps };
}

const token = (sub = DEVICE, cid: string | null = CRED) =>
  signDeviceJwt({ sub, ...(cid ? { cid } : {}), jti: crypto.randomUUID() }, SECRET, Math.floor(NOW / 1000));

async function call(deps: Deps, o: { token?: string | null; body?: unknown; raw?: string; ip?: string; method?: string } = {}) {
  const method = o.method ?? "POST";
  const t = o.token === undefined ? await token() : o.token;
  return handler(new Request("http://localhost/device-apps", {
    method,
    headers: {
      "content-type": "application/json",
      ...(t ? { authorization: `Bearer ${t}` } : {}),
      ...(o.ip ? { "x-forwarded-for": o.ip } : {}),
    },
    body: method === "POST" ? (o.raw ?? JSON.stringify("body" in o ? o.body : { apps: APPS })) : undefined,
  }), deps);
}

const app = (i: number, extra: Partial<DeviceApp> = {}): DeviceApp => ({
  package_name: `com.example.app${i}`, label: `App ${i}`, version_name: "1.0", is_system: false, ...extra,
});

Deno.test("device-apps: valid report -> 200, recorded for the device in the token, minimal response", async () => {
  const { fake, deps } = setup();
  const r = await call(deps);
  assertEquals(r.status, 200);
  assertEquals(r.headers.get("cache-control"), "no-store");
  const { data } = await r.json();
  assertEquals(data.next_interval_seconds, 86400);
  assertEquals(data.server_time, "2026-10-01T12:00:00.000Z");
  assertEquals(Object.keys(data).sort(), ["next_interval_seconds", "server_time"]); // never says what changed
  assertEquals(fake.synced, [{ deviceId: DEVICE, apps: APPS }]);
});

Deno.test("device-apps: an empty list is valid (the device has no launchable apps)", async () => {
  const { fake, deps } = setup();
  assertEquals((await call(deps, { body: { apps: [] } })).status, 200);
  assertEquals(fake.synced[0].apps, []);
});

Deno.test("device-apps: exactly 500 apps is accepted (the body is larger than the generic 64 KB cap)", async () => {
  const { fake, deps } = setup();
  const apps = Array.from({ length: DEVICE_APPS_MAX }, (_, i) => app(i, { label: "L".repeat(120), version_name: "9.9.9-build-" + "x".repeat(40) }));
  assert(JSON.stringify({ apps }).length > 64 * 1024);
  assertEquals((await call(deps, { body: { apps } })).status, 200);
  assertEquals(fake.synced[0].apps.length, DEVICE_APPS_MAX);
});

Deno.test("device-apps: 501 apps -> 400, nothing recorded (never truncated)", async () => {
  const { fake, deps } = setup();
  const apps = Array.from({ length: DEVICE_APPS_MAX + 1 }, (_, i) => app(i));
  assertEquals((await call(deps, { body: { apps } })).status, 400);
  assertEquals(fake.synced.length, 0);
});

Deno.test("device-apps: a body over the 1 MiB cap is rejected", async () => {
  const { fake, deps } = setup();
  const r = await call(deps, { raw: JSON.stringify({ apps: [], pad: "x".repeat(1048577) }) });
  assertEquals(r.status, 400);
  assertEquals(fake.synced.length, 0);
});

Deno.test("device-apps: label and version are trimmed before they reach the database", async () => {
  const { fake, deps } = setup();
  const r = await call(deps, { body: { apps: [app(1, { label: "  Padded  ", version_name: " 2.0 " })] } });
  assertEquals(r.status, 200);
  assertEquals(fake.synced[0].apps[0].label, "Padded");
  assertEquals(fake.synced[0].apps[0].version_name, "2.0");
});

Deno.test("device-apps: field limits are inclusive (package 255, label 200, version 100)", async () => {
  const { fake, deps } = setup();
  const pkg255 = "a." + "b".repeat(253);
  assertEquals((await call(deps, { body: { apps: [app(1, { package_name: pkg255, label: "L".repeat(200), version_name: "v".repeat(100) })] } })).status, 200);
  assertEquals(fake.synced.length, 1);
  for (const bad of [
    { package_name: "a." + "b".repeat(254) }, { label: "L".repeat(201) }, { version_name: "v".repeat(101) },
  ]) {
    resetRateLimits();
    assertEquals((await call(deps, { body: { apps: [app(2, bad)] } })).status, 400);
  }
  assertEquals(fake.synced.length, 1);
});

Deno.test("device-apps: validation rejects bad entries and bodies", async () => {
  const { fake, deps } = setup();
  const good = app(1);
  const { is_system: _a, ...noSystem } = good;
  const { version_name: _v, ...noVersion } = good;
  const bad: unknown[] = [
    { apps: [{ ...good, package_name: "nodots" }] }, { apps: [{ ...good, package_name: "1com.example" }] },
    { apps: [{ ...good, package_name: "com..example" }] }, { apps: [{ ...good, package_name: "com.example." }] },
    { apps: [{ ...good, package_name: "com.exa mple.x" }] }, { apps: [{ ...good, package_name: "com.ex-ample.x" }] },
    { apps: [{ ...good, package_name: "" }] }, { apps: [{ ...good, package_name: 5 }] },
    { apps: [{ ...good, label: "" }] }, { apps: [{ ...good, label: "   " }] }, { apps: [{ ...good, label: null }] },
    { apps: [{ ...good, label: "bad\u0000label" }] }, { apps: [{ ...good, label: "line\nbreak" }] },
    { apps: [{ ...good, version_name: "" }] }, { apps: [{ ...good, version_name: "  " }] },
    { apps: [{ ...good, version_name: "1.0\t" + "\u0007" }] }, { apps: [{ ...good, version_name: 1 }] },
    { apps: [{ ...good, is_system: "true" }] }, { apps: [{ ...good, is_system: 1 }] }, { apps: [{ ...good, is_system: null }] },
    { apps: [noSystem] }, { apps: [noVersion] },
    { apps: [{ ...good, icon: "base64..." }] }, { apps: [{ ...good, install_time: 1 }] },
    { apps: [good, { ...good }] }, // duplicate package name
    { apps: [good, app(2), { ...app(2), label: "Other label" }] },
    { apps: null }, { apps: "x" }, { apps: {} }, { apps: [null] }, { apps: ["com.example.a"] }, { apps: [[]] },
    {}, [], null, "apps", 1,
    { apps: [good], extra: 1 },
  ];
  for (const body of bad) {
    resetRateLimits();
    assertEquals((await call(deps, { body })).status, 400);
  }
  resetRateLimits();
  assertEquals((await call(deps, { raw: "{not json" })).status, 400);
  assertEquals(fake.synced.length, 0);
});

Deno.test("device-apps: the body can never name a device", async () => {
  const { fake, deps } = setup();
  assertEquals((await call(deps, { body: { apps: APPS, device_id: OTHER } })).status, 400);
  assertEquals((await call(deps, { body: { apps: [{ ...APPS[0], device_id: OTHER }] } })).status, 400);
  assertEquals(fake.synced.length, 0);
});

Deno.test("device-apps: wrong content type -> 400", async () => {
  const { deps } = setup();
  const t = await token();
  const r = await handler(new Request("http://localhost/device-apps", {
    method: "POST", headers: { "content-type": "text/plain", authorization: `Bearer ${t}` }, body: JSON.stringify({ apps: [] }),
  }), deps);
  assertEquals(r.status, 400);
});

Deno.test("device-apps: the live credential check runs on every request", async () => {
  const { fake, deps } = setup();
  await call(deps);
  await call(deps);
  assertEquals(fake.authChecks, 2);
});

Deno.test("device-apps: no / malformed / forged / parent / cid-less tokens -> identical 401, nothing recorded", async () => {
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
  assertEquals(fake.synced.length, 0);
});

Deno.test("device-apps: revoked / unknown credential -> 401 and nothing recorded", async () => {
  const { fake, deps } = setup();
  fake.active.clear();
  assertEquals((await call(deps)).status, 401);
  assertEquals(fake.synced.length, 0);
});

Deno.test("device-apps: an invalid body from an inactive device is still the 401, not a 400 (auth first)", async () => {
  const { fake, deps } = setup();
  fake.active.clear();
  assertEquals((await call(deps, { body: { apps: "x" } })).status, 401);
});

Deno.test("device-apps: revoked between guard and write (sync says inactive) -> the same 401 body", async () => {
  const a = setup();
  a.fake.active.clear();
  const first = await (await call(a.deps)).text();
  const b = setup();
  b.fake.outcome = { outcome: "inactive" };
  const r = await call(b.deps);
  assertEquals(r.status, 401);
  assertEquals(await r.text(), first);
});

Deno.test("device-apps: only POST", async () => {
  const { deps } = setup();
  assertEquals((await call(deps, { method: "GET" })).status, 400);
});

Deno.test("device-apps: per-device limit is 12 per window; another device is unaffected", async () => {
  const { fake, deps } = setup();
  for (let i = 0; i < 12; i++) assertEquals((await call(deps, { ip: `10.0.0.${i}` })).status, 200);
  const limited = await call(deps, { ip: "10.0.1.1" });
  assertEquals(limited.status, 429);
  assert(Number(limited.headers.get("retry-after")) > 0);
  assertEquals(fake.synced.length, 12);
  assertEquals((await call(deps, { token: await token(OTHER), ip: "10.0.1.2" })).status, 200);
});

Deno.test("device-apps: the pre-auth IP limit stops floods before any token or database work", async () => {
  const { fake, deps } = setup();
  for (let i = 0; i < 60; i++) await call(deps, { token: null, ip: "203.0.113.9" });
  const checksBefore = fake.authChecks;
  const r = await call(deps, { token: await token(), ip: "203.0.113.9" });
  assertEquals(r.status, 429);
  assertEquals(fake.authChecks, checksBefore);
});

Deno.test("device-apps: database failures are sanitized 500s that never leak details or read as valid", async () => {
  const a = setup();
  a.fake.failAuth = true;
  const ra = await call(a.deps);
  assertEquals(ra.status, 500);
  assert(!(await ra.text()).includes("secret detail"));
  assertEquals(a.fake.synced.length, 0);

  const b = setup();
  b.fake.failSync = true;
  const rb = await call(b.deps);
  assertEquals(rb.status, 500);
  assert(!(await rb.text()).includes("hunter2"));
});

Deno.test("device-apps: logs and error bodies never contain tokens, package names or labels", async () => {
  const { deps } = setup();
  const seen: string[] = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  console.log = console.error = console.warn = console.info = (...a: unknown[]) => { seen.push(a.map(String).join(" ")); };
  try {
    const t = await token();
    await call(deps, { token: t });
    resetRateLimits();
    const bad = await call(deps, { token: t, body: { apps: [{ ...APPS[0], package_name: "secret.package", label: "SecretLabel\u0000" }] } });
    const badText = await bad.text();
    resetRateLimits();
    const joined = seen.join("\n");
    assert(!joined.includes(t));
    assert(!joined.includes("Chrome") && !joined.includes("secret.package") && !joined.includes("SecretLabel"));
    assert(!badText.includes("SecretLabel"));
  } finally {
    Object.assign(console, orig);
  }
});
