import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { fetchDeviceUsage } from "./queries";
import { APP_USAGE_COLUMNS, DAY_USAGE_COLUMNS, USAGE_APP_ROW_LIMIT, USAGE_DAY_ROW_LIMIT } from "./usage";

interface Call { table: string; columns?: string; eq: [string, unknown][]; gte?: [string, unknown]; lte?: [string, unknown]; in?: [string, unknown[]]; order?: string; limit?: number }
type Result = { data?: unknown; error?: unknown };

function client(results: Record<string, Result>, calls: Call[] = []) {
  const from = (table: string) => {
    const call: Call = { table, eq: [] };
    calls.push(call);
    const r = results[table] ?? {};
    const b: Record<string, unknown> = {};
    b.select = (c: string) => { call.columns = c; return b; };
    b.eq = (k: string, v: unknown) => { call.eq.push([k, v]); return b; };
    b.gte = (k: string, v: unknown) => { call.gte = [k, v]; return b; };
    b.lte = (k: string, v: unknown) => { call.lte = [k, v]; return b; };
    b.in = (k: string, v: unknown[]) => { call.in = [k, v]; return b; };
    b.order = (c: string) => { call.order = c; return b; };
    b.limit = (n: number) => { call.limit = n; return b; };
    b.maybeSingle = () => Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: r.data ?? [], error: r.error ?? null }).then(res);
    return b;
  };
  return { from } as unknown as SupabaseClient;
}
const NOW = new Date("2026-10-01T12:00:00Z");
const dayRow = (d: string, m: number) => ({ usage_date: d, total_screen_minutes: m, unlock_count: 7 });
const appRow = (p: string, m: number) => ({ package_name: p, foreground_minutes: m, launch_count: 2 });
const SYNCED = "2026-10-01T06:00:00Z";

describe("fetchDeviceUsage", () => {
  it("reads only this device: synced-at, the 7-day window, the selected day's apps, and labels for the top apps", async () => {
    const calls: Call[] = [];
    const out = await fetchDeviceUsage(
      client({ devices: { data: { usage_synced_at: SYNCED } }, device_usage_daily: { data: [dayRow("2026-10-01", 90), dayRow("2026-09-30", 40)] }, app_usage_daily: { data: [appRow("com.a.chat", 50), appRow("com.b.game", 20)] }, device_apps: { data: [{ package_name: "com.a.chat", label: "Chat" }] } }, calls),
      "dev-1",
      null,
      NOW,
    );
    expect(calls.map((c) => c.table)).toEqual(["devices", "device_usage_daily", "app_usage_daily", "device_apps"]);
    expect(calls[0]).toMatchObject({ columns: "usage_synced_at", eq: [["id", "dev-1"]] });
    expect(calls[1]).toMatchObject({ columns: DAY_USAGE_COLUMNS, eq: [["device_id", "dev-1"]], gte: ["usage_date", "2026-09-24"], lte: ["usage_date", "2026-10-02"], limit: USAGE_DAY_ROW_LIMIT });
    expect(calls[2]).toMatchObject({ columns: APP_USAGE_COLUMNS, eq: [["device_id", "dev-1"], ["usage_date", "2026-10-01"]], limit: USAGE_APP_ROW_LIMIT });
    expect(calls[3]).toMatchObject({ columns: "package_name,label", eq: [["device_id", "dev-1"]], in: ["package_name", ["com.a.chat", "com.b.game"]] });
    expect(out?.syncedAt).toBe(SYNCED);
    expect(out?.selectedDay).toBe("2026-10-01");
    expect(out?.days.length).toBe(2);
    expect(out?.apps.length).toBe(2);
    expect(out?.labels.get("com.a.chat")).toBe("Chat");
  });
  it("a requested day inside the window selects that day's apps; one outside falls back to the latest", async () => {
    const calls: Call[] = [];
    await fetchDeviceUsage(client({ devices: { data: { usage_synced_at: SYNCED } }, device_usage_daily: { data: [dayRow("2026-10-01", 9)] } }, calls), "d", "2026-09-28", NOW);
    expect(calls[2]?.eq[1]).toEqual(["usage_date", "2026-09-28"]);
    const calls2: Call[] = [];
    await fetchDeviceUsage(client({ devices: { data: { usage_synced_at: SYNCED } }, device_usage_daily: { data: [] } }, calls2), "d", "2025-01-01", NOW);
    expect(calls2[2]?.eq[1]).toEqual(["usage_date", "2026-10-01"]);
  });
  it("missing or foreign device (RLS) → null, nothing else is queried", async () => {
    const calls: Call[] = [];
    expect(await fetchDeviceUsage(client({ devices: { data: null } }, calls), "x", null, NOW)).toBeNull();
    expect(calls.map((c) => c.table)).toEqual(["devices"]);
  });
  it("never reported → no usage table is read and nothing is claimed", async () => {
    const calls: Call[] = [];
    const out = await fetchDeviceUsage(client({ devices: { data: { usage_synced_at: null } } }, calls), "d", null, NOW);
    expect(calls.map((c) => c.table)).toEqual(["devices"]);
    expect(out).toEqual({ syncedAt: null, days: [], selectedDay: "2026-10-01", apps: [], labels: new Map() });
  });
  it("no apps → no label lookup; unusable rows are skipped instead of failing the page", async () => {
    const calls: Call[] = [];
    const out = await fetchDeviceUsage(client({ devices: { data: { usage_synced_at: SYNCED } }, device_usage_daily: { data: [dayRow("2026-10-01", 5), { usage_date: "bad" }, null] }, app_usage_daily: { data: [{ package_name: null }] } }, calls), "d", null, NOW);
    expect(calls.map((c) => c.table)).toEqual(["devices", "device_usage_daily", "app_usage_daily"]);
    expect(out?.days.length).toBe(1);
    expect(out?.apps.length).toBe(0);
  });
  it("errors are generic and never carry the database message", async () => {
    const e = { code: "42501", message: "secret detail" };
    const ok = { devices: { data: { usage_synced_at: SYNCED } } };
    await expect(fetchDeviceUsage(client({ devices: { error: e } }), "d", null, NOW)).rejects.toThrow("usage_lookup_failed");
    await expect(fetchDeviceUsage(client({ ...ok, device_usage_daily: { error: e } }), "d", null, NOW)).rejects.toThrow("usage_lookup_failed");
    await expect(fetchDeviceUsage(client({ ...ok, device_usage_daily: { data: [] }, app_usage_daily: { error: e } }), "d", null, NOW)).rejects.toThrow("usage_lookup_failed");
    await expect(fetchDeviceUsage(client({ ...ok, device_usage_daily: { data: [] }, app_usage_daily: { data: [appRow("com.a.b", 1)] }, device_apps: { error: e } }), "d", null, NOW)).rejects.toThrow("usage_lookup_failed");
  });
});
