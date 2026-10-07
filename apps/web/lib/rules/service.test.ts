import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@/lib/security/ratelimit";
import { FIELD, INACTIVE_MESSAGE, SAVED_MESSAGE, UNCHANGED_MESSAGE, WEEKDAYS } from "./rules";
import * as svc from "./service";

const UID = "11111111-1111-4111-8111-111111111111";
const UID2 = "99999999-9999-4999-8999-999999999999";
const DEV = "44444444-4444-4444-8444-444444444444";
type Err = { code?: string } | null;

/** Only `auth` and `rpc` exist: any table access (`from`) would throw, which proves the service never writes tables directly. */
function fake(o: { user?: { id: string } | null; authError?: boolean; rpc?: { data?: unknown; error?: Err } } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the parameters type the recorded calls
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
    data: o.rpc && "data" in o.rpc ? o.rpc.data : [{ o_outcome: "updated", o_config_version: 2 }],
    error: o.rpc?.error ?? null,
  }));
  const getUser = vi.fn().mockResolvedValue(
    o.authError || o.user === null ? { data: { user: null }, error: { message: "x" } } : { data: { user: o.user ?? { id: UID } }, error: null },
  );
  return { deps: { supabase: { auth: { getUser }, rpc } as unknown as SupabaseClient } as svc.RulesDeps, rpc, getUser };
}

const form = (over: Record<string, unknown> = {}): Record<string, unknown> => {
  const f: Record<string, unknown> = { [FIELD.deviceId]: DEV, [FIELD.defaultMode]: "limit", [FIELD.defaultMinutes]: "120" };
  for (const { iso } of WEEKDAYS) { f[FIELD.dayMode(iso)] = "default"; f[FIELD.dayMinutes(iso)] = ""; }
  return { ...f, ...over };
};

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetRateLimits();
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("authentication and validation order", () => {
  it("requires a verified user and never calls the RPC without one", async () => {
    const f = fake({ user: null });
    expect(await svc.setScreenTimeRules(f.deps, form())).toMatchObject({ ok: false, redirectTo: "/login" });
    expect(f.rpc).not.toHaveBeenCalled();
    const g = fake({ authError: true });
    expect(await svc.setScreenTimeRules(g.deps, form())).toMatchObject({ ok: false, redirectTo: "/login" });
    expect(g.rpc).not.toHaveBeenCalled();
  });
  it("a malformed device id is a not-found before auth or any RPC", async () => {
    const f = fake();
    for (const id of ["", "nope", "../x", `${DEV}x`]) expect(await svc.setScreenTimeRules(f.deps, form({ [FIELD.deviceId]: id }))).toMatchObject({ ok: false, notFound: true });
    expect(await svc.setScreenTimeRules(f.deps, { ...form(), [FIELD.deviceId]: undefined })).toMatchObject({ ok: false, notFound: true });
    expect(f.getUser).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("invalid fields are returned with their values and never reach auth or the RPC", async () => {
    const f = fake();
    const r = await svc.setScreenTimeRules(f.deps, form({ [FIELD.defaultMinutes]: "9999" }));
    expect(r).toMatchObject({ ok: false, message: "Please fix the highlighted fields." });
    if (!r.ok) {
      expect(r.fieldErrors?.[FIELD.defaultMinutes]).toBeTruthy();
      expect(r.values?.[FIELD.defaultMinutes]).toBe("9999");
    }
    expect(f.getUser).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("a tampered mode is a form error", async () => {
    const f = fake();
    expect(await svc.setScreenTimeRules(f.deps, form({ [FIELD.defaultMode]: "weird" }))).toMatchObject({ ok: false, message: "Choose an option for each day." });
    expect(f.rpc).not.toHaveBeenCalled();
  });
});

describe("the RPC call", () => {
  it("sends exactly the three contract arguments under the parent's own session", async () => {
    const f = fake();
    const r = await svc.setScreenTimeRules(f.deps, form({ [FIELD.dayMode(6)]: "limit", [FIELD.dayMinutes(6)]: "180", [FIELD.dayMode(7)]: "zero", config_version: "99", daily_limit_overrides: "{}" }));
    expect(f.rpc).toHaveBeenCalledTimes(1);
    const [name, args] = f.rpc.mock.calls[0]!;
    expect(name).toBe("parent_set_screen_time_rules");
    expect(args).toEqual({ p_device_id: DEV, p_daily_limit_minutes: 120, p_daily_limit_overrides: { "6": 180, "7": 0 } });
    expect(r).toMatchObject({ ok: true, deviceId: DEV, outcome: "updated", message: SAVED_MESSAGE });
  });
  it("no limit is sent as null, not as 0", async () => {
    const f = fake();
    await svc.setScreenTimeRules(f.deps, form({ [FIELD.defaultMode]: "off" }));
    expect(f.rpc.mock.calls[0]![1]).toMatchObject({ p_daily_limit_minutes: null, p_daily_limit_overrides: {} });
  });
  it("returns the submitted values so the form keeps showing them", async () => {
    const f = fake();
    const r = await svc.setScreenTimeRules(f.deps, form());
    expect(r.ok && r.values[FIELD.defaultMinutes]).toBe("120");
  });
});

describe("outcome mapping", () => {
  it.each([
    ["updated", { ok: true, outcome: "updated", message: SAVED_MESSAGE }],
    ["unchanged", { ok: true, outcome: "unchanged", message: UNCHANGED_MESSAGE }],
    ["not_found", { ok: false, notFound: true }],
    ["inactive", { ok: false, readOnly: true, message: INACTIVE_MESSAGE }],
  ])("%s", async (outcome, expected) => {
    const f = fake({ rpc: { data: [{ o_outcome: outcome, o_config_version: 3 }] } });
    expect(await svc.setScreenTimeRules(f.deps, form())).toMatchObject(expected);
  });
  it("a foreign device and a missing device look the same (both come back as not_found)", async () => {
    const a = await svc.setScreenTimeRules(fake({ rpc: { data: [{ o_outcome: "not_found", o_config_version: 0 }] } }).deps, form());
    const b = await svc.setScreenTimeRules(fake({ rpc: { data: [{ o_outcome: "not_found", o_config_version: 0 }] } }).deps, form({ [FIELD.deviceId]: UID2 }));
    expect(a).toEqual(b);
  });
  it("a single object row is accepted as well as an array", async () => {
    const f = fake({ rpc: { data: { o_outcome: "unchanged", o_config_version: 1 } } });
    expect(await svc.setScreenTimeRules(f.deps, form())).toMatchObject({ ok: true, outcome: "unchanged" });
  });
  it.each([[[]], [null], [[{}]], [[{ o_outcome: "weird" }]], [[{ o_outcome: 5 }]], ["updated"]])("an unusable response %j is a generic failure", async (data) => {
    const f = fake({ rpc: { data } });
    const r = await svc.setScreenTimeRules(f.deps, form());
    expect(r).toMatchObject({ ok: false, message: "Something went wrong. Please try again." });
    expect(r).not.toHaveProperty("notFound");
  });
});

describe("database errors", () => {
  it("42501 (no session) → sign in again", async () => {
    const f = fake({ rpc: { error: { code: "42501" } } });
    expect(await svc.setScreenTimeRules(f.deps, form())).toMatchObject({ ok: false, redirectTo: "/login" });
  });
  it("22023 (invalid input that got past the form) → a field-agnostic message and the values are kept", async () => {
    const f = fake({ rpc: { error: { code: "22023" } } });
    const r = await svc.setScreenTimeRules(f.deps, form());
    expect(r).toMatchObject({ ok: false, message: "Those limits aren't valid. Check the numbers and try again." });
    expect(r.ok ? null : r.values?.[FIELD.defaultMinutes]).toBe("120");
  });
  it("anything else is generic, and only the error code is logged", async () => {
    const f = fake({ rpc: { error: { code: "XX000" } } });
    const r = await svc.setScreenTimeRules(f.deps, form({ [FIELD.defaultMinutes]: "777" }));
    expect(r).toMatchObject({ ok: false, message: "Something went wrong. Please try again." });
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).toContain("XX000");
    for (const secret of [DEV, UID, "777", "limit"]) expect(logged).not.toContain(secret);
  });
  it("an error without a code is still generic", async () => {
    const f = fake({ rpc: { error: {} } });
    expect(await svc.setScreenTimeRules(f.deps, form())).toMatchObject({ ok: false, message: "Something went wrong. Please try again." });
  });
});

describe("rate limit", () => {
  it("allows 30 saves per 5 minutes per user, then stops before the RPC", async () => {
    const f = fake();
    for (let i = 0; i < 30; i++) expect(await svc.setScreenTimeRules(f.deps, form())).toMatchObject({ ok: true });
    const blocked = await svc.setScreenTimeRules(f.deps, form());
    expect(blocked).toMatchObject({ ok: false, message: expect.stringContaining("Too many changes") });
    expect(f.rpc).toHaveBeenCalledTimes(30);
    expect(blocked.ok ? null : blocked.values?.[FIELD.defaultMinutes]).toBe("120");
  });
  it("is per user", async () => {
    const a = fake({ user: { id: UID } });
    const b = fake({ user: { id: UID2 } });
    for (let i = 0; i < 31; i++) await svc.setScreenTimeRules(a.deps, form());
    expect(await svc.setScreenTimeRules(b.deps, form())).toMatchObject({ ok: true });
  });
  it("invalid submissions do not use up the allowance", async () => {
    const f = fake();
    for (let i = 0; i < 40; i++) await svc.setScreenTimeRules(f.deps, form({ [FIELD.defaultMinutes]: "x" }));
    expect(await svc.setScreenTimeRules(f.deps, form())).toMatchObject({ ok: true });
  });
});
