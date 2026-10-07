import type { SupabaseClient } from "@supabase/supabase-js";
import { DEVICE_APPS_MAX } from "@familysafe/contracts";
import { describe, expect, it } from "vitest";
import { APP_COLUMNS } from "./apps";
import { fetchDeviceApps } from "./queries";

interface Call { table: string; columns?: string; filters: [string, unknown][]; order?: string; limit?: number }
type Result = { data?: unknown; error?: unknown };

function client(results: Record<string, Result>, calls: Call[] = []) {
  const from = (table: string) => {
    const call: Call = { table, filters: [] };
    calls.push(call);
    const r = results[table] ?? {};
    const b: Record<string, unknown> = {};
    b.select = (c: string) => { call.columns = c; return b; };
    b.eq = (k: string, v: unknown) => { call.filters.push([k, v]); return b; };
    b.order = (c: string) => { call.order = c; return b; };
    b.limit = (n: number) => { call.limit = n; return b; };
    b.maybeSingle = () => Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: r.data ?? [], error: r.error ?? null }).then(res);
    return b;
  };
  return { from } as unknown as SupabaseClient;
}
const row = (pkg: string, o: Record<string, unknown> = {}) => ({ package_name: pkg, label: `App ${pkg}`, version_name: "1.2", is_system: false, ...o });

describe("fetchDeviceApps", () => {
  it("reads devices.apps_synced_at and device_apps for that device only, with the four columns and the contract cap", async () => {
    const calls: Call[] = [];
    const out = await fetchDeviceApps(client({ devices: { data: { apps_synced_at: "2026-10-01T06:00:00Z" } }, device_apps: { data: [row("com.a.b")] } }, calls), "dev-1");
    expect(calls.map((c) => c.table)).toEqual(["devices", "device_apps"]);
    expect(calls[0]).toMatchObject({ columns: "apps_synced_at", filters: [["id", "dev-1"]] });
    expect(calls[1]).toMatchObject({ columns: APP_COLUMNS, filters: [["device_id", "dev-1"]], limit: DEVICE_APPS_MAX });
    expect(out).toEqual({ syncedAt: "2026-10-01T06:00:00Z", apps: [{ packageName: "com.a.b", label: "App com.a.b", versionName: "1.2", isSystem: false }] });
  });
  it("missing or foreign device (RLS) → null, and the app table is not queried", async () => {
    const calls: Call[] = [];
    expect(await fetchDeviceApps(client({ devices: { data: null } }, calls), "x")).toBeNull();
    expect(calls.map((c) => c.table)).toEqual(["devices"]);
  });
  it("never reported → syncedAt null; an empty list is returned as empty, not as an error", async () => {
    expect(await fetchDeviceApps(client({ devices: { data: { apps_synced_at: null } }, device_apps: { data: [] } }), "a")).toEqual({ apps: [], syncedAt: null });
  });
  it("skips unusable rows instead of failing the page", async () => {
    const out = await fetchDeviceApps(client({ devices: { data: { apps_synced_at: "2026-10-01T06:00:00Z" } }, device_apps: { data: [row("com.ok.one"), { package_name: null }, row("com.ok.two")] } }), "a");
    expect(out?.apps.map((a) => a.packageName)).toEqual(["com.ok.one", "com.ok.two"]);
  });
  it("errors are generic and never carry the database message", async () => {
    const e = { code: "42501", message: "secret detail" };
    await expect(fetchDeviceApps(client({ devices: { error: e } }), "a")).rejects.toThrow("apps_lookup_failed");
    await expect(fetchDeviceApps(client({ devices: { data: { apps_synced_at: null } }, device_apps: { error: e } }), "a")).rejects.toThrow("apps_lookup_failed");
  });
});
