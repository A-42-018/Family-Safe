// Screen-time rules business logic (Phase 17b), independent of the Next runtime (dependencies injected) so it is unit-testable.
// Write path: PostgREST `rpc("parent_set_screen_time_rules")` under the parent's own session. Ownership is decided in SQL
// (a foreign device is indistinguishable from a missing one). This layer maps outcomes generically, rate-limits, and
// never logs values (limits, ids, names) — only a short operation name and the error code.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FieldErrors } from "@/lib/auth/form-state";
import { isUuid } from "@/lib/ids";
import { checkRateLimit, DEVICE_RULES } from "@/lib/security/ratelimit";
import { FIELD, INACTIVE_MESSAGE, parseRulesForm, SAVED_MESSAGE, UNCHANGED_MESSAGE } from "./rules";

export interface RulesDeps { supabase: SupabaseClient }

export type RulesResult =
  | { ok: true; deviceId: string; outcome: "updated" | "unchanged"; message: string; values: Record<string, string> }
  | { ok: false; message: string; fieldErrors?: FieldErrors; values?: Record<string, string>; notFound?: true; redirectTo?: string; readOnly?: true };

const GENERIC = "Something went wrong. Please try again.";
const TOO_MANY = "Too many changes in a short time. Please wait a few minutes and try again.";
const INVALID = "Please fix the highlighted fields.";

const fail = (message: string, extra: Partial<Extract<RulesResult, { ok: false }>> = {}): RulesResult => ({ ok: false, message, ...extra });

/** `data` of a `returns table` RPC is an array of rows; accept a single object too. */
function firstRow(data: unknown): { outcome: unknown } | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (typeof row !== "object" || row === null) return null;
  return { outcome: (row as Record<string, unknown>).o_outcome };
}

export async function setScreenTimeRules(deps: RulesDeps, raw: Record<string, unknown>): Promise<RulesResult> {
  const deviceId = typeof raw[FIELD.deviceId] === "string" ? (raw[FIELD.deviceId] as string) : "";
  if (!isUuid(deviceId)) return fail("Device not found.", { notFound: true });

  const parsed = parseRulesForm(raw);
  if (!parsed.ok) return fail(parsed.formError ?? INVALID, { fieldErrors: parsed.fieldErrors, values: parsed.values });

  const { data: auth, error: authError } = await deps.supabase.auth.getUser(); // verified by the Auth server, not cookie contents
  if (authError || !auth.user) return fail("Please sign in again.", { redirectTo: "/login" });
  if (!checkRateLimit(DEVICE_RULES.write, auth.user.id).allowed) return fail(TOO_MANY, { values: parsed.values });

  const { data, error } = await deps.supabase.rpc("parent_set_screen_time_rules", {
    p_device_id: parsed.input.device_id,
    p_daily_limit_minutes: parsed.input.daily_limit_minutes,
    p_daily_limit_overrides: parsed.input.daily_limit_overrides,
  });
  if (error) {
    console.error("rules_save_failed", error.code ?? "unknown"); // code only — never limits, ids or names
    if (error.code === "42501") return fail("Please sign in again.", { redirectTo: "/login" });
    if (error.code === "22023") return fail("Those limits aren't valid. Check the numbers and try again.", { values: parsed.values });
    return fail(GENERIC, { values: parsed.values });
  }

  const row = firstRow(data);
  switch (row?.outcome) {
    case "updated":
      return { ok: true, deviceId, outcome: "updated", message: SAVED_MESSAGE, values: parsed.values };
    case "unchanged":
      return { ok: true, deviceId, outcome: "unchanged", message: UNCHANGED_MESSAGE, values: parsed.values };
    case "not_found":
      return fail("Device not found.", { notFound: true });
    case "inactive":
      return fail(INACTIVE_MESSAGE, { readOnly: true, values: parsed.values });
    default:
      console.error("rules_save_failed", "unexpected_outcome");
      return fail(GENERIC, { values: parsed.values });
  }
}
