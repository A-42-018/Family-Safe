// Read side for device lists (Server Components). Runs as the signed-in parent under RLS: only their own devices return.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface DeviceRow {
  id: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  androidVersion: string | null;
  deviceStatus: "ONLINE" | "OFFLINE" | "UNKNOWN";
  enrollmentStatus: "PENDING" | "ENROLLED" | "REVOKED";
  lastSeenAt: string | null;
  // Heartbeat columns (Phase 12): null until the first check-in.
  batteryLevel: number | null;
  isCharging: boolean | null;
  networkType: string | null;
  appVersion: string | null;
  // Device information columns (Phase 13): null until the first upload.
  sdkLevel: number | null;
  securityPatch: string | null; // YYYY-MM-DD
  storageTotalMb: number | null;
  storageFreeMb: number | null;
  infoUpdatedAt: string | null;
  /** T4: the app reported it is the Device Owner (managed mode). A self-report; null = not reported yet. */
  managedMode: boolean | null;
}

export type RawDevice = {
  id: string; device_name: string; manufacturer: string | null; model: string | null; android_version: string | null;
  device_status: DeviceRow["deviceStatus"]; enrollment_status: DeviceRow["enrollmentStatus"]; last_seen_at: string | null;
  battery_level: number | null; is_charging: boolean | null; network_type: string | null; app_version: string | null;
  sdk_level: number | null; security_patch: string | null; storage_total_mb: number | null; storage_free_mb: number | null;
  info_updated_at: string | null;
  managed_mode?: boolean | null;
};
export const DEVICE_COLUMNS =
  "id,device_name,manufacturer,model,android_version,device_status,enrollment_status,last_seen_at,battery_level,is_charging,network_type,app_version,sdk_level,security_patch,storage_total_mb,storage_free_mb,info_updated_at,managed_mode"; // never fcm/credentials
const COLUMNS = DEVICE_COLUMNS;

export const toDeviceRow = (d: RawDevice): DeviceRow => ({
  id: d.id, name: d.device_name, manufacturer: d.manufacturer, model: d.model, androidVersion: d.android_version,
  deviceStatus: d.device_status, enrollmentStatus: d.enrollment_status, lastSeenAt: d.last_seen_at,
  batteryLevel: d.battery_level, isCharging: d.is_charging, networkType: d.network_type, appVersion: d.app_version,
  sdkLevel: d.sdk_level ?? null, securityPatch: d.security_patch ?? null, storageTotalMb: d.storage_total_mb ?? null,
  storageFreeMb: d.storage_free_mb ?? null, infoUpdatedAt: d.info_updated_at ?? null,
  managedMode: d.managed_mode ?? null,
});
const toRow = toDeviceRow;
type Raw = RawDevice;

/** Active devices first (ENROLLED/PENDING), revoked ones last; stable within a group. */
export async function fetchDevicesForChild(supabase: SupabaseClient, childId: string): Promise<DeviceRow[]> {
  const { data, error } = await supabase
    .from("devices").select(COLUMNS).eq("child_id", childId).order("created_at", { ascending: true }).order("id", { ascending: true });
  if (error) throw new Error("devices_lookup_failed"); // caught by app/(app)/error.tsx (no message shown)
  const rows = ((data ?? []) as unknown as Raw[]).map(toRow);
  return [...rows.filter((d) => d.enrollmentStatus !== "REVOKED"), ...rows.filter((d) => d.enrollmentStatus === "REVOKED")];
}

export async function loadDevicesForChild(childId: string): Promise<DeviceRow[]> {
  return fetchDevicesForChild(await createSupabaseServerClient(), childId);
}
