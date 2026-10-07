// Read side for the Activity tab (Server Components), run as the signed-in parent under RLS (SELECT only).
// Columns come from ACTIVITY_COLUMNS; errors are generic (no DB message reaches the page or logs).
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ACTIVITY_COLUMNS, ACTIVITY_MAX_LIMIT, asActivityEvent, packagesIn, type ActivityEvent } from "./activity";

export interface ActivityInput {
  events: ActivityEvent[];
  /** More rows exist beyond the ones returned. */
  hasMore: boolean;
  /** package name → app label, only for packages named by the returned events. */
  labels: Map<string, string>;
}

/**
 * The newest events of one device (newest first). One extra row is read to know whether more exist. A foreign or
 * missing device simply has none (RLS). Unusable rows are skipped. Labels come from the reported app list.
 */
export async function fetchDeviceActivity(supabase: SupabaseClient, deviceId: string, limit: number): Promise<ActivityInput> {
  const size = Math.min(Math.max(1, limit), ACTIVITY_MAX_LIMIT);
  const { data, error } = await supabase
    .from("device_events")
    .select(ACTIVITY_COLUMNS)
    .eq("device_id", deviceId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(size + 1);
  if (error) throw new Error("activity_lookup_failed");
  const rows = (data ?? []) as unknown[];
  const events = rows.slice(0, size).flatMap((r) => asActivityEvent(r) ?? []);
  const labels = new Map<string, string>();
  const packages = packagesIn(events);
  if (packages.length > 0) {
    const apps = await supabase.from("device_apps").select("package_name,label").eq("device_id", deviceId).in("package_name", packages).limit(packages.length);
    if (apps.error) throw new Error("activity_labels_lookup_failed");
    for (const a of (apps.data ?? []) as unknown[]) {
      const r = a as Record<string, unknown>;
      if (typeof r?.package_name === "string" && typeof r?.label === "string" && r.label !== "") labels.set(r.package_name, r.label);
    }
  }
  return { events, hasMore: rows.length > size, labels };
}

export async function loadDeviceActivity(deviceId: string, limit: number): Promise<ActivityInput> {
  return fetchDeviceActivity(await createSupabaseServerClient(), deviceId, limit);
}
