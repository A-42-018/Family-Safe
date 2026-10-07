import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { fetchTodayScreenTime } from "./queries";
import { TODAY_ROWS_PER_DEVICE, TODAY_USAGE_COLUMNS } from "./screen-time";

interface Call { table: string; columns?: string; in?: [string, unknown[]]; gte?: [string, unknown]; lte?: [string, unknown]; order?: string; limit?: number }
type Result = { data?: unknown; error?: unknown };

function client(results: Record<string, Result>, calls: Call[] = []) {
  const from = (table: string) => {
    const call: Call = { table };
    calls.push(call);
    const r = results[table] ?? {};
    const b: Record<string, unknown> = {};
    b.select = (c: string) => { call.columns = c; return b; };
    b.in = (k: string, v: unknown[]) => { call.in = [k, v]; return b; };
    b.gte = (k: string, v: unknown) => { call.gte = [k, v]; return b; };
    b.lte = (k: string, v: unknown) => { call.lte = [k, v]; return b; };
    b.order = (c: string) => { call.order = c; return b; };
    b.limit = (n: number) => { call.limit = n; return b; };
    b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: r.data ?? [], error: r.error ?? null }).then(res);
    return b;
  };
  return { from } as unknown as SupabaseClient;
}
const NOW = new Date("2026-10-01T12:00:00Z");
const enrolled = (id: string) => ({ id, enrollmentStatus: "ENROLLED" as const });
const SYNCED = "2026-10-01T06:00:00Z";

describe("fetchTodayScreenTime", () => {
  it("reads only enrolled devices: synced-at, then the 3-day window for devices that reported", async () => {
    const calls: Call[] = [];
    const out = await fetchTodayScreenTime(
      client({ devices: { data: [{ id: "a", usage_synced_at: SYNCED }, { id: "b", usage_synced_at: null }] }, device_usage_daily: { data: [{ device_id: "a", usage_date: "2026-10-01", total_screen_minutes: 45, unlock_count: 2 }] } }, calls),
      [enrolled("a"), enrolled("b"), { id: "r", enrollmentStatus: "REVOKED" }],
      NOW,
    );
    expect(calls.map((c) => c.table)).toEqual(["devices", "device_usage_daily"]);
    expect(calls[0]).toMatchObject({ columns: "id,usage_synced_at", in: ["id", ["a", "b"]], limit: 2 });
    expect(calls[1]).toMatchObject({ columns: TODAY_USAGE_COLUMNS, in: ["device_id", ["a"]], gte: ["usage_date", "2026-09-30"], lte: ["usage_date", "2026-10-02"], limit: TODAY_ROWS_PER_DEVICE });
    expect(out.rows).toEqual([{ deviceId: "a", day: "2026-10-01", screenMinutes: 45, unlocks: 2 }]);
    expect(out.syncedAt.get("a")).toBe(SYNCED);
    expect(out.syncedAt.get("b")).toBeNull();
  });
  it("no enrolled device → no query at all", async () => {
    const calls: Call[] = [];
    const out = await fetchTodayScreenTime(client({}, calls), [{ id: "r", enrollmentStatus: "REVOKED" }], NOW);
    expect(calls).toEqual([]);
    expect(out.rows).toEqual([]);
  });
  it("no device has reported → usage table is not queried", async () => {
    const calls: Call[] = [];
    await fetchTodayScreenTime(client({ devices: { data: [{ id: "a", usage_synced_at: null }] } }, calls), [enrolled("a")], NOW);
    expect(calls.map((c) => c.table)).toEqual(["devices"]);
  });
  it("skips unusable rows", async () => {
    const out = await fetchTodayScreenTime(
      client({ devices: { data: [{ id: "a", usage_synced_at: SYNCED }] }, device_usage_daily: { data: [{ device_id: "a" }, null, { device_id: "a", usage_date: "2026-10-01", total_screen_minutes: 9, unlock_count: 1 }] } }),
      [enrolled("a")],
      NOW,
    );
    expect(out.rows.length).toBe(1);
  });
  it("errors are generic (no DB message)", async () => {
    const secret = { message: "relation secret_table denied" };
    await expect(fetchTodayScreenTime(client({ devices: { error: secret } }), [enrolled("a")], NOW)).rejects.toThrow("today_usage_lookup_failed");
    await expect(fetchTodayScreenTime(client({ devices: { data: [{ id: "a", usage_synced_at: SYNCED }] }, device_usage_daily: { error: secret } }), [enrolled("a")], NOW)).rejects.toThrow(/^today_usage_lookup_failed$/);
  });
});
