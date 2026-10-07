import { assert, assertEquals, fakeJwt } from "../_shared/test_util.ts";
import { signDeviceJwt } from "../_shared/auth.ts";
import { resetRateLimits } from "../_shared/ratelimit.ts";
import { type Deps, handler } from "./handler.ts";

const DEV = "d0000000-0000-4000-8000-00000000000a";
const now = () => Math.floor(Date.now() / 1000);
const token = (over: Record<string, unknown> = {}) => fakeJwt({ sub: "parent-1", role: "authenticated", exp: now() + 3600, iat: now(), ...over });

function setup(over: Partial<Deps> = {}) {
  resetRateLimits();
  const calls: { parentId: string; deviceId: string; ip: string | null }[] = [];
  const state = new Map<string, "ENROLLED" | "REVOKED">([[DEV, "ENROLLED"]]); // owned by parent-1
  const deps: Deps = {
    verify: () => Promise.resolve({ id: "parent-1" }),
    revoke: (a) => {
      calls.push(a);
      const s = state.get(a.deviceId);
      if (!s || a.parentId !== "parent-1") return Promise.resolve(null);
      if (s === "REVOKED") return Promise.resolve("already_revoked");
      state.set(a.deviceId, "REVOKED");
      return Promise.resolve("revoked");
    },
    ...over,
  };
  return { deps, calls, state };
}

const call = (deps: Deps, o: { token?: string | null; body?: unknown; ip?: string; method?: string } = {}) => {
  const method = o.method ?? "POST";
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (o.token !== null) headers.authorization = `Bearer ${o.token ?? token()}`;
  if (o.ip) headers["x-forwarded-for"] = o.ip;
  return handler(new Request("http://localhost/device-revoke", { method, headers, body: method === "POST" ? JSON.stringify(o.body ?? { device_id: DEV }) : undefined }), deps);
};

Deno.test("device-revoke: owner revokes; parent id and normalised IP are passed to the store", async () => {
  const { deps, calls, state } = setup();
  const r = await call(deps, { ip: "203.0.113.7, 10.0.0.1" });
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { data: { revoked: true, already_revoked: false } });
  assertEquals(calls, [{ parentId: "parent-1", deviceId: DEV, ip: "203.0.113.7" }]);
  assertEquals(state.get(DEV), "REVOKED");
});

Deno.test("device-revoke: idempotent second call reports already_revoked", async () => {
  const { deps } = setup();
  await call(deps);
  const r = await call(deps);
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { data: { revoked: true, already_revoked: true } });
});

Deno.test("device-revoke: malformed client IP is stored as null, never blocks the request", async () => {
  const { deps, calls } = setup();
  assertEquals((await call(deps, { ip: "not an ip" })).status, 200);
  assertEquals(calls[0].ip, null);
});

Deno.test("device-revoke: foreign and unknown device are indistinguishable (404)", async () => {
  const { deps, state } = setup({ verify: () => Promise.resolve({ id: "parent-2" }) });
  const foreign = await call(deps, { token: token({ sub: "parent-2" }) });
  const unknown = await call(deps, { token: token({ sub: "parent-2" }), body: { device_id: "d0000000-0000-4000-8000-0000000000ff" } });
  assertEquals(foreign.status, 404);
  assertEquals(unknown.status, 404);
  assertEquals(await foreign.text(), await unknown.text());
  assertEquals(state.get(DEV), "ENROLLED");
});

Deno.test("device-revoke: unauthenticated / device JWT / bad roles are refused before the store", async () => {
  const { deps, calls } = setup();
  assertEquals((await call(deps, { token: null })).status, 401);
  assertEquals((await call(deps, { token: token({ role: "anon" }) })).status, 401);
  const deviceJwt = await signDeviceJwt({ sub: DEV }, "s".repeat(40));
  assertEquals((await call(deps, { token: deviceJwt })).status, 403); // a device cannot revoke itself or others here
  assertEquals(calls.length, 0);
});

Deno.test("device-revoke: validation, method, Auth outage, store failure", async () => {
  const { deps, calls } = setup();
  assertEquals((await call(deps, { body: { device_id: "x" } })).status, 400);
  assertEquals((await call(deps, { body: { device_id: DEV, child_id: DEV } })).status, 400);
  assertEquals((await call(deps, { method: "GET" })).status, 400);
  assertEquals(calls.length, 0);
  const outage = setup({ verify: () => Promise.reject(new Error("boom")) });
  assertEquals((await call(outage.deps)).status, 500);
  const broken = setup({ revoke: () => Promise.reject(new Error("relation devices does not exist")) });
  const r = await call(broken.deps);
  assertEquals(r.status, 500);
  assert(!(await r.text()).includes("relation"));
});

Deno.test("device-revoke: per-parent limit (20 / 5 min) -> 429", async () => {
  const { deps } = setup();
  for (let i = 0; i < 20; i++) assertEquals((await call(deps)).status, 200);
  const r = await call(deps);
  assertEquals(r.status, 429);
  assert(Number(r.headers.get("retry-after")) > 0);
});
