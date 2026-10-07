// Marking notifications read (Phase 29b), independent of the Next runtime (dependencies injected) so it is unit-testable.
// Write path: PostgREST `rpc("parent_mark_notifications_read")` under the parent's own session; the SQL only ever touches
// the caller's own rows. Order: validation → verified user → rate limit → RPC. Logs carry only an operation name and a code.
import type { SupabaseClient } from "@supabase/supabase-js";
import { markReadInputSchema, notificationPreferenceInputSchema, type PreferenceOutcome } from "@familysafe/contracts";
import { NOTIFICATIONS, checkRateLimit } from "@/lib/security/ratelimit";

export interface NotificationsDeps { supabase: SupabaseClient }

export type MarkReadResult = { ok: true; changed: number } | { ok: false; message: string; redirectTo?: string };

const GENERIC = "Something went wrong. Please try again.";
const TOO_MANY = "Too many changes in a short time. Please wait a few minutes and try again.";

/** `ids: null` = every unread notification; otherwise a short list of notification ids. */
export async function markRead(deps: NotificationsDeps, ids: string[] | null): Promise<MarkReadResult> {
  const parsed = markReadInputSchema.safeParse({ ids });
  if (!parsed.success) return { ok: false, message: GENERIC };

  const { data: auth, error: authError } = await deps.supabase.auth.getUser(); // verified by the Auth server
  if (authError || !auth.user) return { ok: false, message: "Please sign in again.", redirectTo: "/login" };
  if (!checkRateLimit(NOTIFICATIONS.write, auth.user.id).allowed) return { ok: false, message: TOO_MANY };

  const { data, error } = await deps.supabase.rpc("parent_mark_notifications_read", { p_ids: parsed.data.ids });
  if (error) {
    console.error("notifications_mark_read_failed", error.code ?? "unknown"); // code only — never ids
    if (error.code === "42501") return { ok: false, message: "Please sign in again.", redirectTo: "/login" };
    return { ok: false, message: GENERIC };
  }
  const changed = typeof data === "number" && Number.isInteger(data) && data >= 0 ? data : 0;
  return { ok: true, changed };
}

export type PreferenceResult = { ok: true; outcome: PreferenceOutcome } | { ok: false; message: string; redirectTo?: string };

const ALWAYS_ON = "Emergency alerts and security notices are always on.";

/** Order: validation → verified user → rate limit → RPC. The RPC itself refuses to switch an always-on type off (22023). */
export async function setPreference(deps: NotificationsDeps, raw: { type: unknown; enabled: unknown }): Promise<PreferenceResult> {
  const parsed = notificationPreferenceInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: GENERIC };

  const { data: auth, error: authError } = await deps.supabase.auth.getUser();
  if (authError || !auth.user) return { ok: false, message: "Please sign in again.", redirectTo: "/login" };
  if (!checkRateLimit(NOTIFICATIONS.write, auth.user.id).allowed) return { ok: false, message: TOO_MANY };

  const { data, error } = await deps.supabase.rpc("parent_set_notification_preference", { p_type: parsed.data.type, p_enabled: parsed.data.enabled });
  if (error) {
    console.error("notification_preference_failed", error.code ?? "unknown"); // code only — never the type
    if (error.code === "42501") return { ok: false, message: "Please sign in again.", redirectTo: "/login" };
    if (error.code === "22023") return { ok: false, message: ALWAYS_ON };
    return { ok: false, message: GENERIC };
  }
  if (data === "updated" || data === "unchanged") return { ok: true, outcome: data };
  console.error("notification_preference_failed", "unexpected_outcome");
  return { ok: false, message: GENERIC };
}
