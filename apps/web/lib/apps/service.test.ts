import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@/lib/security/ratelimit";
import { FIELD, INACTIVE_MESSAGE, INVALID_MESSAGE, UNCHANGED_MESSAGE, UNKNOWN_APP_MESSAGE } from "./restrictions";
import * as svc from "./service";

const UID = "11111111-1111-4111-8111-111111111111";
const UID2 = "99999999-9999-4999-8999-999999999999";
const DEV = "44444444-4444-4444-8444-444444444444";
const PKG = "com.example.game";
type Err = { code?: string } | null;

/** Only `auth` and `rpc` exist: any table access (`from`) would throw, which proves the service never writes tables directly. */
function fake(o: { user?: { id: string } | null; authError?: boolean; rpc?: { data?: unknown; error?: Err } } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the parameters type the recorded calls
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
    data: o.rpc && "data" in o.rpc ? o.rpc.data : [{ o_outcome: "updated", o_config_version: 3 }],
    error: o.rpc?.error ?? null,
  }));
  const getUser = vi.fn().mockResolvedValue(
    o.authError || o.user === null ? { data: { user: null }, error: { message: "x" } } : { data: { user: o.user ?? { id: UID } }, error: null },
  );
  return { deps: { supabase: { auth: { getUser }, rpc } as unknown as SupabaseClient } as svc.AppRuleDeps, rpc, getUser };
}
const form = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ [FIELD.deviceId]: DEV, [FIELD.packageName]: PKG, [FIELD.intent]: "limit", [FIELD.minutes]: "45", ...over });

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetRateLimits();
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("order: id → fields → auth → rate limit → RPC", () => {
  it("a malformed device id is a not-found before auth or any RPC", async () => {
    const f = fake();
    for (const id of ["", "nope", "../x", `${DEV}x`]) expect(await svc.setAppRule(f.deps, form({ [FIELD.deviceId]: id }))).toMatchObject({ ok: false, notFound: true });
    expect(await svc.setAppRule(f.deps, { ...form(), [FIELD.deviceId]: undefined })).toMatchObject({ ok: false, notFound: true });
    expect(f.getUser).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("invalid fields return their values and never reach auth or the RPC", async () => {
    const f = fake();
    const r = await svc.setAppRule(f.deps, form({ [FIELD.minutes]: "9999" }));
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) {
      expect(r.fieldErrors?.[FIELD.minutes]).toBeTruthy();
      expect(r.values?.[FIELD.minutes]).toBe("9999");
    }
    expect(await svc.setAppRule(f.deps, form({ [FIELD.intent]: "nope" }))).toMatchObject({ ok: false, message: "Choose an action." });
    expect(f.getUser).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("requires a verified user", async () => {
    const f = fake({ user: null });
    expect(await svc.setAppRule(f.deps, form())).toMatchObject({ ok: false, redirectTo: "/login" });
    const g = fake({ authError: true });
    expect(await svc.setAppRule(g.deps, form())).toMatchObject({ ok: false, redirectTo: "/login" });
    expect(f.rpc).not.toHaveBeenCalled();
    expect(g.rpc).not.toHaveBeenCalled();
  });
});

describe("RPC call", () => {
  it("block, limit and clear map to exact RPC arguments", async () => {
    const f = fake();
    await svc.setAppRule(f.deps, form({ [FIELD.intent]: "block" }));
    await svc.setAppRule(f.deps, form({ [FIELD.intent]: "limit", [FIELD.minutes]: " 45 " }));
    await svc.setAppRule(f.deps, form({ [FIELD.intent]: "clear", [FIELD.minutes]: "junk" }));
    expect(f.rpc.mock.calls.map((c) => c[0])).toEqual(["parent_set_app_rule", "parent_set_app_rule", "parent_set_app_rule"]);
    const args = f.rpc.mock.calls.map((c) => c[1]);
    expect(args[0]).toEqual({ p_device_id: DEV, p_package_name: PKG, p_blocked: true, p_daily_limit_minutes: null });
    expect(args[1]).toEqual({ p_device_id: DEV, p_package_name: PKG, p_blocked: false, p_daily_limit_minutes: 45 });
    expect(args[2]).toEqual({ p_device_id: DEV, p_package_name: PKG, p_blocked: false, p_daily_limit_minutes: null });
  });
});

describe("outcome mapping", () => {
  const run = (data: unknown, intent = "block") => svc.setAppRule(fake({ rpc: { data } }).deps, form({ [FIELD.intent]: intent }));
  it("updated and cleared are saved with a message for the intent", async () => {
    expect(await run([{ o_outcome: "updated" }])).toMatchObject({ ok: true, outcome: "updated", deviceId: DEV });
    expect(((await run([{ o_outcome: "updated" }], "block")) as { message: string }).message).toMatch(/blocked/);
    expect(((await run([{ o_outcome: "updated" }], "limit")) as { message: string }).message).toMatch(/daily limit/);
    expect(await run([{ o_outcome: "cleared" }], "clear")).toMatchObject({ ok: true, outcome: "cleared" });
    expect(await run({ o_outcome: "updated" })).toMatchObject({ ok: true }); // single object tolerated
  });
  it("unchanged is not an error", async () => {
    expect(await run([{ o_outcome: "unchanged" }])).toMatchObject({ ok: true, outcome: "unchanged", message: UNCHANGED_MESSAGE });
  });
  it("not_found is a 404 (foreign ≙ missing)", async () => {
    expect(await run([{ o_outcome: "not_found" }])).toMatchObject({ ok: false, notFound: true });
  });
  it("inactive is read-only and unknown_app asks to wait for the next sync", async () => {
    expect(await run([{ o_outcome: "inactive" }])).toMatchObject({ ok: false, readOnly: true, message: INACTIVE_MESSAGE });
    expect(await run([{ o_outcome: "unknown_app" }])).toMatchObject({ ok: false, message: UNKNOWN_APP_MESSAGE });
  });
  it("anything unexpected is a generic failure and is logged without values", async () => {
    for (const data of [null, undefined, [], [{}], [{ o_outcome: "weird" }], "x", 5]) expect(await run(data)).toMatchObject({ ok: false, message: "Something went wrong. Please try again." });
    expect(errSpy).toHaveBeenCalledWith("app_rule_save_failed", "unexpected_outcome");
  });
  it("RPC errors: 42501 → sign in, 22023 → invalid/cap message, other → generic; only the code is logged", async () => {
    const err = (code?: string) => svc.setAppRule(fake({ rpc: { error: { code } } }).deps, form());
    expect(await err("42501")).toMatchObject({ ok: false, redirectTo: "/login" });
    expect(await err("22023")).toMatchObject({ ok: false, message: INVALID_MESSAGE });
    expect(await err("XX000")).toMatchObject({ ok: false, message: "Something went wrong. Please try again." });
    expect(await err(undefined)).toMatchObject({ ok: false });
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).not.toContain(PKG);
    expect(logged).not.toContain(DEV);
    expect(logged).not.toContain("45");
    expect(errSpy).toHaveBeenCalledWith("app_rule_save_failed", "42501");
    expect(errSpy).toHaveBeenCalledWith("app_rule_save_failed", "unknown");
  });
});

describe("rate limit", () => {
  it("is per user, applies only to valid submissions, and stops before the RPC", async () => {
    const f = fake();
    for (let i = 0; i < 5; i++) await svc.setAppRule(f.deps, form({ [FIELD.minutes]: "bad" })); // invalid: free
    for (let i = 0; i < 60; i++) expect(await svc.setAppRule(f.deps, form())).toMatchObject({ ok: true });
    const blocked = await svc.setAppRule(f.deps, form());
    expect(blocked).toMatchObject({ ok: false });
    expect(f.rpc).toHaveBeenCalledTimes(60);
    const other = fake({ user: { id: UID2 } });
    expect(await svc.setAppRule(other.deps, form())).toMatchObject({ ok: true });
  });
});
