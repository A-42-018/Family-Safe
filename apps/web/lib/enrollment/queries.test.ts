import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { fetchDevicesForChild } from "./queries";

function client(result: { data?: unknown; error?: unknown }, spy?: { columns?: string; filters: [string, unknown][] }) {
  const from = () => {
    const b: Record<string, unknown> = {};
    b.select = (c: string) => { if (spy) spy.columns = c; return b; };
    b.eq = (k: string, v: unknown) => { spy?.filters.push([k, v]); return b; };
    b.order = () => b;
    b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: result.data ?? [], error: result.error ?? null }).then(res);
    return b;
  };
  return { from } as unknown as SupabaseClient;
}
const raw = (id: string, enrollment_status: string, extra: Record<string, unknown> = {}) => ({
  id, device_name: `Phone ${id}`, manufacturer: "Google", model: "Pixel 8", android_version: "15", device_status: "ONLINE", enrollment_status, last_seen_at: null,
  battery_level: 55, is_charging: true, network_type: "CELLULAR", app_version: "0.12.0", ...extra,
});

describe("fetchDevicesForChild", () => {
  it("maps rows, filters by child and never selects secrets", async () => {
    const spy = { columns: "", filters: [] as [string, unknown][] };
    const rows = await fetchDevicesForChild(client({ data: [raw("a", "ENROLLED")] }, spy), "child-1");
    expect(spy.filters).toEqual([["child_id", "child-1"]]);
    expect(spy.columns).not.toMatch(/fcm|token|credential|hash/i);
    expect(rows).toEqual([{ id: "a", name: "Phone a", manufacturer: "Google", model: "Pixel 8", androidVersion: "15", deviceStatus: "ONLINE", enrollmentStatus: "ENROLLED", lastSeenAt: null,
      batteryLevel: 55, isCharging: true, networkType: "CELLULAR", appVersion: "0.12.0",
      sdkLevel: null, securityPatch: null, storageTotalMb: null, storageFreeMb: null, infoUpdatedAt: null, managedMode: null }]);
  });
  it("lists revoked devices after active ones, keeping order inside each group", async () => {
    const rows = await fetchDevicesForChild(client({ data: [raw("r1", "REVOKED"), raw("a1", "ENROLLED"), raw("r2", "REVOKED"), raw("a2", "PENDING")] }), "c");
    expect(rows.map((r) => r.id)).toEqual(["a1", "a2", "r1", "r2"]);
  });
  it("empty and error cases", async () => {
    expect(await fetchDevicesForChild(client({ data: null }), "c")).toEqual([]);
    await expect(fetchDevicesForChild(client({ error: { code: "42501", message: "secret" } }), "c")).rejects.toThrow("devices_lookup_failed");
  });
});
