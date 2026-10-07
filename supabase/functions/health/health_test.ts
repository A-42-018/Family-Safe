import { assert, assertEquals } from "../_shared/test_util.ts";
import { handler } from "./handler.ts";
import { resetRateLimits } from "../_shared/ratelimit.ts";

Deno.test("health: 200 envelope, no-store, no secret names leaked", async () => {
  resetRateLimits();
  const r = handler(new Request("http://x/health"), {});
  assertEquals(r.status, 200);
  assertEquals(r.headers.get("cache-control"), "no-store");
  const body = await r.json();
  assertEquals(body.data.status, "degraded");
  assert(!JSON.stringify(body).includes("DEVICE_JWT_SECRET"));
});

Deno.test("health: rejects non-GET, handles preflight, rate limits", async () => {
  resetRateLimits();
  assertEquals(handler(new Request("http://x", { method: "POST" }), {}).status, 400);
  assertEquals(handler(new Request("http://x", { method: "OPTIONS", headers: { origin: "http://localhost:3000" } }), {}).status, 204);
  resetRateLimits();
  let last = 200;
  for (let i = 0; i < 61; i++) last = handler(new Request("http://x", { headers: { "x-forwarded-for": "9.9.9.9" } }), {}).status;
  assertEquals(last, 429);
});
