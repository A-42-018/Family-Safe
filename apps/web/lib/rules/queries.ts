// Read side for the rules page and the dashboard card (Server Components), run as the signed-in parent under RLS (SELECT only).
// Columns come from RULES_COLUMNS; nothing secret is read. Errors are generic (no DB message reaches the page or logs).
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { asRulesRow, RULES_COLUMNS, type RestrictionDevice, type RestrictionsInput, type RulesRow } from "./rules";

/** The device's rules row (one per device, created with the device). A foreign or missing device gives null (RLS). */
export async function fetchDeviceRules(supabase: SupabaseClient, deviceId: string): Promise<RulesRow | null> {
  const { data, error } = await supabase.from("device_rules").select(RULES_COLUMNS).eq("device_id", deviceId).maybeSingle();
  if (error) throw new Error("rules_lookup_failed");
  return data ? asRulesRow(data) : null;
}

export async function loadDeviceRules(deviceId: string): Promise<RulesRow | null> {
  return fetchDeviceRules(await createSupabaseServerClient(), deviceId);
}

/** Rules of the enrolled devices, for the dashboard. No enrolled device ⇒ no query. Unusable rows are skipped (= unreadable). */
export async function fetchRestrictionsInput(supabase: SupabaseClient, devices: readonly RestrictionDevice[]): Promise<RestrictionsInput> {
  const active = devices.filter((d) => d.enrollmentStatus === "ENROLLED");
  const rules = new Map<string, RulesRow>();
  if (active.length === 0) return { devices, rules };
  const { data, error } = await supabase
    .from("device_rules")
    .select(`device_id,${RULES_COLUMNS}`)
    .in("device_id", active.map((d) => d.id))
    .limit(active.length);
  if (error) throw new Error("restrictions_lookup_failed");
  for (const raw of (data ?? []) as unknown[]) {
    if (typeof raw !== "object" || raw === null) continue;
    const id = (raw as Record<string, unknown>).device_id;
    const row = asRulesRow(raw);
    if (typeof id === "string" && row) rules.set(id, row);
  }
  return { devices, rules };
}

export async function loadRestrictionsInput(devices: readonly RestrictionDevice[]): Promise<RestrictionsInput> {
  return fetchRestrictionsInput(await createSupabaseServerClient(), devices);
}
