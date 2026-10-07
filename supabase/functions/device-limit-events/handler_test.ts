import { assert, assertEquals, fakeJwt } from "../_shared/test_util.ts";
import { signDeviceJwt } from "../_shared/auth.ts";
import { resetRateLimits } from "../_shared/ratelimit.ts";
import { type DeviceLimitReached, isLimitEventDayInRange, parseLimitEventDay } from "../_shared/device-limit-events.ts";
import { type Deps, handler, type LimitEventOutcome } from "./handler.ts";

const SECRET = "s".repeat(40);
const DEVICE = "d0000000-0000-4000-8000-0000000000aa";
const OTHER = "d0000000-0000-4000-8000-0000000000bb";
const CRED = "e0000000-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-10-01T12:00:00Z");
const iso = (offsetSeconds: number) => new Date(NOW + offsetSeconds * 1000).toISOString();
const BODY = { day: "2026-10-01", occurred_at: "2026-10-01T11:58:00.000Z" };

class Fake {
  active = new Set<string>([`${DEVICE}:${CRED}`, `${OTHER}:${CRED}`]);
  recorded: { deviceId: string; event: DeviceLimitReached }[] = [];
  authChecks = 0;
  outcome: LimitEventOutcome = { outcome: "recorded" };
  failRecord = false;
  isActive = (d: string, c: string) => {
    this.authChecks++;
    return Promise.resolve(this.active.has(`${d}:${c}`));
  };
  record = (deviceId: string, event: DeviceLimitReached) => {
    if (this.failRecord) return Promise.reject(new Error("rpc_failed: password=hunter2"));
    this.recorded.push({ deviceId, event });
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
  return handler(new Request("http://localhost/device-limit-events", {
    method,
    headers: {
      "content-type": "application/json",
      ...(t ? { authorization: `Bearer ${t}` } : {}),
      ...(o.ip ? { "x-forwarded-for": o.ip } : {}),
    },
    body: method === "POST" ? (o.raw ?? JSON.stringify("body" in o ? o.body : BODY)) : undefined,
  }), deps);
}

Deno.test("device-limit-events: valid report -> 200, recorded for the device in the token, minimal response", async () => {
  const { fake, deps } = setup();
  const r = await call(deps);
  assertEquals(r.status, 200);
  assertEquals(r.headers.get("cache-control"), "no-store");
  const { data } = await r.json();
  assertEquals(Object.keys(data), ["server_time"]); // never says whether anything was stored
  assertEquals(data.server_time, "2026-10-01T12:00:00.000Z");
  assertEquals(fake.recorded, [{ deviceId: DEVICE, event: BODY }]);
});

Deno.test("device-limit-events: only POST is accepted", async () => {
  const { fake, deps } = setup();
  assertEquals((await call(deps, { method: "GET" })).status, 400);
  assertEquals(fake.recorded.length, 0);
});

Deno.test("device-limit-events: the day may be one day either side of the server's UTC day, no more", async () => {
  const { fake, deps } = setup();
  for (const day of ["2026-09-30", "2026-10-01", "2026-10-02"]) {
    resetRateLimits();
    assertEquals((await call(deps, { body: { ...BODY, day } })).status, 200);
  }
  for (const day of ["2026-09-29", "2026-10-03", "2025-10-01", "2030-01-01"]) {
    resetRateLimits();
    assertEquals((await call(deps, { body: { ...BODY, day } })).status, 400);
  }
  assertEquals(fake.recorded.length, 3);
});

Deno.test("device-limit-events: time window is [now-24h+60s, now+5min-60s], inclusive", async () => {
  const { fake, deps } = setup();
  const send = async (offsetSeconds: number) => {
    resetRateLimits();
    return (await call(deps, { body: { day: "2026-10-01", occurred_at: iso(offsetSeconds) } })).status;
  };
  assertEquals(await send(-86_340), 200);
  assertEquals(await send(240), 200);
  assertEquals(await send(-86_341), 400);
  assertEquals(await send(241), 400);
  assertEquals(await send(3600), 400);
  assertEquals(fake.recorded.length, 2);
});

Deno.test("device-limit-events: validation rejects bad values and bodies", async () => {
  const { fake, deps } = setup();
  const bad: unknown[] = [
    { ...BODY, day: "2026-02-30" }, { ...BODY, day: "2026-13-01" }, { ...BODY, day: "2026-1-1" }, { ...BODY, day: "20261001" },
    { ...BODY, day: "2026-10-01T00:00:00Z" }, { ...BODY, day: "" }, { ...BODY, day: null }, { ...BODY, day: 20261001 },
    { ...BODY, occurred_at: "2026-10-01T11:58:00+00:00" }, { ...BODY, occurred_at: "yesterday" }, { ...BODY, occurred_at: "" },
    { ...BODY, occurred_at: null }, { ...BODY, occurred_at: 1759319880 },
    { day: BODY.day }, { occurred_at: BODY.occurred_at }, {}, [], null, "day", 1,
    { ...BODY, minutes: 60 }, { ...BODY, package_name: "com.example.game" }, { ...BODY, device_id: OTHER }, { ...BODY, label: "Game" },
  ];
  for (const body of bad) {
    resetRateLimits();
    assertEquals((await call(deps, { body })).status, 400);
  }
  resetRateLimits();
  assertEquals((await call(deps, { raw: "{not json" })).status, 400);
  assertEquals(fake.recorded.length, 0);
});

Deno.test("device-limit-events: the live credential check runs on every request", async () => {
  const { fake, deps } = setup();
  await call(deps);
  await call(deps);
  assertEquals(fake.authChecks, 2);
});

Deno.test("device-limit-events: no / malformed / forged / parent / cid-less tokens -> identical 401, nothing recorded", async () => {
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

Deno.test("device-limit-events: revoked credential -> 401 first, even for an invalid body (auth before validation)", async () => {
  const { fake, deps } = setup();
  fake.active.clear();
  assertEquals((await call(deps)).status, 401);
  assertEquals((await call(deps, { body: {} })).status, 401);
  assertEquals(fake.recorded.length, 0);
});

Deno.test("device-limit-events: revoked between guard and write (record says inactive) -> the same 401 body", async () => {
  const a = setup();
  a.fake.active.clear();
  const expected = await (await call(a.deps)).json();
  const b = setup();
  b.fake.outcome = { outcome: "inactive" };
  const r = await call(b.deps);
  assertEquals(r.status, 401);
  assertEquals(await r.json(), expected);
});

Deno.test("device-limit-events: the device id comes from the token, never from the body", async () => {
  const { fake, deps } = setup();
  assertEquals((await call(deps, { token: await token(OTHER) })).status, 200);
  assertEquals(fake.recorded[0]?.deviceId, OTHER);
});

Deno.test("device-limit-events: per-device limit is 6 an hour (a real report is one a day)", async () => {
  const { deps } = setup();
  for (let i = 0; i < 6; i++) assertEquals((await call(deps)).status, 200);
  const r = await call(deps);
  assertEquals(r.status, 429);
  assert(r.headers.get("retry-after") !== null);
  assertEquals((await call(deps, { token: await token(OTHER) })).status, 200); // another device is unaffected
});

Deno.test("device-limit-events: a database failure is a sanitized 500 with no detail", async () => {
  const { fake, deps } = setup();
  fake.failRecord = true;
  const r = await call(deps);
  assertEquals(r.status, 500);
  const text = JSON.stringify(await r.json());
  assert(!text.includes("hunter2") && !text.includes("rpc_failed"));
});

Deno.test("device-limit-events: the day parser rejects impossible dates and the range helper works on UTC days", () => {
  assertEquals(parseLimitEventDay("2026-10-01"), Date.parse("2026-10-01T00:00:00Z"));
  assertEquals(parseLimitEventDay("2026-02-29"), null);
  assertEquals(parseLimitEventDay("2028-02-29"), Date.parse("2028-02-29T00:00:00Z"));
  assertEquals(isLimitEventDayInRange("2026-10-02", Date.parse("2026-10-01T23:59:59Z")), true);
  assertEquals(isLimitEventDayInRange("2026-10-03", Date.parse("2026-10-01T23:59:59Z")), false);
  assertEquals(isLimitEventDayInRange("2026-09-30", Date.parse("2026-10-01T00:00:00Z")), true);
  assertEquals(isLimitEventDayInRange("2026-09-29", Date.parse("2026-10-01T00:00:00Z")), false);
});
