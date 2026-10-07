import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markRead, setPreference } from "./service";

const ID = "e0000000-0000-4000-8000-000000000001";
type Rpc = { data?: unknown; error?: { code?: string } | null };
function deps(over: { user?: { id: string } | null; rpc?: Rpc } = {}) {
  const calls: { fn: string; args: unknown }[] = [];
  const supabase = {
    auth: { getUser: async () => ({ data: { user: over.user === undefined ? { id: `user-${Math.random()}` } : over.user }, error: null }) },
    rpc: async (fn: string, args: unknown) => (calls.push({ fn, args }), { data: over.rpc?.data ?? null, error: over.rpc?.error ?? null }),
  };
  return { deps: { supabase: supabase as never }, calls };
}

describe("markRead", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { spy = vi.spyOn(console, "error").mockImplementation(() => undefined); });
  afterEach(() => spy.mockRestore());

  it("marks everything with null ids and reports how many changed", async () => {
    const { deps: d, calls } = deps({ rpc: { data: 4 } });
    expect(await markRead(d, null)).toEqual({ ok: true, changed: 4 });
    expect(calls).toEqual([{ fn: "parent_mark_notifications_read", args: { p_ids: null } }]);
  });
  it("marks a given id", async () => {
    const { deps: d, calls } = deps({ rpc: { data: 1 } });
    expect(await markRead(d, [ID])).toEqual({ ok: true, changed: 1 });
    expect(calls[0]?.args).toEqual({ p_ids: [ID] });
  });
  it("bad input never reaches the database or spends the allowance", async () => {
    const { deps: d, calls } = deps();
    for (const ids of [[], ["x"], Array.from({ length: 201 }, () => ID)] as string[][]) {
      expect((await markRead(d, ids)).ok).toBe(false);
    }
    expect(calls).toHaveLength(0);
  });
  it("an unverified user is sent to sign in", async () => {
    const { deps: d, calls } = deps({ user: null });
    expect(await markRead(d, null)).toMatchObject({ ok: false, redirectTo: "/login" });
    expect(calls).toHaveLength(0);
  });
  it("is rate limited per user", async () => {
    const { deps: d } = deps({ user: { id: "rate-limited-user" }, rpc: { data: 0 } });
    let last = await markRead(d, null);
    for (let i = 0; i < 70 && last.ok; i++) last = await markRead(d, null);
    expect(last).toMatchObject({ ok: false, message: expect.stringMatching(/Too many changes/) });
  });
  it("maps database errors generically and logs only the code", async () => {
    const out = await markRead(deps({ rpc: { error: { code: "XX000" } } }).deps, null);
    expect(out).toEqual({ ok: false, message: "Something went wrong. Please try again." });
    expect(spy).toHaveBeenCalledWith("notifications_mark_read_failed", "XX000");
    expect(await markRead(deps({ rpc: { error: { code: "42501" } } }).deps, null)).toMatchObject({ ok: false, redirectTo: "/login" });
  });
  it("an unexpected result counts as nothing changed", async () => {
    expect(await markRead(deps({ rpc: { data: "many" } }).deps, null)).toEqual({ ok: true, changed: 0 });
    expect(await markRead(deps({ rpc: { data: -2 } }).deps, null)).toEqual({ ok: true, changed: 0 });
  });
});

describe("setPreference", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { spy = vi.spyOn(console, "error").mockImplementation(() => undefined); });
  afterEach(() => spy.mockRestore());

  it("sends the type and the flag and returns the outcome", async () => {
    const { deps: d, calls } = deps({ rpc: { data: "updated" } });
    expect(await setPreference(d, { type: "BATTERY_LOW", enabled: false })).toEqual({ ok: true, outcome: "updated" });
    expect(calls).toEqual([{ fn: "parent_set_notification_preference", args: { p_type: "BATTERY_LOW", p_enabled: false } }]);
    expect(await setPreference(deps({ rpc: { data: "unchanged" } }).deps, { type: "BATTERY_LOW", enabled: true })).toEqual({ ok: true, outcome: "unchanged" });
  });
  it("bad input never reaches the database", async () => {
    const { deps: d, calls } = deps();
    for (const raw of [{ type: "LOGIN", enabled: true }, { type: "BATTERY_LOW", enabled: "yes" }, { type: null, enabled: null }, { type: 5, enabled: true }]) {
      expect((await setPreference(d, raw)).ok).toBe(false);
    }
    expect(calls).toHaveLength(0);
  });
  it("an unverified user is sent to sign in", async () => {
    expect(await setPreference(deps({ user: null }).deps, { type: "BATTERY_LOW", enabled: true })).toMatchObject({ ok: false, redirectTo: "/login" });
  });
  it("the always-on refusal gets its own plain message", async () => {
    const out = await setPreference(deps({ rpc: { error: { code: "22023" } } }).deps, { type: "EMERGENCY", enabled: false });
    expect(out).toEqual({ ok: false, message: "Emergency alerts and security notices are always on." });
  });
  it("other errors and unexpected outcomes are generic and log only a code", async () => {
    expect(await setPreference(deps({ rpc: { error: { code: "XX000" } } }).deps, { type: "BATTERY_LOW", enabled: true })).toEqual({ ok: false, message: "Something went wrong. Please try again." });
    expect(spy).toHaveBeenCalledWith("notification_preference_failed", "XX000");
    expect(await setPreference(deps({ rpc: { data: "weird" } }).deps, { type: "BATTERY_LOW", enabled: true })).toMatchObject({ ok: false });
    expect(spy).toHaveBeenCalledWith("notification_preference_failed", "unexpected_outcome");
    expect(await setPreference(deps({ rpc: { error: { code: "42501" } } }).deps, { type: "BATTERY_LOW", enabled: true })).toMatchObject({ redirectTo: "/login" });
  });
});
