// Per-app restriction business logic (Phase 18b), independent of the Next runtime (dependencies injected) so it is unit-testable.
// Write path: PostgREST `rpc("parent_set_app_rule")` under the parent's own session. Ownership is decided in SQL (a foreign
// device is indistinguishable from a missing one). This layer maps outcomes generically, rate-limits, and never logs
// values (package names, limits, ids) — only a short operation name and the error code.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FieldErrors } from "@/lib/auth/form-state";
import { isUuid } from "@/lib/ids";
import { APP_RULES, checkRateLimit } from "@/lib/security/ratelimit";
import { FIELD, INACTIVE_MESSAGE, INVALID_MESSAGE, parseAppRuleForm, savedMessage, UNCHANGED_MESSAGE, UNKNOWN_APP_MESSAGE } from "./restrictions";

export interface AppRuleDeps { supabase: SupabaseClient }

export type AppRuleResult =
  | { ok: true; deviceId: string; outcome: "updated" | "cleared" | "unchanged"; message: string; values: Record<string, string> }
  | { ok: false; message: string; fieldErrors?: FieldErrors; values?: Record<string, string>; notFound?: true; redirectTo?: string; readOnly?: true };

const GENERIC = "Something went wrong. Please try again.";
const TOO_MANY = "Too many changes in a short time. Please wait a few minutes and try again.";

const fail = (message: string, extra: Partial<Extract<AppRuleResult, { ok: false }>> = {}): AppRuleResult => ({ ok: false, message, ...extra });

/** `data` of a `returns table` RPC is an array of rows; accept a single object too. */
function outcomeOf(data: unknown): unknown {
  const row = Array.isArray(data) ? data[0] : data;
  return typeof row === "object" && row !== null ? (row as Record<string, unknown>).o_outcome : undefined;
}

/** Order: UUID → field validation → verified user → rate limit → RPC. Invalid input never spends the allowance. */
export async function setAppRule(deps: AppRuleDeps, raw: Record<string, unknown>): Promise<AppRuleResult> {
  const deviceId = typeof raw[FIELD.deviceId] === "string" ? (raw[FIELD.deviceId] as string) : "";
  if (!isUuid(deviceId)) return fail("Device not found.", { notFound: true });

  const parsed = parseAppRuleForm(raw);
  if (!parsed.ok) return fail(parsed.formError ?? "Please fix the highlighted fields.", { fieldErrors: parsed.fieldErrors, values: parsed.values });

  const { data: auth, error: authError } = await deps.supabase.auth.getUser(); // verified by the Auth server, not cookie contents
  if (authError || !auth.user) return fail("Please sign in again.", { redirectTo: "/login" });
  if (!checkRateLimit(APP_RULES.write, auth.user.id).allowed) return fail(TOO_MANY, { values: parsed.values });

  const { data, error } = await deps.supabase.rpc("parent_set_app_rule", {
    p_device_id: parsed.input.device_id,
    p_package_name: parsed.input.package_name,
    p_blocked: parsed.input.blocked,
    p_daily_limit_minutes: parsed.input.daily_limit_minutes,
  });
  if (error) {
    console.error("app_rule_save_failed", error.code ?? "unknown"); // code only — never packages, limits or ids
    if (error.code === "42501") return fail("Please sign in again.", { redirectTo: "/login" });
    if (error.code === "22023") return fail(INVALID_MESSAGE, { values: parsed.values });
    return fail(GENERIC, { values: parsed.values });
  }

  switch (outcomeOf(data)) {
    case "updated":
    case "cleared": {
      const outcome = outcomeOf(data) as "updated" | "cleared";
      return { ok: true, deviceId, outcome, message: savedMessage(parsed.intent), values: parsed.values };
    }
    case "unchanged":
      return { ok: true, deviceId, outcome: "unchanged", message: UNCHANGED_MESSAGE, values: parsed.values };
    case "not_found":
      return fail("Device not found.", { notFound: true });
    case "inactive":
      return fail(INACTIVE_MESSAGE, { readOnly: true, values: parsed.values });
    case "unknown_app":
      return fail(UNKNOWN_APP_MESSAGE, { values: parsed.values });
    default:
      console.error("app_rule_save_failed", "unexpected_outcome");
      return fail(GENERIC, { values: parsed.values });
  }
}
