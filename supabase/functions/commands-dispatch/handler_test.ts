import { assert, assertEquals } from "../_shared/test_util.ts";
import { resetRateLimits } from "../_shared/ratelimit.ts";
import { safeEqual } from "../_shared/validate.ts";
import type { SendResult } from "../_shared/fcm.ts";
import { DISPATCH_BATCH, type Deps, type DueCommand, handler } from "./handler.ts";

const SECRET = "c".repeat(40);
const mk = (n: number): DueCommand => ({ commandId: `c1000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`, deviceId: `d0000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`, token: `token-${n}-`.padEnd(24, "x") });

class Fake {
  due: DueCommand[] = [mk(1), mk(2), mk(3)];
  results = new Map<string, SendResult>();
  sendCalls: { token: string; commandId: string }[] = [];
  pushed: string[] = [];
  forgotten: { deviceId: string; token: string }[] = [];
  listLimits: number[] = [];
  failList = false;
  listDue = (limit: number) => {
    if (this.failList) return Promise.reject(new Error("rpc_failed: password=hunter2"));
    this.listLimits.push(limit);
    return Promise.resolve(this.due);
  };
  send = (token: string, commandId: string) => {
    this.sendCalls.push({ token, commandId });
    return Promise.resolve(this.results.get(commandId) ?? "sent");
  };
  markPushed = (id: string) => { this.pushed.push(id); return Promise.resolve(); };
  forgetToken = (deviceId: string, token: string) => { this.forgotten.push({ deviceId, token }); return Promise.resolve(); };
}

function setup() {
  resetRateLimits();
  const fake = new Fake();
  const deps: Deps = { cronSecret: SECRET, listDue: fake.listDue, send: fake.send, markPushed: fake.markPushed, forgetToken: fake.forgetToken };
  return { fake, deps };
}

const call = (deps: Deps, o: { secret?: string | null; method?: string; ip?: string } = {}) =>
  handler(new Request("http://localhost/commands-dispatch", {
    method: o.method ?? "POST",
    headers: { ...(o.secret === null ? {} : { "x-cron-secret": o.secret ?? SECRET }), ...(o.ip ? { "x-forwarded-for": o.ip } : {}) },
  }), deps);

Deno.test("commands-dispatch: with the right secret every due command is pushed and counted, nothing else is returned", async () => {
  const { fake, deps } = setup();
  const r = await call(deps);
  assertEquals(r.status, 200);
  assertEquals(r.headers.get("cache-control"), "no-store");
  assertEquals((await r.json()).data, { sent: 3, invalid: 0, failed: 0 });
  assertEquals(fake.listLimits, [DISPATCH_BATCH]);
  assertEquals(fake.pushed, fake.due.map((c) => c.commandId));
  assertEquals(fake.sendCalls.map((c) => c.commandId), fake.due.map((c) => c.commandId));
});

Deno.test("commands-dispatch: a dead token is forgotten and its command stays pending; a transient failure changes nothing", async () => {
  const { fake, deps } = setup();
  fake.results.set(fake.due[1].commandId, "invalid_token");
  fake.results.set(fake.due[2].commandId, "retry");
  const r = await call(deps);
  assertEquals((await r.json()).data, { sent: 1, invalid: 1, failed: 1 });
  assertEquals(fake.pushed, [fake.due[0].commandId]);
  assertEquals(fake.forgotten, [{ deviceId: fake.due[1].deviceId, token: fake.due[1].token }]);
});

Deno.test("commands-dispatch: nothing due is a plain zero answer", async () => {
  const { fake, deps } = setup();
  fake.due = [];
  assertEquals((await (await call(deps)).json()).data, { sent: 0, invalid: 0, failed: 0 });
  assertEquals(fake.sendCalls.length, 0);
});

Deno.test("commands-dispatch: a missing, wrong, empty or near-miss secret is the same 401 and nothing is read or sent", async () => {
  const { fake, deps } = setup();
  const bodies = new Set<string>();
  for (const secret of [null, "", "wrong", SECRET.slice(0, -1), `${SECRET}x`, SECRET.toUpperCase()]) {
    const r = await call(deps, { secret });
    assertEquals(r.status, 401);
    bodies.add(JSON.stringify(await r.json()));
  }
  assertEquals(bodies.size, 1);
  assertEquals(fake.listLimits.length + fake.sendCalls.length, 0);
});

Deno.test("commands-dispatch: a configured secret shorter than 32 characters never matches, even when sent exactly", async () => {
  const { deps } = setup();
  const r = await call({ ...deps, cronSecret: "short" }, { secret: "short" });
  assertEquals(r.status, 401);
});

Deno.test("commands-dispatch: only POST is accepted", async () => {
  const { fake, deps } = setup();
  for (const method of ["GET", "PUT", "DELETE"]) assertEquals((await call(deps, { method })).status, 400);
  assertEquals(fake.listLimits.length, 0);
});

Deno.test("commands-dispatch: the per-IP limit runs before the secret is compared (30 tries in 5 minutes)", async () => {
  const { deps } = setup();
  for (let i = 0; i < 30; i++) assertEquals((await call(deps, { secret: "wrong", ip: "203.0.113.9" })).status, 401);
  const r = await call(deps, { secret: SECRET, ip: "203.0.113.9" });
  assertEquals(r.status, 429);
  assert(r.headers.get("retry-after") !== null);
});

Deno.test("commands-dispatch: a database failure is a sanitized 500 with no detail", async () => {
  const { fake, deps } = setup();
  fake.failList = true;
  const r = await call(deps);
  assertEquals(r.status, 500);
  const text = JSON.stringify(await r.json());
  assert(!text.includes("hunter2") && !text.includes("rpc_failed"));
});

Deno.test("commands-dispatch: the answer never contains a token or an id", async () => {
  const { fake, deps } = setup();
  const text = await (await call(deps)).text();
  for (const c of fake.due) assert(!text.includes(c.token) && !text.includes(c.commandId) && !text.includes(c.deviceId));
});

Deno.test("safeEqual: equal, different, different length and empty strings", () => {
  assertEquals(safeEqual("abc", "abc"), true);
  assertEquals(safeEqual("abc", "abd"), false);
  assertEquals(safeEqual("abc", "abcd"), false);
  assertEquals(safeEqual("", ""), true);
  assertEquals(safeEqual("", "a"), false);
  assertEquals(safeEqual("é", "é"), true);
});
