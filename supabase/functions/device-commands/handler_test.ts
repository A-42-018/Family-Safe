import { assert, assertEquals, fakeJwt } from "../_shared/test_util.ts";
import { signDeviceJwt } from "../_shared/auth.ts";
import { resetRateLimits } from "../_shared/ratelimit.ts";
import { COMMAND_PULL_DEFAULT, type CommandAck, type DeviceCommandRow } from "../_shared/device-commands.ts";
import { type AckOutcome, type Deps, handler, type PullOutcome } from "./handler.ts";

const SECRET = "s".repeat(40);
const DEVICE = "d0000000-0000-4000-8000-0000000000aa";
const OTHER = "d0000000-0000-4000-8000-0000000000bb";
const CRED = "e0000000-0000-4000-8000-000000000001";
const CMD = "c1000000-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-10-01T12:00:00Z");
const COMMAND: DeviceCommandRow = { id: CMD, type: "SYNC_CONFIG", expires_at: "2026-10-02T12:00:00+00:00" };
const ACK = { command_id: CMD, status: "EXECUTED" };

class Fake {
  active = new Set<string>([`${DEVICE}:${CRED}`, `${OTHER}:${CRED}`]);
  pulls: { deviceId: string; limit: number }[] = [];
  acks: { deviceId: string; ack: CommandAck }[] = [];
  authChecks = 0;
  pullResult: PullOutcome = { outcome: "ok", commands: [COMMAND] };
  ackResult: AckOutcome = { outcome: "acked" };
  fail = false;
  isActive = (d: string, c: string) => {
    this.authChecks++;
    return Promise.resolve(this.active.has(`${d}:${c}`));
  };
  pull = (deviceId: string, limit: number) => {
    if (this.fail) return Promise.reject(new Error("rpc_failed: password=hunter2"));
    this.pulls.push({ deviceId, limit });
    return Promise.resolve(this.pullResult);
  };
  ack = (deviceId: string, ack: CommandAck) => {
    if (this.fail) return Promise.reject(new Error("rpc_failed: password=hunter2"));
    this.acks.push({ deviceId, ack });
    return Promise.resolve(this.ackResult);
  };
}

function setup() {
  resetRateLimits();
  const fake = new Fake();
  const deps: Deps = { deviceJwtSecret: SECRET, isActive: fake.isActive, pull: fake.pull, ack: fake.ack, now: () => NOW };
  return { fake, deps };
}

const token = (sub = DEVICE, cid: string | null = CRED) =>
  signDeviceJwt({ sub, ...(cid ? { cid } : {}), jti: crypto.randomUUID() }, SECRET, Math.floor(NOW / 1000));

async function call(deps: Deps, o: { token?: string | null; body?: unknown; raw?: string; method?: string } = {}) {
  const method = o.method ?? "GET";
  const t = o.token === undefined ? await token() : o.token;
  return handler(new Request("http://localhost/device-commands", {
    method,
    headers: { "content-type": "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}) },
    body: method === "POST" ? (o.raw ?? JSON.stringify("body" in o ? o.body : ACK)) : undefined,
  }), deps);
}

Deno.test("device-commands GET: returns the commands and the server time, never a payload", async () => {
  const { fake, deps } = setup();
  const r = await call(deps);
  assertEquals(r.status, 200);
  assertEquals(r.headers.get("cache-control"), "no-store");
  const { data } = await r.json();
  assertEquals(Object.keys(data).sort(), ["commands", "server_time"]);
  assertEquals(data.commands, [COMMAND]);
  assertEquals(Object.keys(data.commands[0]).sort(), ["expires_at", "id", "type"]);
  assertEquals(data.server_time, "2026-10-01T12:00:00.000Z");
  assertEquals(fake.pulls, [{ deviceId: DEVICE, limit: COMMAND_PULL_DEFAULT }]);
});

Deno.test("device-commands GET: no commands is an empty list, not an error", async () => {
  const { fake, deps } = setup();
  fake.pullResult = { outcome: "ok", commands: [] };
  const r = await call(deps);
  assertEquals(r.status, 200);
  assertEquals((await r.json()).data.commands, []);
});

Deno.test("device-commands: other methods are rejected", async () => {
  const { fake, deps } = setup();
  for (const method of ["PUT", "DELETE", "PATCH"]) assertEquals((await call(deps, { method })).status, 400);
  assertEquals(fake.pulls.length + fake.acks.length, 0);
});

Deno.test("device-commands POST: a valid acknowledgement is recorded for the device in the token and answers with the time only", async () => {
  const { fake, deps } = setup();
  const r = await call(deps, { method: "POST" });
  assertEquals(r.status, 200);
  const { data } = await r.json();
  assertEquals(Object.keys(data), ["server_time"]);
  assertEquals(fake.acks, [{ deviceId: DEVICE, ack: ACK }]);
  resetRateLimits();
  assertEquals((await call(deps, { method: "POST", body: { command_id: CMD, status: "FAILED" } })).status, 200);
});

Deno.test("device-commands POST: replayed, late and unchanged acknowledgements are all a plain 200 (nothing to retry)", async () => {
  const { fake, deps } = setup();
  for (const outcome of ["unchanged", "expired"] as const) {
    resetRateLimits();
    fake.ackResult = { outcome };
    const r = await call(deps, { method: "POST" });
    assertEquals(r.status, 200);
    assertEquals(Object.keys((await r.json()).data), ["server_time"]);
  }
});

Deno.test("device-commands POST: a command that is not this device's is a 404, the same for a foreign and a missing one", async () => {
  const { fake, deps } = setup();
  fake.ackResult = { outcome: "not_found" };
  const r = await call(deps, { method: "POST" });
  assertEquals(r.status, 404);
  assertEquals((await r.json()).error.code, "not_found");
});

Deno.test("device-commands POST: validation rejects bad statuses, ids and extra keys", async () => {
  const { fake, deps } = setup();
  const bad: unknown[] = [
    { command_id: CMD, status: "DELIVERED" }, { command_id: CMD, status: "EXPIRED" }, { command_id: CMD, status: "executed" }, { command_id: CMD, status: "" },
    { command_id: CMD, status: null }, { command_id: "x", status: "EXECUTED" }, { command_id: null, status: "EXECUTED" }, { status: "EXECUTED" }, { command_id: CMD },
    { command_id: CMD, status: "EXECUTED", device_id: OTHER }, { command_id: CMD, status: "EXECUTED", payload: {} }, {}, [], null, "x",
  ];
  for (const body of bad) {
    resetRateLimits();
    assertEquals((await call(deps, { method: "POST", body })).status, 400);
  }
  resetRateLimits();
  assertEquals((await call(deps, { method: "POST", raw: "{not json" })).status, 400);
  assertEquals(fake.acks.length, 0);
});

Deno.test("device-commands: the live credential check runs on every request", async () => {
  const { fake, deps } = setup();
  await call(deps);
  await call(deps, { method: "POST" });
  assertEquals(fake.authChecks, 2);
});

Deno.test("device-commands: no / malformed / forged / parent / cid-less tokens -> identical 401 on both methods", async () => {
  const { fake, deps } = setup();
  const forged = (await token()).slice(0, -3) + "AAA";
  const cases: (string | null)[] = [null, "not-a-jwt", forged, fakeJwt({ sub: DEVICE, role: "authenticated", exp: 9999999999, iat: 1 }), await token(DEVICE, null)];
  const codes = new Set<string>();
  for (const method of ["GET", "POST"]) {
    for (const t of cases) {
      const r = await call(deps, { token: t, method });
      assertEquals(r.status, 401);
      codes.add(JSON.stringify((await r.json()).error.code));
    }
  }
  assertEquals(codes.size, 1);
  assertEquals(fake.pulls.length + fake.acks.length, 0);
});

Deno.test("device-commands: revoked credential -> 401 first (even for a bad body); revoked mid-request -> the same 401 body", async () => {
  const a = setup();
  a.fake.active.clear();
  const expected = await (await call(a.deps)).json();
  assertEquals((await call(a.deps, { method: "POST", body: {} })).status, 401);
  const b = setup();
  b.fake.pullResult = { outcome: "inactive" };
  const r = await call(b.deps);
  assertEquals(r.status, 401);
  assertEquals(await r.json(), expected);
  const c = setup();
  c.fake.ackResult = { outcome: "inactive" };
  const r2 = await call(c.deps, { method: "POST" });
  assertEquals(r2.status, 401);
  assertEquals(await r2.json(), expected);
});

Deno.test("device-commands: the device id comes from the token, never from the request", async () => {
  const { fake, deps } = setup();
  assertEquals((await call(deps, { token: await token(OTHER) })).status, 200);
  assertEquals(fake.pulls[0]?.deviceId, OTHER);
});

Deno.test("device-commands: per-device limit is 60 an hour for pulls and acks together", async () => {
  const { deps } = setup();
  for (let i = 0; i < 60; i++) assertEquals((await call(deps, { method: i % 2 === 0 ? "GET" : "POST" })).status, 200);
  const r = await call(deps);
  assertEquals(r.status, 429);
  assert(r.headers.get("retry-after") !== null);
  assertEquals((await call(deps, { token: await token(OTHER) })).status, 200);
});

Deno.test("device-commands: a database failure is a sanitized 500 with no detail", async () => {
  const { fake, deps } = setup();
  fake.fail = true;
  for (const method of ["GET", "POST"]) {
    resetRateLimits();
    const r = await call(deps, { method });
    assertEquals(r.status, 500);
    const text = JSON.stringify(await r.json());
    assert(!text.includes("hunter2") && !text.includes("rpc_failed"));
  }
});
