// Read side for the device pages (Server Components), run as the signed-in parent under RLS.
// Columns come from DEVICE_COLUMNS (never fcm/credential/hash columns).
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEVICE_APPS_MAX, PERMISSION_KEYS } from "@familysafe/contracts";
import { APP_COLUMNS, asAppRow, type AppsInput } from "@/lib/devices/apps";
import {
  APP_USAGE_COLUMNS,
  asAppUsageRow,
  asDayRow,
  buildSeries,
  DAY_USAGE_COLUMNS,
  selectDay,
  USAGE_APP_ROW_LIMIT,
  USAGE_DAY_ROW_LIMIT,
  USAGE_TOP_APPS,
  usageQueryRange,
  topApps,
  type UsageInput,
} from "@/lib/devices/usage";
import { asTodayRow, TODAY_ROWS_PER_DEVICE, TODAY_USAGE_COLUMNS, todayQueryRange, type TodayDevice, type TodayInput } from "@/lib/devices/screen-time";
import { asPermissionState, PERMISSION_COLUMNS, type PermissionsInput } from "@/lib/devices/permissions";
import { DEVICE_COLUMNS, toDeviceRow, type DeviceRow, type RawDevice } from "@/lib/enrollment/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface DeviceWithChild extends DeviceRow {
  childId: string;
  childName: string;
}
type RawWithChild = RawDevice & { child_id: string; children: { name: string } | { name: string }[] | null };
const COLUMNS_WITH_CHILD = `${DEVICE_COLUMNS},child_id,children(name)`;

const childName = (c: RawWithChild["children"]): string => (Array.isArray(c) ? c[0]?.name : c?.name) ?? "Child";
const toWithChild = (d: RawWithChild): DeviceWithChild => ({ ...toDeviceRow(d), childId: d.child_id, childName: childName(d.children) });

/** All of the parent's devices (RLS scopes them), active first, then by child and device name. */
export async function fetchAllDevices(supabase: SupabaseClient): Promise<DeviceWithChild[]> {
  const { data, error } = await supabase.from("devices").select(COLUMNS_WITH_CHILD).order("created_at", { ascending: true }).order("id", { ascending: true });
  if (error) throw new Error("devices_lookup_failed");
  const rows = ((data ?? []) as unknown as RawWithChild[]).map(toWithChild);
  const rank = (d: DeviceRow) => (d.enrollmentStatus === "REVOKED" ? 1 : 0);
  return rows.sort((a, b) => rank(a) - rank(b) || a.childName.localeCompare(b.childName) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** One device by id; a foreign or missing id both give null (RLS) → the page answers 404. */
export async function fetchDevice(supabase: SupabaseClient, id: string): Promise<DeviceWithChild | null> {
  const { data, error } = await supabase.from("devices").select(COLUMNS_WITH_CHILD).eq("id", id).maybeSingle();
  if (error) throw new Error("device_lookup_failed");
  return data ? toWithChild(data as unknown as RawWithChild) : null;
}

export async function loadAllDevices(): Promise<DeviceWithChild[]> {
  return fetchAllDevices(await createSupabaseServerClient());
}
export async function loadDevice(id: string): Promise<DeviceWithChild | null> {
  return fetchDevice(await createSupabaseServerClient(), id);
}

/**
 * The device's permission row (one per device, created with the device). RLS scopes it to the parent's own devices;
 * a foreign or missing id gives null. Unrecognised values become null (never invented).
 */
export async function fetchDevicePermissions(supabase: SupabaseClient, deviceId: string): Promise<PermissionsInput | null> {
  const { data, error } = await supabase.from("device_permissions").select(PERMISSION_COLUMNS).eq("device_id", deviceId).maybeSingle();
  if (error) throw new Error("permissions_lookup_failed"); // generic: no DB message reaches the page or logs
  if (!data) return null;
  const row = data as unknown as Record<string, unknown>;
  const states = Object.fromEntries(PERMISSION_KEYS.map((k) => [k, asPermissionState(row[`${k}_status`])])) as PermissionsInput["states"];
  return { states, lastVerifiedAt: typeof row.last_verified_at === "string" ? row.last_verified_at : null };
}

export async function loadDevicePermissions(deviceId: string): Promise<PermissionsInput | null> {
  return fetchDevicePermissions(await createSupabaseServerClient(), deviceId);
}

/**
 * The device's reported app list plus `apps_synced_at`, both under RLS. A foreign or missing device gives null.
 * Read-only (parents have SELECT only); at most DEVICE_APPS_MAX rows; unusable rows are skipped.
 */
export async function fetchDeviceApps(supabase: SupabaseClient, deviceId: string): Promise<AppsInput | null> {
  const dev = await supabase.from("devices").select("apps_synced_at").eq("id", deviceId).maybeSingle();
  if (dev.error) throw new Error("apps_lookup_failed"); // generic: no DB message reaches the page or logs
  if (!dev.data) return null;
  const { data, error } = await supabase.from("device_apps").select(APP_COLUMNS).eq("device_id", deviceId).order("package_name", { ascending: true }).limit(DEVICE_APPS_MAX);
  if (error) throw new Error("apps_lookup_failed");
  const syncedAt = (dev.data as unknown as Record<string, unknown>).apps_synced_at;
  return {
    apps: ((data ?? []) as unknown[]).flatMap((r) => asAppRow(r) ?? []),
    syncedAt: typeof syncedAt === "string" ? syncedAt : null,
  };
}

export async function loadDeviceApps(deviceId: string): Promise<AppsInput | null> {
  return fetchDeviceApps(await createSupabaseServerClient(), deviceId);
}

/**
 * The device's reported screen time, read as the signed-in parent under RLS (SELECT only):
 * `devices.usage_synced_at`, the per-day totals of the last week, and the per-app numbers of the selected day.
 * The selected day is `requestedDay` when it is inside the 7-day window, else the latest day. A foreign or missing
 * device gives null. Nothing is read before the first report. Labels come from the reported app list for the top apps
 * only (a short `in` filter); unusable rows are skipped; errors are generic.
 */
export async function fetchDeviceUsage(supabase: SupabaseClient, deviceId: string, requestedDay: string | null, now: Date = new Date()): Promise<UsageInput | null> {
  const dev = await supabase.from("devices").select("usage_synced_at").eq("id", deviceId).maybeSingle();
  if (dev.error) throw new Error("usage_lookup_failed"); // generic: no DB message reaches the page or logs
  if (!dev.data) return null;
  const rawSynced = (dev.data as unknown as Record<string, unknown>).usage_synced_at;
  const syncedAt = typeof rawSynced === "string" ? rawSynced : null;
  const empty: UsageInput = { syncedAt, days: [], selectedDay: selectDay(buildSeries([], now), requestedDay), apps: [], labels: new Map() };
  if (syncedAt === null) return empty;

  const range = usageQueryRange(now);
  const d = await supabase
    .from("device_usage_daily")
    .select(DAY_USAGE_COLUMNS)
    .eq("device_id", deviceId)
    .gte("usage_date", range.from)
    .lte("usage_date", range.to)
    .order("usage_date", { ascending: false })
    .limit(USAGE_DAY_ROW_LIMIT);
  if (d.error) throw new Error("usage_lookup_failed");
  const days = ((d.data ?? []) as unknown[]).flatMap((r) => asDayRow(r) ?? []);
  const selectedDay = selectDay(buildSeries(days, now), requestedDay);

  const a = await supabase
    .from("app_usage_daily")
    .select(APP_USAGE_COLUMNS)
    .eq("device_id", deviceId)
    .eq("usage_date", selectedDay)
    .order("foreground_minutes", { ascending: false })
    .limit(USAGE_APP_ROW_LIMIT);
  if (a.error) throw new Error("usage_lookup_failed");
  const apps = ((a.data ?? []) as unknown[]).flatMap((r) => asAppUsageRow(r) ?? []);

  const dayMinutes = days.find((r) => r.day === selectedDay)?.screenMinutes ?? null;
  const top = topApps(apps, new Map(), dayMinutes, USAGE_TOP_APPS).rows.map((r) => r.packageName);
  const labels = new Map<string, string>();
  if (top.length > 0) {
    const l = await supabase.from("device_apps").select("package_name,label").eq("device_id", deviceId).in("package_name", top).limit(USAGE_TOP_APPS);
    if (l.error) throw new Error("usage_lookup_failed");
    for (const row of (l.data ?? []) as unknown[]) {
      const r = row as Record<string, unknown>;
      if (typeof r.package_name === "string" && typeof r.label === "string") labels.set(r.package_name, r.label);
    }
  }
  return { syncedAt, days, selectedDay, apps, labels };
}

export async function loadDeviceUsage(deviceId: string, requestedDay: string | null): Promise<UsageInput | null> {
  return fetchDeviceUsage(await createSupabaseServerClient(), deviceId, requestedDay);
}

/**
 * Dashboard "Today's screen time": `devices.usage_synced_at` for the parent's devices plus the last three days of
 * `device_usage_daily` (yesterday … one day ahead) for enrolled devices that have reported at least once. Parent session
 * under RLS, SELECT only; nothing is read for devices that never reported; unusable rows are skipped; errors are generic.
 */
export async function fetchTodayScreenTime(supabase: SupabaseClient, devices: readonly TodayDevice[], now: Date = new Date()): Promise<TodayInput> {
  const active = devices.filter((d) => d.enrollmentStatus === "ENROLLED");
  const empty: TodayInput = { devices, rows: [], syncedAt: new Map() };
  if (active.length === 0) return empty;

  const dev = await supabase.from("devices").select("id,usage_synced_at").in("id", active.map((d) => d.id)).limit(active.length);
  if (dev.error) throw new Error("today_usage_lookup_failed"); // generic: no DB message reaches the page or logs
  const syncedAt = new Map<string, string | null>();
  for (const row of (dev.data ?? []) as unknown[]) {
    const r = row as Record<string, unknown>;
    if (typeof r.id === "string") syncedAt.set(r.id, typeof r.usage_synced_at === "string" ? r.usage_synced_at : null);
  }
  const reported = active.filter((d) => typeof syncedAt.get(d.id) === "string");
  if (reported.length === 0) return { devices, rows: [], syncedAt };

  const range = todayQueryRange(now);
  const u = await supabase
    .from("device_usage_daily")
    .select(TODAY_USAGE_COLUMNS)
    .in("device_id", reported.map((d) => d.id))
    .gte("usage_date", range.from)
    .lte("usage_date", range.to)
    .order("usage_date", { ascending: false })
    .limit(reported.length * TODAY_ROWS_PER_DEVICE);
  if (u.error) throw new Error("today_usage_lookup_failed");
  return { devices, rows: ((u.data ?? []) as unknown[]).flatMap((r) => asTodayRow(r) ?? []), syncedAt };
}

export async function loadTodayScreenTime(devices: readonly TodayDevice[]): Promise<TodayInput> {
  return fetchTodayScreenTime(await createSupabaseServerClient(), devices);
}
