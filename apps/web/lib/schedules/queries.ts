// Read side for the schedules page and the dashboard (Server Components), run as the signed-in parent under RLS (SELECT only).
// Columns come from SCHEDULE_COLUMNS / TIMEZONE_COLUMN; nothing secret is read. Errors are generic (no DB message reaches the page or logs).
import type { SupabaseClient } from "@supabase/supabase-js";
import { SCHEDULES_MAX } from "@familysafe/contracts";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { asScheduleRow, asTimezone, SCHEDULE_COLUMNS, sortSchedules, TIMEZONE_COLUMN, type ScheduleRow } from "./schedules";

/** The device's schedules (≤ SCHEDULES_MAX, on or off), in display order. A foreign or missing device simply has none (RLS). Unusable rows are skipped. */
export async function fetchSchedules(supabase: SupabaseClient, deviceId: string): Promise<ScheduleRow[]> {
  const { data, error } = await supabase.from("schedules").select(SCHEDULE_COLUMNS).eq("device_id", deviceId).order("created_at", { ascending: true }).limit(SCHEDULES_MAX);
  if (error) throw new Error("schedules_lookup_failed");
  return sortSchedules(((data ?? []) as unknown[]).flatMap((r) => asScheduleRow(r) ?? []));
}

export async function loadSchedules(deviceId: string): Promise<ScheduleRow[]> {
  return fetchSchedules(await createSupabaseServerClient(), deviceId);
}

/**
 * The stored time zone: a name, `null` = follows the phone's own zone, `undefined` = unreadable (missing row, RLS, malformed
 * value). Unreadable is never shown as "the phone's own zone".
 */
export async function fetchTimezone(supabase: SupabaseClient, deviceId: string): Promise<string | null | undefined> {
  const { data, error } = await supabase.from("device_rules").select(TIMEZONE_COLUMN).eq("device_id", deviceId).maybeSingle();
  if (error) throw new Error("timezone_lookup_failed");
  if (typeof data !== "object" || data === null) return undefined;
  return asTimezone((data as Record<string, unknown>)[TIMEZONE_COLUMN]);
}

export async function loadTimezone(deviceId: string): Promise<string | null | undefined> {
  return fetchTimezone(await createSupabaseServerClient(), deviceId);
}

/** Number of ENABLED schedules per enrolled device, for the dashboard. No enrolled device ⇒ no query. Disabled windows restrict nothing, so they are not counted. */
export async function fetchScheduleCounts(supabase: SupabaseClient, devices: readonly { id: string; enrollmentStatus: string }[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const active = devices.filter((d) => d.enrollmentStatus === "ENROLLED");
  if (active.length === 0) return counts;
  const { data, error } = await supabase
    .from("schedules")
    .select(`device_id,${SCHEDULE_COLUMNS}`)
    .in("device_id", active.map((d) => d.id))
    .limit(active.length * SCHEDULES_MAX);
  if (error) throw new Error("schedule_counts_lookup_failed");
  for (const raw of (data ?? []) as unknown[]) {
    if (typeof raw !== "object" || raw === null) continue;
    const id = (raw as Record<string, unknown>).device_id;
    const row = asScheduleRow(raw);
    if (typeof id !== "string" || row === null || !row.enabled) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export async function loadScheduleCounts(devices: readonly { id: string; enrollmentStatus: string }[]): Promise<Map<string, number>> {
  return fetchScheduleCounts(await createSupabaseServerClient(), devices);
}
