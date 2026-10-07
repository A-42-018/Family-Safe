import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { fetchScheduleCounts, fetchSchedules, fetchTimezone } from "./queries";
import { SCHEDULE_COLUMNS } from "./schedules";

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
const D1 = "11111111-1111-4111-8111-111111111111";
const D2 = "22222222-2222-4222-8222-222222222222";
const S = (n: number, o: Record<string, unknown> = {}) => ({ id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa0${n}`, name: `S${n}`, type: "BEDTIME", days: [1], start_time: "21:00:00", end_time: "07:00:00", enabled: true, ...o });

describe("fetchSchedules", () => {
  it("reads schedules of one device with the explicit columns and the cap", async () => {
    const f = fake({ data: [S(1), { nope: 1 }], error: null });
    const rows = await fetchSchedules(f.supabase, D1);
    expect(rows).toHaveLength(1); // the unusable row is skipped
    expect(f.from).toHaveBeenCalledWith("schedules");
    expect(f.calls).toContainEqual({ method: "select", args: [SCHEDULE_COLUMNS] });
    expect(f.calls).toContainEqual({ method: "eq", args: ["device_id", D1] });
    expect(f.calls).toContainEqual({ method: "limit", args: [20] });
  });
  it("errors are generic", async () => {
    await expect(fetchSchedules(fake({ data: null, error: { code: "42P01" } }).supabase, D1)).rejects.toThrow("schedules_lookup_failed");
  });
});

describe("fetchTimezone", () => {
  it("reads only the timezone column; null, a name, and unreadable are told apart", async () => {
    const f = fake({ data: { timezone: "Asia/Dhaka" }, error: null });
    expect(await fetchTimezone(f.supabase, D1)).toBe("Asia/Dhaka");
    expect(f.from).toHaveBeenCalledWith("device_rules");
    expect(f.calls).toContainEqual({ method: "select", args: ["timezone"] });
    expect(await fetchTimezone(fake({ data: { timezone: null }, error: null }).supabase, D1)).toBeNull();
    expect(await fetchTimezone(fake({ data: null, error: null }).supabase, D1)).toBeUndefined();
    expect(await fetchTimezone(fake({ data: { timezone: "EST" }, error: null }).supabase, D1)).toBeUndefined();
  });
  it("errors are generic", async () => {
    await expect(fetchTimezone(fake({ data: null, error: { code: "1" } }).supabase, D1)).rejects.toThrow("timezone_lookup_failed");
  });
});

describe("fetchScheduleCounts", () => {
  it("no enrolled device, no query", async () => {
    const f = fake({ data: [], error: null });
    expect((await fetchScheduleCounts(f.supabase, [{ id: D1, enrollmentStatus: "REVOKED" }])).size).toBe(0);
    expect(f.from).not.toHaveBeenCalled();
  });
  it("counts only enabled schedules of enrolled devices", async () => {
    const f = fake({ data: [{ device_id: D1, ...S(1) }, { device_id: D1, ...S(2, { enabled: false }) }, { device_id: D2, ...S(3) }, { device_id: D2, nope: 1 }], error: null });
    const counts = await fetchScheduleCounts(f.supabase, [{ id: D1, enrollmentStatus: "ENROLLED" }, { id: D2, enrollmentStatus: "ENROLLED" }]);
    expect(counts.get(D1)).toBe(1);
    expect(counts.get(D2)).toBe(1);
    expect(f.calls).toContainEqual({ method: "limit", args: [40] });
  });
  it("errors are generic", async () => {
    await expect(fetchScheduleCounts(fake({ data: null, error: { code: "1" } }).supabase, [{ id: D1, enrollmentStatus: "ENROLLED" }])).rejects.toThrow("schedule_counts_lookup_failed");
  });
});
