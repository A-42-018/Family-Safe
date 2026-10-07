import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as svc from "./service";

const KID = "33333333-3333-4333-8333-333333333333";
const DEV = "44444444-4444-4444-8444-444444444444";
const TOKEN = "header.payload.signature";
const CODE = "0123-4567-89AB-CDEF";
const env = { supabaseUrl: "http://127.0.0.1:54321", anonKey: "anon-key" };

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });

function supabase(o: { user?: boolean; token?: string | null } = {}) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue(o.user === false ? { data: { user: null }, error: { message: "x" } } : { data: { user: { id: "u" } }, error: null }),
      getSession: vi.fn().mockResolvedValue({ data: { session: o.token === null ? null : { access_token: o.token ?? TOKEN } } }),
    },
  } as unknown as SupabaseClient;
}

function edge(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}
const created = { data: { pairing_code: CODE, qr_payload: "familysafe://enroll?c=0123456789ABCDEF", expires_at: "2026-09-29T12:10:00.000Z", expires_in: 600 } };

const deps = (o: { supabase?: SupabaseClient; fetchImpl?: typeof fetch; ip?: string } = {}): svc.EnrollmentDeps => ({
  supabase: o.supabase ?? supabase(), env, ip: o.ip ?? "203.0.113.7", fetchImpl: o.fetchImpl,
});

describe("createPairingCode", () => {
  it("forwards the parent's own token to enrollment-create and returns the code", async () => {
    const f = edge(201, created);
    const r = await svc.createPairingCode(deps({ fetchImpl: f as unknown as typeof fetch }), { childId: KID });
    expect(r).toEqual({ ok: true, code: CODE, expiresAt: "2026-09-29T12:10:00.000Z", expiresIn: 600 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:54321/functions/v1/enrollment-create");
    const h = init.headers as Record<string, string>;
    expect(h.authorization).toBe(`Bearer ${TOKEN}`);
    expect(h.apikey).toBe("anon-key");
    expect(h["x-forwarded-for"]).toBe("203.0.113.7");
    expect(init.method).toBe("POST");
    expect(init.cache).toBe("no-store");
    expect(JSON.parse(init.body as string)).toEqual({ child_id: KID }); // ownership is decided server-side, only the id is sent
  });
  it("omits x-forwarded-for when the client IP is unknown", async () => {
    const f = edge(201, created);
    await svc.createPairingCode(deps({ fetchImpl: f as unknown as typeof fetch, ip: "unknown" }), { childId: KID });
    expect(((f.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>)["x-forwarded-for"]).toBeUndefined();
  });
  it("rejects a malformed child id before any network call", async () => {
    const f = edge(201, created);
    for (const childId of ["", "nope", undefined, 5, "../../etc"]) {
      const r = await svc.createPairingCode(deps({ fetchImpl: f as unknown as typeof fetch }), { childId });
      expect(r).toEqual({ ok: false, message: "Child not found.", redirectTo: "/children" });
    }
    expect(f).not.toHaveBeenCalled();
  });
  it("needs a verified user and a session token", async () => {
    const f = edge(201, created);
    const noUser = await svc.createPairingCode(deps({ supabase: supabase({ user: false }), fetchImpl: f as unknown as typeof fetch }), { childId: KID });
    const noSession = await svc.createPairingCode(deps({ supabase: supabase({ token: null }), fetchImpl: f as unknown as typeof fetch }), { childId: KID });
    for (const r of [noUser, noSession]) expect(r).toEqual({ ok: false, message: "Please sign in again.", redirectTo: "/login" });
    expect(f).not.toHaveBeenCalled();
  });
  it.each([
    [401, "Please sign in again.", "/login"], [403, "Please sign in again.", "/login"],
    [404, "Child not found.", "/children"], [429, "Too many attempts. Please wait a few minutes and try again.", undefined],
    [500, "Something went wrong. Please try again.", undefined], [400, "Something went wrong. Please try again.", undefined],
  ])("maps HTTP %i to a generic message", async (status, message, redirectTo) => {
    const r = await svc.createPairingCode(deps({ fetchImpl: edge(status, { error: { code: "x", message: "internal detail: pairing_tokens" } }) as unknown as typeof fetch }), { childId: KID });
    expect(r).toEqual({ ok: false, message, ...(redirectTo ? { redirectTo } : {}) });
    expect(JSON.stringify(r)).not.toContain("pairing_tokens");
  });
  it("network failure / timeout -> generic error, no details", async () => {
    const f = vi.fn(async () => { throw new Error("connect ECONNREFUSED 10.0.0.5:54321"); });
    const r = await svc.createPairingCode(deps({ fetchImpl: f as unknown as typeof fetch }), { childId: KID });
    expect(r).toEqual({ ok: false, message: "Something went wrong. Please try again." });
  });
  it("a 201 with an unexpected body is an error, not a half-result", async () => {
    for (const body of [{}, { data: {} }, { data: { pairing_code: CODE } }, null, "x"]) {
      const r = await svc.createPairingCode(deps({ fetchImpl: edge(201, body) as unknown as typeof fetch }), { childId: KID });
      expect(r.ok).toBe(false);
    }
  });
  it("never logs the code, token or ids — only the HTTP status", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await svc.createPairingCode(deps({ fetchImpl: edge(500, { data: created.data }) as unknown as typeof fetch }), { childId: KID });
    await svc.createPairingCode(deps({ fetchImpl: edge(404, {}) as unknown as typeof fetch }), { childId: KID });
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain(CODE);
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain(KID);
    expect(logged).toContain("http_500");
  });
});

describe("revokeDevice", () => {
  it("posts only the device id with the parent's token", async () => {
    const f = edge(200, { data: { revoked: true, already_revoked: false } });
    const r = await svc.revokeDevice(deps({ fetchImpl: f as unknown as typeof fetch }), { deviceId: DEV, confirm: "revoke" });
    expect(r).toEqual({ ok: true, message: "Device access revoked." });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:54321/functions/v1/device-revoke");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body as string)).toEqual({ device_id: DEV });
  });
  it("requires the explicit confirm token and a valid id, without calling the network", async () => {
    const f = edge(200, {});
    expect(await svc.revokeDevice(deps({ fetchImpl: f as unknown as typeof fetch }), { deviceId: DEV, confirm: "" }))
      .toEqual({ ok: false, message: "Confirm the revocation to continue." });
    expect(await svc.revokeDevice(deps({ fetchImpl: f as unknown as typeof fetch }), { deviceId: DEV, confirm: "delete" }))
      .toEqual({ ok: false, message: "Confirm the revocation to continue." });
    expect(await svc.revokeDevice(deps({ fetchImpl: f as unknown as typeof fetch }), { deviceId: "nope", confirm: "revoke" }))
      .toEqual({ ok: false, message: "Device not found.", redirectTo: "/children" });
    expect(f).not.toHaveBeenCalled();
  });
  it("idempotent success (already revoked) is still success", async () => {
    const r = await svc.revokeDevice(deps({ fetchImpl: edge(200, { data: { revoked: true, already_revoked: true } }) as unknown as typeof fetch }), { deviceId: DEV, confirm: "revoke" });
    expect(r.ok).toBe(true);
  });
  it.each([[401, "Please sign in again."], [403, "Please sign in again."], [404, "Device not found."], [429, "Too many attempts. Please wait a few minutes and try again."], [500, "Something went wrong. Please try again."]])(
    "maps HTTP %i", async (status, message) => {
      const r = await svc.revokeDevice(deps({ fetchImpl: edge(status, {}) as unknown as typeof fetch }), { deviceId: DEV, confirm: "revoke" });
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.message).toBe(message);
    });
  it("requires a signed-in user", async () => {
    const f = edge(200, {});
    const r = await svc.revokeDevice(deps({ supabase: supabase({ user: false }), fetchImpl: f as unknown as typeof fetch }), { deviceId: DEV, confirm: "revoke" });
    expect(r).toEqual({ ok: false, message: "Please sign in again.", redirectTo: "/login" });
    expect(f).not.toHaveBeenCalled();
  });
});
