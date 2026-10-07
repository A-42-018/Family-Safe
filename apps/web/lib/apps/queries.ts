// Read side for the app restrictions (Server Components), run as the signed-in parent under RLS (SELECT only).
// Columns come from APP_RULE_COLUMNS; nothing secret is read. Errors are generic (no DB message reaches the page or logs).
import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_RULES_MAX } from "@familysafe/contracts";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { APP_RULE_COLUMNS, asAppRuleRow, type AppRuleRow } from "./restrictions";

/** The device's effective app rules (≤ APP_RULES_MAX). A foreign or missing device simply has none (RLS). Unusable rows are skipped. */
export async function fetchAppRules(supabase: SupabaseClient, deviceId: string): Promise<AppRuleRow[]> {
  const { data, error } = await supabase.from("app_rules").select(APP_RULE_COLUMNS).eq("device_id", deviceId).order("package_name", { ascending: true }).limit(APP_RULES_MAX);
  if (error) throw new Error("app_rules_lookup_failed");
  return ((data ?? []) as unknown[]).flatMap((r) => asAppRuleRow(r) ?? []);
}

export async function loadAppRules(deviceId: string): Promise<AppRuleRow[]> {
  return fetchAppRules(await createSupabaseServerClient(), deviceId);
}

/** Number of effective app rules per enrolled device, for the dashboard. No enrolled device ⇒ no query. */
export async function fetchAppRuleCounts(supabase: SupabaseClient, devices: readonly { id: string; enrollmentStatus: string }[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const active = devices.filter((d) => d.enrollmentStatus === "ENROLLED");
  if (active.length === 0) return counts;
  const { data, error } = await supabase
    .from("app_rules")
    .select(`device_id,${APP_RULE_COLUMNS}`)
    .in("device_id", active.map((d) => d.id))
    .limit(active.length * APP_RULES_MAX);
  if (error) throw new Error("app_rule_counts_lookup_failed");
  for (const raw of (data ?? []) as unknown[]) {
    if (typeof raw !== "object" || raw === null) continue;
    const id = (raw as Record<string, unknown>).device_id;
    if (typeof id !== "string" || asAppRuleRow(raw) === null) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export async function loadAppRuleCounts(devices: readonly { id: string; enrollmentStatus: string }[]): Promise<Map<string, number>> {
  return fetchAppRuleCounts(await createSupabaseServerClient(), devices);
}
