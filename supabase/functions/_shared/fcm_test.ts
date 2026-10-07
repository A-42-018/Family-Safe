import { assert, assertEquals, assertRejects, assertThrows } from "./test_util.ts";
import { buildWakeMessage, classifyFcmError, createFcmSender, type FcmServiceAccount, parseServiceAccount, pemToDer, signAssertion } from "./fcm.ts";

const CMD = "c1000000-0000-4000-8000-000000000001";
const DEVICE_TOKEN = "fGh1:APA91bHx_-.abcdefghijklmnopqrstuvwxyz0123456789";

async function makeAccount(): Promise<{ sa: FcmServiceAccount; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const b64 = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, "$1\n");
  return {
    sa: { client_email: "svc@fs-test-project.iam.gserviceaccount.com", private_key: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`, project_id: "fs-test-project" },
    publicKey: pair.publicKey,
  };
}

const fromB64url = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
const jsonOf = (s: string) => JSON.parse(new TextDecoder().decode(fromB64url(s)));

class FakeGoogle {
  oauthCalls = 0;
  sends: { url: string; auth: string; body: Record<string, unknown> }[] = [];
  sendStatus = 200;
  sendBody: unknown = { name: "projects/x/messages/1" };
  oauthStatus = 200;
  expiresIn = 3600;
  throwOn: "oauth" | "send" | null = null;
  assertions: string[] = [];
  fetch = (url: string, init: RequestInit): Promise<Response> => {
    if (url === "https://oauth2.googleapis.com/token") {
      this.oauthCalls++;
      if (this.throwOn === "oauth") return Promise.reject(new Error("network down: secret detail"));
      this.assertions.push(new URLSearchParams(String(init.body)).get("assertion") ?? "");
      if (this.oauthStatus !== 200) return Promise.resolve(new Response("{}", { status: this.oauthStatus }));
      return Promise.resolve(new Response(JSON.stringify({ access_token: `at-${this.oauthCalls}`, expires_in: this.expiresIn, token_type: "Bearer" })));
    }
    if (this.throwOn === "send") return Promise.reject(new Error("network down: secret detail"));
    this.sends.push({ url, auth: String((init.headers as Record<string, string>).authorization), body: JSON.parse(String(init.body)) });
    return Promise.resolve(new Response(JSON.stringify(this.sendBody), { status: this.sendStatus }));
  };
}

Deno.test("fcm: the wake-up has exactly a type and a command id and no notification", () => {
  const m = buildWakeMessage(DEVICE_TOKEN, CMD).message as { token: string; data: Record<string, string>; notification?: unknown; android: Record<string, string> };
  assertEquals(m.token, DEVICE_TOKEN);
  assertEquals(m.data, { type: "SYNC", cmd_id: CMD });
  assertEquals(Object.keys(m).sort(), ["android", "data", "token"]);
  assertEquals(m.notification, undefined);
  assertEquals(m.android.priority, "HIGH");
});

Deno.test("fcm: the service account secret is validated and never echoed", () => {
  const good = JSON.stringify({ client_email: "a@b-c.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nAAA\n-----END PRIVATE KEY-----", project_id: "my-project-1" });
  assertEquals(parseServiceAccount(good).project_id, "my-project-1");
  for (const bad of [undefined, "", "not json", "{}", JSON.stringify({ client_email: "x", private_key: "k", project_id: "p" }), JSON.stringify({ client_email: "a@b.com", private_key: "no key here", project_id: "my-project-1" })]) {
    const e = assertThrows(() => parseServiceAccount(bad));
    assertEquals(e.message, "fcm_config_invalid");
  }
});

Deno.test("fcm: the OAuth assertion is a correctly signed RS256 JWT with the messaging scope", async () => {
  const { sa, publicKey } = await makeAccount();
  const jwt = await signAssertion(sa, 1_790_000_000);
  const [h, c, s] = jwt.split(".");
  assertEquals(jsonOf(h), { alg: "RS256", typ: "JWT" });
  assertEquals(jsonOf(c), { iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: 1_790_000_000, exp: 1_790_003_300 });
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, fromB64url(s), new TextEncoder().encode(`${h}.${c}`));
  assert(ok, "signature verifies with the public key");
  assert(pemToDer(sa.private_key).length > 1000);
});

Deno.test("fcm: a send goes to the project's endpoint with the bearer token and the wake-up only", async () => {
  const { sa } = await makeAccount();
  const g = new FakeGoogle();
  const send = createFcmSender(sa, g.fetch, () => 1_790_000_000_000);
  assertEquals(await send(DEVICE_TOKEN, CMD), "sent");
  assertEquals(g.sends[0].url, "https://fcm.googleapis.com/v1/projects/fs-test-project/messages:send");
  assertEquals(g.sends[0].auth, "Bearer at-1");
  assertEquals(g.sends[0].body, buildWakeMessage(DEVICE_TOKEN, CMD));
});

Deno.test("fcm: the access token is reused until a minute before it expires, then renewed", async () => {
  const { sa } = await makeAccount();
  const g = new FakeGoogle();
  let now = 1_790_000_000_000;
  const send = createFcmSender(sa, g.fetch, () => now);
  await send(DEVICE_TOKEN, CMD);
  now += 3_000_000; // 50 minutes
  await send(DEVICE_TOKEN, CMD);
  assertEquals(g.oauthCalls, 1);
  now += 541_000; // now past 59 minutes
  await send(DEVICE_TOKEN, CMD);
  assertEquals(g.oauthCalls, 2);
  assertEquals(g.sends.map((s) => s.auth), ["Bearer at-1", "Bearer at-1", "Bearer at-2"]);
});

Deno.test("fcm: errors are classified and never throw", async () => {
  const { sa } = await makeAccount();
  const cases: [number, unknown, string][] = [
    [404, { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }, "invalid_token"],
    [400, { error: { status: "INVALID_ARGUMENT" } }, "invalid_token"],
    [404, null, "invalid_token"],
    [429, { error: { status: "RESOURCE_EXHAUSTED" } }, "retry"],
    [500, { error: { status: "INTERNAL" } }, "retry"],
    [503, "<html>", "retry"],
    [401, { error: { status: "UNAUTHENTICATED" } }, "retry"],
    [403, { error: { status: "PERMISSION_DENIED" } }, "retry"],
  ];
  for (const [status, body, expected] of cases) {
    const g = new FakeGoogle();
    g.sendStatus = status;
    g.sendBody = body;
    assertEquals(await createFcmSender(sa, g.fetch)(DEVICE_TOKEN, CMD), expected as never);
  }
});

Deno.test("fcm: a refused access token is dropped so the next send gets a fresh one", async () => {
  const { sa } = await makeAccount();
  const g = new FakeGoogle();
  const send = createFcmSender(sa, g.fetch);
  g.sendStatus = 401;
  assertEquals(await send(DEVICE_TOKEN, CMD), "retry");
  g.sendStatus = 200;
  assertEquals(await send(DEVICE_TOKEN, CMD), "sent");
  assertEquals(g.oauthCalls, 2);
});

Deno.test("fcm: OAuth failures and network errors are 'retry' and leak nothing", async () => {
  const { sa } = await makeAccount();
  const g1 = new FakeGoogle();
  g1.oauthStatus = 401;
  assertEquals(await createFcmSender(sa, g1.fetch)(DEVICE_TOKEN, CMD), "retry");
  assertEquals(g1.sends.length, 0);
  const g2 = new FakeGoogle();
  g2.throwOn = "oauth";
  assertEquals(await createFcmSender(sa, g2.fetch)(DEVICE_TOKEN, CMD), "retry");
  const g3 = new FakeGoogle();
  g3.throwOn = "send";
  assertEquals(await createFcmSender(sa, g3.fetch)(DEVICE_TOKEN, CMD), "retry");
  const bad = { ...sa, private_key: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----" };
  const g4 = new FakeGoogle();
  assertEquals(await createFcmSender(bad, g4.fetch)(DEVICE_TOKEN, CMD), "retry"); // an unusable key can never be signed with
  assertEquals(g4.oauthCalls, 0);
});

Deno.test("fcm: classifyFcmError ignores unknown shapes", () => {
  assertEquals(classifyFcmError(500, undefined), "retry");
  assertEquals(classifyFcmError(500, { error: { status: 5, details: "x" } }), "retry");
  assertEquals(classifyFcmError(200, { error: { details: [{ errorCode: "UNREGISTERED" }] } }), "invalid_token");
});

Deno.test("fcm: assertRejects helper is available (guard against a silent test harness change)", async () => {
  await assertRejects(() => Promise.reject(new Error("x")));
});
