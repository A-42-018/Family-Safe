// Read side for the audit-log page (Server Components), run as the signed-in parent through the RPC
// `parent_list_audit_logs` (SECURITY DEFINER, keyed on the caller's own id). Errors are generic.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { asAuditRow, AUDIT_PAGE_SIZE, toRpcArgs, type AuditCursor, type AuditFilters, type AuditRow } from "./audit";

export interface AuditPage {
  rows: AuditRow[];
  /** Cursor for the next (older) page, or null when this is the last one. */
  next: AuditCursor | null;
}

export async function fetchAuditPage(supabase: SupabaseClient, filters: AuditFilters): Promise<AuditPage> {
  const { data, error } = await supabase.rpc("parent_list_audit_logs", toRpcArgs(filters));
  if (error) throw new Error("audit_lookup_failed"); // never echo the database message
  const raw = Array.isArray(data) ? (data as unknown[]) : [];
  const page = raw.slice(0, AUDIT_PAGE_SIZE).flatMap((r) => asAuditRow(r) ?? []);
  const last = page[page.length - 1];
  return { rows: page, next: raw.length > AUDIT_PAGE_SIZE && last ? { at: last.at, id: last.id } : null };
}

export async function loadAuditPage(filters: AuditFilters): Promise<AuditPage> {
  return fetchAuditPage(await createSupabaseServerClient(), filters);
}
