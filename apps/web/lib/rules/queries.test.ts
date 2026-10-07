import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { fetchDeviceRules, fetchRestrictionsInput } from "./queries";
import { RULES_COLUMNS } from "./rules";

type Res = { data: unknown; error: { code?: string } | null };
function fake(res: Res) {
  const calls: { method: string; args: unknown[] }[] = [];
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "limit", "order"]) b[m] = vi.fn((...args: unknown[]) => { calls.push({ method: m, args }); return b; });
  b.maybeSingle = vi.fn(async () => res);
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the parameter types the recorded calls
  const from = vi.fn((_t: string) => b);
  return { supabase: { from } as unknown as SupabaseClient, from, calls };
}
const ROW = { config_version: 2, daily_screen_limit_minutes: 90, daily_limit_overrides: {}, updated_at: null };
const D1 = "11111111-1111-4111-8111-111111111111";
const D2 = "22222222-2222-4222-8222-222222222222";
const D3 = "33333333-3333-4333-8333-333333333333";

describe("fetchDeviceRules", () => {
  it("reads one row by device id from device_rules with the explicit column list", async () => {
    const f = fake({ data: ROW, error: null });
    expect(await fetchDeviceRules(f.supabase, D1)).toMatchObject({ configVersion: 2, dailyLimit: 90 });
    expect(f.from).toHaveBeenCalledWith("device_rules");
    expect(f.calls).toContainEqual({ method: "select", args: [RULES_COLUMNS] });
    expect(f.calls).toContainEqual({ method: "eq", args: ["device_id", D1] });
  });
  it("a foreign or missing device (RLS) gives null", async () => {
    expect(await fetchDeviceRules(fake({ data: null, error: null }).supabase, D1)).toBeNull();
  });
  it("an unusable row gives null, never a guess", async () => {
    expect(await fetchDeviceRules(fake({ data: { ...ROW, config_version: 0 }, error: null }).supabase, D1)).toBeNull();
  });
  it("errors are generic", async () => {
    await expect(fetchDeviceRules(fake({ data: null, error: { code: "42P01" } }).supabase, D1)).rejects.toThrow("rules_lookup_failed");
  });
});

describe("fetchRestrictionsInput", () => {
  const dev = (id: string, enrollmentStatus: "PENDING" | "ENROLLED" | "REVOKED" = "ENROLLED") => ({ id, enrollmentStatus });
  it("no enrolled device → no query", async () => {
    const f = fake({ data: [], error: null });
    const r = await fetchRestrictionsInput(f.supabase, [dev(D1, "REVOKED"), dev(D2, "PENDING")]);
    expect(f.from).not.toHaveBeenCalled();
    expect(r.rules.size).toBe(0);
  });
  it("asks only for enrolled devices, with a row limit equal to their count, and keys rows by device id", async () => {
    const f = fake({ data: [{ device_id: D1, ...ROW }, { device_id: D3, ...ROW, daily_screen_limit_minutes: null }], error: null });
    const r = await fetchRestrictionsInput(f.supabase, [dev(D1), dev(D2, "REVOKED"), dev(D3)]);
    expect(f.calls).toContainEqual({ method: "in", args: ["device_id", [D1, D3]] });
    expect(f.calls).toContainEqual({ method: "limit", args: [2] });
    expect(f.calls).toContainEqual({ method: "select", args: [`device_id,${RULES_COLUMNS}`] });
    expect([...r.rules.keys()]).toEqual([D1, D3]);
    expect(r.rules.get(D1)?.dailyLimit).toBe(90);
  });
  it("skips unusable rows (they stay unreadable)", async () => {
    const f = fake({ data: [{ device_id: D1, ...ROW, config_version: "x" }, { ...ROW }, null, { device_id: D3, ...ROW }], error: null });
    const r = await fetchRestrictionsInput(f.supabase, [dev(D1), dev(D3)]);
    expect([...r.rules.keys()]).toEqual([D3]);
  });
  it("errors are generic", async () => {
    await expect(fetchRestrictionsInput(fake({ data: null, error: { code: "x" } }).supabase, [dev(D1)])).rejects.toThrow("restrictions_lookup_failed");
  });
});
