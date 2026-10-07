import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_RULES_MAX } from "@familysafe/contracts";
import { describe, expect, it, vi } from "vitest";
import { fetchAppRuleCounts, fetchAppRules } from "./queries";
import { APP_RULE_COLUMNS } from "./restrictions";

type Res = { data: unknown; error: { code?: string; message?: string } | null };
function fake(res: Res) {
  const calls: { method: string; args: unknown[] }[] = [];
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "limit", "order"]) b[m] = vi.fn((...args: unknown[]) => { calls.push({ method: m, args }); return b; });
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the parameter types the recorded calls
  const from = vi.fn((_t: string) => b);
  return { supabase: { from } as unknown as SupabaseClient, from, calls };
}
const D1 = "11111111-1111-4111-8111-111111111111";
const D2 = "22222222-2222-4222-8222-222222222222";
const D3 = "33333333-3333-4333-8333-333333333333";

describe("fetchAppRules", () => {
  it("reads app_rules for one device with the explicit columns, ordered, capped by the contract", async () => {
    const f = fake({ data: [{ package_name: "a.b", blocked: true, daily_limit_minutes: null }], error: null });
    expect(await fetchAppRules(f.supabase, D1)).toEqual([{ packageName: "a.b", blocked: true, dailyLimit: null }]);
    expect(f.from).toHaveBeenCalledWith("app_rules");
    expect(f.calls).toContainEqual({ method: "select", args: [APP_RULE_COLUMNS] });
    expect(f.calls).toContainEqual({ method: "eq", args: ["device_id", D1] });
    expect(f.calls).toContainEqual({ method: "limit", args: [APP_RULES_MAX] });
  });
  it("skips unusable rows and rows that restrict nothing; null data is an empty list", async () => {
    const rows = [{ package_name: "a.b", blocked: false, daily_limit_minutes: 10 }, { package_name: "c.d", blocked: false, daily_limit_minutes: null }, null, { package_name: 1 }];
    expect(await fetchAppRules(fake({ data: rows, error: null }).supabase, D1)).toEqual([{ packageName: "a.b", blocked: false, dailyLimit: 10 }]);
    expect(await fetchAppRules(fake({ data: null, error: null }).supabase, D1)).toEqual([]);
  });
  it("an error is generic (no DB message, code or ids)", async () => {
    await expect(fetchAppRules(fake({ data: null, error: { code: "42P01", message: "relation app_rules does not exist" } }).supabase, D1)).rejects.toThrow(/^app_rules_lookup_failed$/);
  });
});

describe("fetchAppRuleCounts", () => {
  const devs = [{ id: D1, enrollmentStatus: "ENROLLED" }, { id: D2, enrollmentStatus: "REVOKED" }, { id: D3, enrollmentStatus: "ENROLLED" }];
  it("counts effective rules per enrolled device and queries only those devices", async () => {
    const f = fake({
      data: [
        { device_id: D1, package_name: "a.b", blocked: true, daily_limit_minutes: null },
        { device_id: D1, package_name: "c.d", blocked: false, daily_limit_minutes: 0 },
        { device_id: D1, package_name: "e.f", blocked: false, daily_limit_minutes: null }, // restricts nothing
        { device_id: D3, package_name: "a.b", blocked: false, daily_limit_minutes: 5 },
        { package_name: "a.b", blocked: true, daily_limit_minutes: null }, // no device id
        null,
      ],
      error: null,
    });
    const out = await fetchAppRuleCounts(f.supabase, devs);
    expect([...out.entries()]).toEqual([[D1, 2], [D3, 1]]);
    expect(f.calls).toContainEqual({ method: "select", args: [`device_id,${APP_RULE_COLUMNS}`] });
    expect(f.calls).toContainEqual({ method: "in", args: ["device_id", [D1, D3]] });
    expect(f.calls).toContainEqual({ method: "limit", args: [2 * APP_RULES_MAX] });
  });
  it("no enrolled device ⇒ no query", async () => {
    const f = fake({ data: [], error: null });
    expect((await fetchAppRuleCounts(f.supabase, [{ id: D2, enrollmentStatus: "REVOKED" }, { id: D1, enrollmentStatus: "PENDING" }])).size).toBe(0);
    expect((await fetchAppRuleCounts(f.supabase, [])).size).toBe(0);
    expect(f.from).not.toHaveBeenCalled();
  });
  it("an error is generic", async () => {
    await expect(fetchAppRuleCounts(fake({ data: null, error: { code: "x", message: "boom" } }).supabase, devs)).rejects.toThrow(/^app_rule_counts_lookup_failed$/);
  });
});
