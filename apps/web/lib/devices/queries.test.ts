import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { PERMISSION_COLUMNS } from "./permissions";
import { fetchAllDevices, fetchDevice, fetchDevicePermissions } from "./queries";

function client(result: { data?: unknown; error?: unknown }, spy?: { columns?: string; filters: [string, unknown][] }) {
  const from = () => {
    const b: Record<string, unknown> = {};
    b.select = (c: string) => { if (spy) spy.columns = c; return b; };
    b.eq = (k: string, v: unknown) => { spy?.filters.push([k, v]); return b; };
    b.order = () => b;
    b.maybeSingle = () => Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
    b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: result.data ?? [], error: result.error ?? null }).then(res);
    return b;
  };
  return { from } as unknown as SupabaseClient;
}
const raw = (id: string, o: Record<string, unknown> = {}) => ({
  id, device_name: `Phone ${id}`, manufacturer: "Google", model: "Pixel 8", android_version: "15", device_status: "ONLINE",
  enrollment_status: "ENROLLED", last_seen_at: "2026-09-30T11:59:00Z", battery_level: 80, is_charging: false, network_type: "WIFI",
  app_version: "0.12.0", sdk_level: 35, security_patch: "2026-09-05", storage_total_mb: 102400, storage_free_mb: 25600,
  info_updated_at: "2026-09-30T06:00:00Z", child_id: "c1", children: { name: "Sam" }, ...o,
});

describe("fetchDevice", () => {
  it("maps heartbeat columns, filters by id and never selects secrets", async () => {
    const spy = { columns: "", filters: [] as [string, unknown][] };
    const d = await fetchDevice(client({ data: raw("a") }, spy), "a");
    expect(spy.filters).toEqual([["id", "a"]]);
    expect(spy.columns).not.toMatch(/fcm|token|credential|hash|refresh/i);
    expect(spy.columns).toMatch(/battery_level.*is_charging.*network_type.*last_seen_at|last_seen_at.*battery_level/);
    expect(d).toMatchObject({ id: "a", batteryLevel: 80, isCharging: false, networkType: "WIFI", appVersion: "0.12.0", childId: "c1", childName: "Sam" });
  });
  it("missing → null; error → generic throw without the DB message", async () => {
    expect(await fetchDevice(client({ data: null }), "a")).toBeNull();
    await expect(fetchDevice(client({ error: { code: "42501", message: "secret" } }), "a")).rejects.toThrow("device_lookup_failed");
  });
  it("tolerates an embedded child returned as an array or missing", async () => {
    expect((await fetchDevice(client({ data: raw("a", { children: [{ name: "Kim" }] }) }), "a"))?.childName).toBe("Kim");
    expect((await fetchDevice(client({ data: raw("a", { children: null }) }), "a"))?.childName).toBe("Child");
  });
  it("maps device-information columns and selects exactly the five contract columns", async () => {
    const spy = { columns: "", filters: [] as [string, unknown][] };
    const d = await fetchDevice(client({ data: raw("a") }, spy), "a");
    for (const c of ["sdk_level", "security_patch", "storage_total_mb", "storage_free_mb", "info_updated_at", "managed_mode"]) expect(spy.columns).toContain(c);
    expect(d).toMatchObject({ sdkLevel: 35, securityPatch: "2026-09-05", storageTotalMb: 102400, storageFreeMb: 25600, infoUpdatedAt: "2026-09-30T06:00:00Z" });
  });
  it("keeps null device-information columns null (also when the keys are absent)", async () => {
    const a = await fetchDevice(client({ data: raw("a", { sdk_level: null, security_patch: null, storage_total_mb: null, storage_free_mb: null, info_updated_at: null }) }), "a");
    expect(a).toMatchObject({ sdkLevel: null, securityPatch: null, storageTotalMb: null, storageFreeMb: null, infoUpdatedAt: null });
    const bare: Record<string, unknown> = raw("b");
    for (const k of ["sdk_level", "security_patch", "storage_total_mb", "storage_free_mb", "info_updated_at"]) delete bare[k];
    expect(await fetchDevice(client({ data: bare }), "b")).toMatchObject({ sdkLevel: null, infoUpdatedAt: null });
  });
  it("keeps null heartbeat columns null (never invents 0%)", async () => {
    const d = await fetchDevice(client({ data: raw("a", { battery_level: null, is_charging: null, network_type: null, app_version: null }) }), "a");
    expect(d).toMatchObject({ batteryLevel: null, isCharging: null, networkType: null, appVersion: null });
  });
});

describe("fetchAllDevices", () => {
  it("lists active devices first, then by child and name", async () => {
    const rows = await fetchAllDevices(client({ data: [
      raw("r", { enrollment_status: "REVOKED", device_name: "A" }),
      raw("z", { device_name: "Zed", children: { name: "Amy" } }),
      raw("b", { device_name: "Bee", children: { name: "Sam" } }),
      raw("a", { device_name: "Ace", children: { name: "Sam" } }),
    ] }));
    expect(rows.map((r) => r.id)).toEqual(["z", "a", "b", "r"]);
  });
  it("empty and error cases", async () => {
    expect(await fetchAllDevices(client({ data: null }))).toEqual([]);
    await expect(fetchAllDevices(client({ error: { message: "x" } }))).rejects.toThrow("devices_lookup_failed");
  });
});

describe("fetchDevicePermissions", () => {
  const permRow = (o: Record<string, unknown> = {}) => ({
    camera_status: "GRANTED", microphone_status: "DENIED", contacts_status: "REVOKED", sms_status: "NOT_AVAILABLE", call_log_status: "NOT_AVAILABLE",
    location_status: "RESTRICTED", precise_location_status: "NOT_REQUESTED", background_location_status: "GRANTED",
    last_verified_at: "2026-10-01T11:00:00Z", ...o,
  });
  it("reads device_permissions for one device and maps all eight states", async () => {
    const seen: string[] = [];
    const spy = { columns: "", filters: [] as [string, unknown][] };
    const from = (t: string) => { seen.push(t); return (client({ data: permRow() }, spy) as unknown as { from: (t: string) => unknown }).from(t); };
    const p = await fetchDevicePermissions({ from } as unknown as SupabaseClient, "dev-1");
    expect(seen).toEqual(["device_permissions"]);
    expect(spy.filters).toEqual([["device_id", "dev-1"]]);
    expect(spy.columns).toBe(PERMISSION_COLUMNS);
    expect(spy.columns).not.toMatch(/fcm|token|credential|hash|refresh/i);
    expect(p).toEqual({
      states: { camera: "GRANTED", microphone: "DENIED", contacts: "REVOKED", sms: "NOT_AVAILABLE", call_log: "NOT_AVAILABLE", location: "RESTRICTED", precise_location: "NOT_REQUESTED", background_location: "GRANTED" },
      lastVerifiedAt: "2026-10-01T11:00:00Z",
    });
  });
  it("missing or foreign row → null (RLS)", async () => {
    expect(await fetchDevicePermissions(client({ data: null }), "x")).toBeNull();
  });
  it("unrecognised or absent values become null; a missing time stays null", async () => {
    const p = await fetchDevicePermissions(client({ data: permRow({ camera_status: "weird", microphone_status: null, last_verified_at: null }) }), "x");
    expect(p?.states.camera).toBeNull();
    expect(p?.states.microphone).toBeNull();
    expect(p?.lastVerifiedAt).toBeNull();
    const bare: Record<string, unknown> = permRow();
    delete bare.location_status;
    delete bare.last_verified_at;
    const q = await fetchDevicePermissions(client({ data: bare }), "x");
    expect(q?.states.location).toBeNull();
    expect(q?.lastVerifiedAt).toBeNull();
  });
  it("error → generic throw without the DB message", async () => {
    await expect(fetchDevicePermissions(client({ error: { code: "42501", message: "secret detail" } }), "x")).rejects.toThrow("permissions_lookup_failed");
  });
});
