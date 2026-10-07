// Schedules business logic (Phase 19b), independent of the Next runtime (dependencies injected) so it is unit-testable.
// Write path: PostgREST `rpc("parent_save_schedule" | "parent_delete_schedule" | "parent_set_device_timezone")` under the
// parent's own session. Ownership, overlap, the 20-schedule cap and time-zone existence are decided in SQL (a foreign device
// is indistinguishable from a missing one). This layer maps outcomes generically, rate-limits, and never logs values
// (names, times, zones, ids) — only a short operation name and the error code.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FieldErrors } from "@/lib/auth/form-state";
import { isUuid } from "@/lib/ids";
import { checkRateLimit, SCHEDULES } from "@/lib/security/ratelimit";
import {
  CREATED_MESSAGE,
  DELETED_MESSAGE,
  FIELD,
  INACTIVE_MESSAGE,
  INVALID_MESSAGE,
  LIMIT_MESSAGE,
  OVERLAP_MESSAGE,
  parseScheduleDelete,
  parseScheduleForm,
  parseTimezoneForm,
  SCHEDULE_GONE_MESSAGE,
  TIMEZONE_SAVED_MESSAGE,
  TIMEZONE_UNKNOWN_MESSAGE,
  UNCHANGED_MESSAGE,
  UPDATED_MESSAGE,
} from "./schedules";

export interface ScheduleDeps { supabase: SupabaseClient }

type Failure = { ok: false; message: string; fieldErrors?: FieldErrors; values?: Record<string, string>; notFound?: true; redirectTo?: string; readOnly?: true };
export type SaveScheduleResult =
  | { ok: true; deviceId: string; outcome: "created" | "updated" | "unchanged"; message: string; values: Record<string, string> }
  | Failure;
export type DeleteScheduleResult = { ok: true; deviceId: string; message: string } | Failure;
export type TimezoneResult = { ok: true; deviceId: string; outcome: "updated" | "unchanged"; message: string; values: Record<string, string> } | Failure;

const GENERIC = "Something went wrong. Please try again.";
const TOO_MANY = "Too many changes in a short time. Please wait a few minutes and try again.";
const SIGN_IN = "Please sign in again.";

const fail = (message: string, extra: Omit<Failure, "ok" | "message"> = {}): Failure => ({ ok: false, message, ...extra });

/** `data` of a `returns table` RPC is an array of rows; accept a single object too. */
function outcomeOf(data: unknown): unknown {
  const row = Array.isArray(data) ? data[0] : data;
  return typeof row === "object" && row !== null ? (row as Record<string, unknown>).o_outcome : undefined;
}

const deviceIdOf = (raw: Record<string, unknown>): string => (typeof raw[FIELD.deviceId] === "string" ? (raw[FIELD.deviceId] as string) : "");

/** Verified user + rate limit; returns a failure to hand back, or null to go on. Always after input validation. */
async function gate(deps: ScheduleDeps, values?: Record<string, string>): Promise<Failure | null> {
  const { data: auth, error: authError } = await deps.supabase.auth.getUser(); // verified by the Auth server, not cookie contents
  if (authError || !auth.user) return fail(SIGN_IN, { redirectTo: "/login" });
  if (!checkRateLimit(SCHEDULES.write, auth.user.id).allowed) return fail(TOO_MANY, { values });
  return null;
}

/** Order: UUID → field validation → verified user → rate limit → RPC. Invalid input never spends the allowance. */
export async function saveSchedule(deps: ScheduleDeps, raw: Record<string, unknown>): Promise<SaveScheduleResult> {
  const deviceId = deviceIdOf(raw);
  if (!isUuid(deviceId)) return fail("Device not found.", { notFound: true });

  const parsed = parseScheduleForm(raw);
  if (!parsed.ok) return fail(parsed.formError ?? "Please fix the highlighted fields.", { fieldErrors: parsed.fieldErrors, values: parsed.values });

  const blocked = await gate(deps, parsed.values);
  if (blocked) return blocked;

  const i = parsed.input;
  const { data, error } = await deps.supabase.rpc("parent_save_schedule", {
    p_device_id: i.device_id,
    p_schedule_id: i.schedule_id,
    p_name: i.name,
    p_type: i.type,
    p_days: i.days,
    p_start_time: i.start_time,
    p_end_time: i.end_time,
    p_enabled: i.enabled,
  });
  if (error) {
    console.error("schedule_save_failed", error.code ?? "unknown"); // code only — never names, times or ids
    if (error.code === "42501") return fail(SIGN_IN, { redirectTo: "/login" });
    if (error.code === "22023") return fail(INVALID_MESSAGE, { values: parsed.values });
    return fail(GENERIC, { values: parsed.values });
  }

  switch (outcomeOf(data)) {
    // A created schedule clears the form (empty values fall back to the defaults); an edit keeps what was typed.
    case "created":
      return { ok: true, deviceId, outcome: "created", message: CREATED_MESSAGE, values: {} };
    case "updated":
      return { ok: true, deviceId, outcome: "updated", message: UPDATED_MESSAGE, values: parsed.values };
    case "unchanged":
      return { ok: true, deviceId, outcome: "unchanged", message: UNCHANGED_MESSAGE, values: parsed.values };
    case "overlap":
      return fail(OVERLAP_MESSAGE, { values: parsed.values });
    case "limit_reached":
      return fail(LIMIT_MESSAGE, { values: parsed.values });
    case "inactive":
      return fail(INACTIVE_MESSAGE, { readOnly: true, values: parsed.values });
    case "not_found":
      // Creating: the device is gone or not yours. Editing: the schedule may simply have been deleted in another tab.
      return i.schedule_id === null ? fail("Device not found.", { notFound: true }) : fail(SCHEDULE_GONE_MESSAGE, { values: parsed.values });
    default:
      console.error("schedule_save_failed", "unexpected_outcome");
      return fail(GENERIC, { values: parsed.values });
  }
}

export async function deleteSchedule(deps: ScheduleDeps, raw: Record<string, unknown>): Promise<DeleteScheduleResult> {
  const deviceId = deviceIdOf(raw);
  if (!isUuid(deviceId)) return fail("Device not found.", { notFound: true });
  const parsed = parseScheduleDelete(raw);
  if (!parsed.ok) return fail(SCHEDULE_GONE_MESSAGE);

  const blocked = await gate(deps);
  if (blocked) return blocked;

  const { data, error } = await deps.supabase.rpc("parent_delete_schedule", { p_device_id: parsed.input.device_id, p_schedule_id: parsed.input.schedule_id });
  if (error) {
    console.error("schedule_delete_failed", error.code ?? "unknown");
    if (error.code === "42501") return fail(SIGN_IN, { redirectTo: "/login" });
    return fail(GENERIC);
  }

  switch (outcomeOf(data)) {
    case "deleted":
      return { ok: true, deviceId, message: DELETED_MESSAGE };
    case "inactive":
      return fail(INACTIVE_MESSAGE, { readOnly: true });
    case "not_found":
      return fail(SCHEDULE_GONE_MESSAGE);
    default:
      console.error("schedule_delete_failed", "unexpected_outcome");
      return fail(GENERIC);
  }
}

export async function setDeviceTimezone(deps: ScheduleDeps, raw: Record<string, unknown>): Promise<TimezoneResult> {
  const deviceId = deviceIdOf(raw);
  if (!isUuid(deviceId)) return fail("Device not found.", { notFound: true });

  const parsed = parseTimezoneForm(raw);
  if (!parsed.ok) return fail(parsed.formError ?? "Please fix the highlighted fields.", { fieldErrors: parsed.fieldErrors, values: parsed.values });

  const blocked = await gate(deps, parsed.values);
  if (blocked) return blocked;

  const { data, error } = await deps.supabase.rpc("parent_set_device_timezone", { p_device_id: parsed.input.device_id, p_timezone: parsed.input.timezone });
  if (error) {
    console.error("timezone_save_failed", error.code ?? "unknown"); // code only — never the zone or ids
    if (error.code === "42501") return fail(SIGN_IN, { redirectTo: "/login" });
    if (error.code === "22023") return fail(TIMEZONE_UNKNOWN_MESSAGE, { values: parsed.values });
    return fail(GENERIC, { values: parsed.values });
  }

  switch (outcomeOf(data)) {
    case "updated":
      return { ok: true, deviceId, outcome: "updated", message: TIMEZONE_SAVED_MESSAGE, values: parsed.values };
    case "unchanged":
      return { ok: true, deviceId, outcome: "unchanged", message: UNCHANGED_MESSAGE, values: parsed.values };
    case "not_found":
      return fail("Device not found.", { notFound: true });
    case "inactive":
      return fail(INACTIVE_MESSAGE, { readOnly: true, values: parsed.values });
    default:
      console.error("timezone_save_failed", "unexpected_outcome");
      return fail(GENERIC, { values: parsed.values });
  }
}
