// Read side for the notifications page, the shell badge and the dashboard (Server Components), run as the signed-in
// parent under RLS (SELECT only). Errors are generic (no database text).
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { asNotificationRow, NOTIFICATION_COLUMNS, NOTIFICATIONS_MAX_LIMIT, type NotificationRow } from "./notifications";

export interface NotificationsPage {
  rows: NotificationRow[];
  hasMore: boolean;
}

/** The newest notifications (newest first); one extra row is read to know whether more exist. */
export async function fetchNotifications(supabase: SupabaseClient, limit: number): Promise<NotificationsPage> {
  const size = Math.min(Math.max(1, limit), NOTIFICATIONS_MAX_LIMIT);
  const { data, error } = await supabase
    .from("notifications")
    .select(NOTIFICATION_COLUMNS)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(size + 1);
  if (error) throw new Error("notifications_lookup_failed");
  const raw = (data ?? []) as unknown[];
  return { rows: raw.slice(0, size).flatMap((r) => asNotificationRow(r) ?? []), hasMore: raw.length > size };
}

/** How many notifications are unread (a head-only count; RLS limits it to the parent's own). */
export async function fetchUnreadCount(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  if (error || typeof count !== "number") throw new Error("notifications_count_failed");
  return count;
}

export async function loadNotifications(limit: number): Promise<NotificationsPage> {
  return fetchNotifications(await createSupabaseServerClient(), limit);
}

/** The badge and the dashboard card must never break a page: any failure reads as "unknown" (null). */
export async function loadUnreadCount(): Promise<number | null> {
  try {
    return await fetchUnreadCount(await createSupabaseServerClient());
  } catch {
    return null;
  }
}
