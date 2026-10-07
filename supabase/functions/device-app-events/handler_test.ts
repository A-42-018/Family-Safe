import { assert, assertEquals, fakeJwt } from "../_shared/test_util.ts";
import { signDeviceJwt } from "../_shared/auth.ts";
import { resetRateLimits } from "../_shared/ratelimit.ts";
import { type AppEvent, DEVICE_APP_EVENTS_MAX, isAppEventTimeInRange, parseAppEventTime } from "../_shared/device-app-events.ts";
import { type AppEventsOutcome, type Deps, handler } from "./handler.ts";

const SECRET = "s".repeat(40);
const DEVICE = "d0000000-0000-4000-8000-0000000000aa";
const OTHER = "d0000000-0000-4000-8000-0000000000bb";
const CRED = "e0000000-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-10-01T12:00:00Z");
const iso = (offsetSeconds: number) => new Date(NOW + offsetSeconds * 1000).toISOString();
const EVENT = { type: "BLOCKED_APP_ATTEMPT", package_name: "com.example.game", occurred_at: "2026-10-01T11:58:00.000Z" };
const BODY = { events: [EVENT] };

class Fake {
  active = new Set<string>([`${DEVICE}:${CRED}`, `${OTHER}:${CRED}`]);
  recorded: { deviceId: string; events: AppEvent[] }[] = [];
  authChecks = 0;
  outcome: AppEventsOutcome = { outcome: "recorded" };
  failRecord = false;
  failAuth = false;
  isActive = (d: string, c: string) => {
    this.authChecks++;
    if (this.failAuth) return Promise.reject(new Error("db down: secret detail"));
    return Promise.resolve(this.active.has(`${d}:${c}`));
  };
  record = (deviceId: string, events: AppEvent[]) => {
    if (this.failRecord) return Promise.reject(new Error("rpc_failed: password=hunter2"));
    this.recorded.push({ deviceId, events });
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
  return handler(new Request("http://localhost/device-app-events", {
    method,
    headers: {
      "content-type": "application/json",
      ...(t ? { authorization: `Bearer ${t}` } : {}),
      ...(o.ip ? { "x-forwarded-for": o.ip } : {}),
    },
    body: method === "POST" ? (o.raw ?? JSON.stringify("body" in o ? o.body : BODY)) : undefined,
  }), deps);
}

const ev = (over: Record<string, unknown> = {}) => ({ ...EVENT, ...over });

Deno.test("device-app-events: valid report -> 200, recorded for the device in the token, minimal response", async () => {
  const { fake, deps } = setup();
  const r = await call(deps);
  assertEquals(r.status, 200);
  assertEquals(r.headers.get("cache-control"), "no-store");
  const { data } = await r.json();
  assertEquals(Object.keys(data), ["server_time"]); // never says what was stored or ignored
  assertEquals(data.server_time, "2026-10-01T12:00:00.000Z");
  assertEquals(fake.recorded, [{ deviceId: DEVICE, events: [EVENT] }]);
});

Deno.test("device-app-events: an 'ignored' result looks exactly like a recorded one (the answer reveals nothing about the rules)", async () => {
  // The handler cannot tell them apart by design: the RPC reports 'recorded' for the call, counts stay in the database.
  const { fake, deps } = setup();
  assertEquals((await call(deps, { body: { events: [ev({ package_name: "com.example.unrestricted" })] } })).status, 200);
  assertEquals(fake.recorded.length, 1);
});

Deno.test("device-app-events: 1 and 20 events are accepted; 0 and 21 are 400 (never truncated)", async () => {
  const { fake, deps } = setup();
  const many = (n: number) => ({ events: Array.from({ length: n }, (_, i) => ev({ package_name: `com.example.app${i}` })) });
  assertEquals((await call(deps, { body: many(1) })).status, 200);
  resetRateLimits();
  assertEquals((await call(deps, { body: many(DEVICE_APP_EVENTS_MAX) })).status, 200);
  resetRateLimits();
  assertEquals((await call(deps, { body: many(0) })).status, 400);
  assertEquals((await call(deps, { body: many(DEVICE_APP_EVENTS_MAX + 1) })).status, 400);
  assertEquals(fake.recorded.length, 2);
});

Deno.test("device-app-events: time window is [now-24h+60s, now+5min-60s], inclusive", async () => {
  const { fake, deps } = setup();
  const send = async (offsetSeconds: number) => {
    resetRateLimits();
    return (await call(deps, { body: { events: [ev({ occurred_at: iso(offsetSeconds) })] } })).status;
  };
  assertEquals(await send(-86_340), 200); // 23 h 59 min back
  assertEquals(await send(240), 200); // 4 min ahead
  assertEquals(await send(0), 200);
  assertEquals(await send(-86_341), 400);
  assertEquals(await send(241), 400);
  assertEquals(await send(-90_000), 400); // 25 h back
  assertEquals(await send(3600), 400); // 1 h ahead
  assertEquals(fake.recorded.length, 3);
});

Deno.test("device-app-events: one event outside the window rejects the whole batch", async () => {
  const { fake, deps } = setup();
  const r = await call(deps, { body: { events: [ev(), ev({ occurred_at: iso(-100_000) })] } });
  assertEquals(r.status, 400);
  assertEquals(fake.recorded.length, 0);
});

Deno.test("device-app-events: time format accepts UTC with 0 or 1-9 fraction digits and nothing else", async () => {
  const { fake, deps } = setup();
  const good = ["2026-10-01T11:58:00Z", "2026-10-01T11:58:00.1Z", "2026-10-01T11:58:00.123Z", "2026-10-01T11:58:00.123456789Z"];
  for (const occurred_at of good) {
    resetRateLimits();
    assertEquals((await call(deps, { body: { events: [ev({ occurred_at })] } })).status, 200);
  }
  const bad = [
    "2026-10-01T11:58:00+00:00", "2026-10-01T11:58:00", "2026-10-01 11:58:00Z", "2026-10-01T11:58Z", "2026-10-01T11:58:00.Z",
    "2026-10-01T11:58:00.1234567890Z", "2026-02-30T11:58:00Z", "2026-13-01T11:58:00Z", "2026-10-01T24:00:00Z", "2026-10-01T11:60:00Z",
    "2026-10-01T11:58:60Z", "2026-10-01t11:58:00z", " 2026-10-01T11:58:00Z", "2026-10-01T11:58:00Z ", "", "yesterday", 1759319880, null,
  ];
  for (const occurred_at of bad) {
    resetRateLimits();
    assertEquals((await call(deps, { body: { events: [ev({ occurred_at })] } })).status, 400);
  }
  assertEquals(fake.recorded.length, good.length);
});

Deno.test("device-app-events: parseAppEventTime truncates the fraction to milliseconds and rejects impossible dates", () => {
  assertEquals(parseAppEventTime("2026-10-01T12:00:00Z"), NOW);
  assertEquals(parseAppEventTime("2026-10-01T12:00:00.5Z"), NOW + 500);
  assertEquals(parseAppEventTime("2026-10-01T12:00:00.057Z"), NOW + 57);
  assertEquals(parseAppEventTime("2026-10-01T12:00:00.123999999Z"), NOW + 123);
  assertEquals(parseAppEventTime("2026-02-29T12:00:00Z"), null); // 2026 is not a leap year
  assertEquals(parseAppEventTime("2028-02-29T12:00:00Z"), Date.parse("2028-02-29T12:00:00Z"));
  assertEquals(parseAppEventTime("0099-10-01T12:00:00Z"), null);
  assertEquals(isAppEventTimeInRange("2026-10-01T12:00:00Z", NOW), true);
});

Deno.test("device-app-events: validation rejects bad values and bodies", async () => {
  const { fake, deps } = setup();
  const { type: _t, ...noType } = EVENT;
  const { package_name: _p, ...noPackage } = EVENT;
  const { occurred_at: _o, ...noTime } = EVENT;
  const bad: unknown[] = [
    { events: [ev({ type: "OTHER_EVENT" })] }, { events: [ev({ type: "blocked_app_attempt" })] }, { events: [ev({ type: "" })] },
    { events: [ev({ type: null })] }, { events: [ev({ type: 1 })] },
    { events: [ev({ package_name: "nodots" })] }, { events: [ev({ package_name: "1com.example" })] },
    { events: [ev({ package_name: "com..example" })] }, { events: [ev({ package_name: "com.ex-ample.x" })] },
    { events: [ev({ package_name: "" })] }, { events: [ev({ package_name: 5 })] }, { events: [ev({ package_name: null })] },
    { events: [ev({ package_name: `com.${"a".repeat(252)}` })] }, // 256 characters
    { events: [ev({ label: "Game" })] }, { events: [ev({ foreground_ms: 5 })] }, { events: [ev({ device_id: OTHER })] },
    { events: [noType] }, { events: [noPackage] }, { events: [noTime] },
    { events: null }, { events: {} }, { events: "x" }, { events: [null] }, { events: ["com.example.game"] }, { events: [[]] },
    { events: [EVENT], extra: 1 }, {}, [], null, "events", 1, { event: EVENT },
  ];
  for (const body of bad) {
    resetRateLimits();
    assertEquals((await call(deps, { body })).status, 400);
  }
  resetRateLimits();
  assertEquals((await call(deps, { raw: "{not json" })).status, 400);
  assertEquals(fake.recorded.length, 0);
});

Deno.test("device-app-events: a package name of exactly 255 characters is accepted", async () => {
  const { fake, deps } = setup();
  const name = `com.${"a".repeat(251)}`; // 255
  assertEquals(name.length, 255);
  assertEquals((await call(deps, { body: { events: [ev({ package_name: name })] } })).status, 200);
  assertEquals(fake.recorded.length, 1);
});

Deno.test("device-app-events: the body can never name a device", async () => {
  const { fake, deps } = setup();
  assertEquals((await call(deps, { body: { ...BODY, device_id: OTHER } })).status, 400);
  assertEquals((await call(deps, { body: { events: [ev({ device_id: OTHER })] } })).status, 400);
  assertEquals(fake.recorded.length, 0);
});

Deno.test("device-app-events: wrong content type -> 400", async () => {
  const { deps } = setup();
  const t = await token();
  const r = await handler(new Request("http://localhost/device-app-events", {
    method: "POST", headers: { "content-type": "text/plain", authorization: `Bearer ${t}` }, body: JSON.stringify(BODY),
  }), deps);
  assertEquals(r.status, 400);
});

Deno.test("device-app-events: the live credential check runs on every request", async () => {
  const { fake, deps } = setup();
  await call(deps);
  await call(deps);
  assertEquals(fake.authChecks, 2);
});

Deno.test("device-app-events: no / malformed / forged / parent / cid-less tokens -> identical 401, nothing recorded", async () => {
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

Deno.test("device-app-events: revoked / unknown credential -> 401 and nothing recorded", async () => {
  const { fake, deps } = setup();
  fake.active.clear();
  assertEquals((await call(deps)).status, 401);
  assertEquals(fake.recorded.length, 0);
});

Deno.test("device-app-events: an invalid body from an inactive device is still the 401, not a 400 (auth first)", async () => {
  const { fake, deps } = setup();
  fake.active.clear();
  assertEquals((await call(deps, { body: { events: [] } })).status, 401);
});

Deno.test("device-app-events: revoked between guard and write (record says inactive) -> the same 401 body", async () => {
  const a = setup();
  a.fake.active.clear();
  const first = await (await call(a.deps)).text();
  const b = setup();
  b.fake.outcome = { outcome: "inactive" };
  const r = await call(b.deps);
  assertEquals(r.status, 401);
  assertEquals(await r.text(), first);
});

Deno.test("device-app-events: only POST", async () => {
  const { deps } = setup();
  assertEquals((await call(deps, { method: "GET" })).status, 400);
});

Deno.test("device-app-events: per-device limit is 30 per window; another device is unaffected", async () => {
  const { fake, deps } = setup();
  for (let i = 0; i < 30; i++) assertEquals((await call(deps, { ip: `10.0.${Math.floor(i / 200)}.${i % 200}` })).status, 200);
  const limited = await call(deps, { ip: "10.1.1.1" });
  assertEquals(limited.status, 429);
  assert(Number(limited.headers.get("retry-after")) > 0);
  assertEquals(fake.recorded.length, 30);
  assertEquals((await call(deps, { token: await token(OTHER), ip: "10.1.1.2" })).status, 200);
});

Deno.test("device-app-events: the pre-auth IP limit stops floods before any token or database work", async () => {
  const { fake, deps } = setup();
  for (let i = 0; i < 60; i++) await call(deps, { token: null, ip: "203.0.113.9" });
  const checksBefore = fake.authChecks;
  const r = await call(deps, { token: await token(), ip: "203.0.113.9" });
  assertEquals(r.status, 429);
  assertEquals(fake.authChecks, checksBefore);
});

Deno.test("device-app-events: database failures are sanitized 500s that never leak details or read as valid", async () => {
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

Deno.test("device-app-events: logs and error bodies never contain tokens or package names", async () => {
  const { deps } = setup();
  const seen: string[] = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  console.log = console.error = console.warn = console.info = (...a: unknown[]) => { seen.push(a.map(String).join(" ")); };
  try {
    const t = await token();
    await call(deps, { token: t });
    resetRateLimits();
    const bad = await call(deps, { token: t, body: { events: [ev({ package_name: "secret.package", type: "OTHER_EVENT" })] } });
    const badText = await bad.text();
    resetRateLimits();
    const joined = seen.join("\n");
    assert(!joined.includes(t));
    assert(!joined.includes("com.example.game") && !joined.includes("secret.package"));
    assert(!badText.includes("secret.package"));
  } finally {
    Object.assign(console, orig);
  }
});
