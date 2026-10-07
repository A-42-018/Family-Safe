// Pure rules for the schedules editor on `/devices/[id]/schedules` and the dashboard count (Phase 19b).
// No data access, no React. Limits and validation come from the contracts package; the database re-checks everything
// (RPCs + CHECKs + guard trigger), so this layer only gives early, friendly feedback and never invents a result.
import {
  isTimezoneNameFormat,
  ISO_WEEKDAYS,
  SCHEDULE_NAME_MAX,
  scheduleDeleteInputSchema,
  scheduleInputSchema,
  SCHEDULE_TYPES,
  SCHEDULES_MAX,
  schedulesOverlap,
  timezoneInputSchema,
  type ScheduleDeleteInput,
  type ScheduleInput,
  type ScheduleType,
  type TimezoneInput,
} from "@familysafe/contracts";
import type { FieldErrors } from "@/lib/auth/form-state";
import { isUuid } from "@/lib/ids";

/** Columns read from `schedules` (parents have SELECT; the write path is the RPCs only). */
export const SCHEDULE_COLUMNS = "id,name,type,days,start_time,end_time,enabled";
/** The time zone lives on the device's rules row (parents can read it, never write it directly). */
export const TIMEZONE_COLUMN = "timezone";

export interface ScheduleRow {
  id: string;
  name: string;
  type: ScheduleType;
  /** ISO weekdays 1..7, ascending, unique. An overnight window belongs to the day it starts on. */
  days: number[];
  startTime: string;
  endTime: string;
  enabled: boolean;
}

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
/** PostgREST returns `time` as `HH:MM:SS`; the editor works with minute resolution. */
const clock = (v: unknown): string | null => (typeof v === "string" && /^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/.test(v) ? v.slice(0, 5) : null);
const isType = (v: unknown): v is ScheduleType => typeof v === "string" && (SCHEDULE_TYPES as readonly string[]).includes(v);
// eslint-disable-next-line no-control-regex -- control characters are exactly what the name check rejects (mirrors the contract and SQL)
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** A raw `schedules` row → `ScheduleRow`; anything unusable → null (skipped, never invented). */
export function asScheduleRow(raw: unknown): ScheduleRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !isUuid(r.id)) return null;
  if (typeof r.name !== "string" || r.name.trim().length === 0 || r.name.length > SCHEDULE_NAME_MAX) return null;
  if (!isType(r.type) || typeof r.enabled !== "boolean") return null;
  if (!Array.isArray(r.days) || r.days.length === 0 || r.days.length > ISO_WEEKDAYS.length) return null;
  if (!r.days.every((d) => typeof d === "number" && Number.isInteger(d) && d >= 1 && d <= ISO_WEEKDAYS.length)) return null;
  const days = [...new Set(r.days as number[])].sort((a, b) => a - b);
  if (days.length !== r.days.length) return null;
  const startTime = clock(r.start_time);
  const endTime = clock(r.end_time);
  if (startTime === null || endTime === null || startTime === endTime) return null;
  return { id: r.id, name: r.name, type: r.type, days, startTime, endTime, enabled: r.enabled };
}

/** The stored time zone of a device: `null` = follows the phone's own zone. A malformed value is treated as unreadable (`undefined`). */
export function asTimezone(raw: unknown): string | null | undefined {
  if (raw === null) return null;
  return typeof raw === "string" && isTimezoneNameFormat(raw) ? raw : undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------------------------------------------------

export const TYPE_LABELS: Record<ScheduleType, string> = { BEDTIME: "Bedtime", SCHOOL: "School time", CUSTOM: "Custom" };
export const typeLabel = (t: ScheduleType): string => TYPE_LABELS[t];

const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const same = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

export function daysText(days: readonly number[]): string {
  const d = [...days].sort((a, b) => a - b);
  if (same(d, ISO_WEEKDAYS)) return "Every day";
  if (same(d, [1, 2, 3, 4, 5])) return "Weekdays";
  if (same(d, [6, 7])) return "Weekends";
  return d.map((n) => DAY_SHORT[n - 1] ?? "").filter(Boolean).join(", ");
}

/** Lexicographic comparison is correct for zero-padded `HH:MM`. */
export const isOvernight = (s: Pick<ScheduleRow, "startTime" | "endTime">): boolean => s.endTime < s.startTime;

export function timeRangeText(s: Pick<ScheduleRow, "startTime" | "endTime">): string {
  return isOvernight(s) ? `${s.startTime} to ${s.endTime} the next day` : `${s.startTime} to ${s.endTime}`;
}

/** "Weekdays · 21:00 to 07:00 the next day" */
export const scheduleLine = (s: ScheduleRow): string => `${daysText(s.days)} · ${timeRangeText(s)}`;

/** Display order: type (as listed in the contract), then start time, then name. */
export function sortSchedules(rows: readonly ScheduleRow[]): ScheduleRow[] {
  const rank = (t: ScheduleType): number => (SCHEDULE_TYPES as readonly string[]).indexOf(t);
  return [...rows].sort((a, b) => rank(a.type) - rank(b.type) || a.startTime.localeCompare(b.startTime) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export const enabledCount = (rows: readonly ScheduleRow[]): number => rows.filter((r) => r.enabled).length;
export const atScheduleCap = (rows: readonly ScheduleRow[]): boolean => rows.length >= SCHEDULES_MAX;
export const SCHEDULE_CAP_NOTE = `A device can have at most ${SCHEDULES_MAX} schedules, on or off. Delete one to add another.`;

export function scheduleSummaryText(rows: readonly ScheduleRow[]): string {
  if (rows.length === 0) return "No schedules yet.";
  const on = enabledCount(rows);
  const total = `${rows.length} ${rows.length === 1 ? "schedule" : "schedules"}`;
  return on === rows.length ? `${total}, all on.` : `${total}, ${on} on.`;
}

export interface OverlapCandidate {
  /** `null` while creating. */
  id: string | null;
  type: ScheduleType;
  days: readonly number[];
  startTime: string;
  endTime: string;
  enabled: boolean;
}

/**
 * First ENABLED schedule of the SAME type that shares a minute of the week with the candidate (a disabled candidate never
 * collides; different types may overlap; back-to-back windows do not overlap). Mirrors the SQL rule — for a hint only: SQL
 * stays authoritative and answers `overlap` itself.
 */
export function findOverlap(candidate: OverlapCandidate, existing: readonly ScheduleRow[]): ScheduleRow | null {
  if (!candidate.enabled) return null;
  const mine = { days: candidate.days, start_time: candidate.startTime, end_time: candidate.endTime };
  return existing.find((o) => o.enabled && o.type === candidate.type && o.id !== candidate.id && schedulesOverlap(mine, { days: o.days, start_time: o.startTime, end_time: o.endTime })) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Time zone
// ---------------------------------------------------------------------------------------------------------------------

/** Curated choices (the name must exist in the database's tz list; SQL answers 22023 otherwise). Free text is not offered. */
export const TIMEZONE_CHOICES: readonly string[] = [
  "UTC",
  "Pacific/Honolulu",
  "America/Anchorage",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Halifax",
  "America/Mexico_City",
  "America/Bogota",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "Atlantic/Reykjavik",
  "Europe/London",
  "Europe/Paris",
  "Europe/Athens",
  "Europe/Istanbul",
  "Europe/Moscow",
  "Africa/Lagos",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Nairobi",
  "Asia/Riyadh",
  "Asia/Tehran",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Jakarta",
  "Asia/Singapore",
  "Asia/Manila",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Perth",
  "Australia/Sydney",
  "Pacific/Auckland",
];

export const timezoneLabel = (name: string): string => name.replace(/_/g, " ").replace(/\//g, " / ");

export interface TimezoneOption { value: string; label: string }

/** The curated list; a stored zone that is not in it is added so the select never silently changes it. */
export function timezoneOptions(current: string | null | undefined): TimezoneOption[] {
  const names = typeof current === "string" && !TIMEZONE_CHOICES.includes(current) ? [current, ...TIMEZONE_CHOICES] : [...TIMEZONE_CHOICES];
  return names.map((n) => ({ value: n, label: timezoneLabel(n) }));
}

export const DEVICE_ZONE_LABEL = "The child's phone's own time zone";
export const timezoneText = (tz: string | null): string => (tz === null ? DEVICE_ZONE_LABEL : timezoneLabel(tz));

// ---------------------------------------------------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------------------------------------------------

export const FIELD = {
  deviceId: "device_id",
  scheduleId: "schedule_id",
  name: "name",
  type: "type",
  days: "days",
  start: "start_time",
  end: "end_time",
  enabled: "enabled",
  timezone: "timezone",
  day: (iso: number) => `day_${iso}`,
} as const;

/** The only keys each action reads; everything else in a submission is ignored. */
export const SCHEDULE_FORM_KEYS: readonly string[] = [
  FIELD.deviceId, FIELD.scheduleId, FIELD.name, FIELD.type, FIELD.start, FIELD.end, FIELD.enabled, ...ISO_WEEKDAYS.map((d) => FIELD.day(d)),
];
export const SCHEDULE_DELETE_KEYS: readonly string[] = [FIELD.deviceId, FIELD.scheduleId];
export const TIMEZONE_FORM_KEYS: readonly string[] = [FIELD.deviceId, FIELD.timezone];

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const ON = "on";

export const NAME_ERROR = `Enter a name of up to ${SCHEDULE_NAME_MAX} characters.`;
export const DAYS_ERROR = "Choose at least one day.";
export const TIME_ERROR = "Enter a time as hours and minutes, for example 21:30.";
export const SAME_TIME_ERROR = "Start and end must be different times.";
export const TYPE_ERROR = "Choose a type.";

/** Form values (strings) for a stored schedule, or the defaults of a new one. */
export function toScheduleFormValues(row?: ScheduleRow): Record<string, string> {
  const v: Record<string, string> = {
    [FIELD.name]: row?.name ?? "",
    [FIELD.type]: row?.type ?? "BEDTIME",
    [FIELD.start]: row?.startTime ?? "21:00",
    [FIELD.end]: row?.endTime ?? "07:00",
    [FIELD.enabled]: row ? (row.enabled ? ON : "") : ON,
  };
  for (const iso of ISO_WEEKDAYS) v[FIELD.day(iso)] = row ? (row.days.includes(iso) ? ON : "") : "";
  return v;
}

export type ParsedSchedule =
  | { ok: true; input: ScheduleInput; values: Record<string, string> }
  | { ok: false; fieldErrors: FieldErrors; values: Record<string, string>; formError?: string };

/** Raw form fields → validated contract input. Pure; the contract schema has the last word. */
export function parseScheduleForm(raw: Record<string, unknown>): ParsedSchedule {
  const values: Record<string, string> = {};
  for (const k of SCHEDULE_FORM_KEYS) if (k !== FIELD.deviceId && k !== FIELD.scheduleId) values[k] = str(raw[k]);
  const fieldErrors: FieldErrors = {};

  const name = values[FIELD.name] ?? "";
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > SCHEDULE_NAME_MAX || CONTROL.test(name)) fieldErrors[FIELD.name] = [NAME_ERROR];

  const type = values[FIELD.type] ?? "";
  if (!isType(type)) fieldErrors[FIELD.type] = [TYPE_ERROR];

  const days = ISO_WEEKDAYS.filter((d) => values[FIELD.day(d)] === ON);
  if (days.length === 0) fieldErrors[FIELD.days] = [DAYS_ERROR];

  const start = values[FIELD.start] ?? "";
  const end = values[FIELD.end] ?? "";
  if (!HHMM.test(start)) fieldErrors[FIELD.start] = [TIME_ERROR];
  if (!HHMM.test(end)) fieldErrors[FIELD.end] = [TIME_ERROR];
  else if (start === end) fieldErrors[FIELD.end] = [SAME_TIME_ERROR];

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors, values };

  const scheduleId = str(raw[FIELD.scheduleId]);
  if (scheduleId !== "" && !isUuid(scheduleId)) return { ok: false, fieldErrors: {}, values, formError: "That schedule can't be changed." };

  const parsed = scheduleInputSchema.safeParse({
    device_id: str(raw[FIELD.deviceId]),
    schedule_id: scheduleId === "" ? null : scheduleId,
    name,
    type,
    days,
    start_time: start,
    end_time: end,
    enabled: values[FIELD.enabled] === ON,
  });
  if (!parsed.success) return { ok: false, fieldErrors: {}, values, formError: "Those settings aren't valid. Check them and try again." };
  return { ok: true, input: parsed.data, values };
}

export type ParsedDelete = { ok: true; input: ScheduleDeleteInput } | { ok: false };

export function parseScheduleDelete(raw: Record<string, unknown>): ParsedDelete {
  const parsed = scheduleDeleteInputSchema.safeParse({ device_id: str(raw[FIELD.deviceId]), schedule_id: str(raw[FIELD.scheduleId]) });
  return parsed.success ? { ok: true, input: parsed.data } : { ok: false };
}

export type ParsedTimezone =
  | { ok: true; input: TimezoneInput; values: Record<string, string> }
  | { ok: false; fieldErrors: FieldErrors; values: Record<string, string>; formError?: string };

export const TIMEZONE_ERROR = "Choose a time zone from the list.";

/** An empty choice = follow the phone's own time zone (`null`). Whether the name exists is decided by the database. */
export function parseTimezoneForm(raw: Record<string, unknown>): ParsedTimezone {
  const value = str(raw[FIELD.timezone]);
  const values = { [FIELD.timezone]: value };
  const parsed = timezoneInputSchema.safeParse({ device_id: str(raw[FIELD.deviceId]), timezone: value === "" ? null : value });
  if (!parsed.success) return { ok: false, fieldErrors: { [FIELD.timezone]: [TIMEZONE_ERROR] }, values };
  return { ok: true, input: parsed.data, values };
}

// ---------------------------------------------------------------------------------------------------------------------
// Copy. Informational only: a setting is not proof that a phone follows it.
// ---------------------------------------------------------------------------------------------------------------------

export const SYNC_NOTE = "The child's phone picks this up on its next sync.";
export const CREATED_MESSAGE = `Schedule added. ${SYNC_NOTE}`;
export const UPDATED_MESSAGE = `Schedule saved. ${SYNC_NOTE}`;
export const DELETED_MESSAGE = `Schedule deleted. ${SYNC_NOTE}`;
export const TIMEZONE_SAVED_MESSAGE = `Time zone saved. ${SYNC_NOTE}`;
export const UNCHANGED_MESSAGE = "No changes to save.";
export const INACTIVE_MESSAGE = "This device is no longer active, so its schedules can't be changed.";
export const OVERLAP_MESSAGE = "Another schedule of the same type is on during part of this time. Change the days or times, or turn the other one off.";
export const LIMIT_MESSAGE = `This device already has ${SCHEDULES_MAX} schedules. Delete one to add another.`;
export const INVALID_MESSAGE = "Those settings aren't valid. Check them and try again.";
export const SCHEDULE_GONE_MESSAGE = "That schedule no longer exists. Reload the page.";
export const TIMEZONE_UNKNOWN_MESSAGE = "That time zone isn't available. Choose another one from the list.";

export const OVERNIGHT_NOTE = "A schedule that ends earlier than it starts runs overnight and belongs to the day it starts on.";
export const TYPES_NOTE = "Schedules of the same type can't be on at the same time. Different types may overlap.";
export const SCHEDULES_NOTE =
  "Schedules are settings stored for this device, with times read in the time zone above. The child's app does not apply schedules yet, so nothing changes on the phone when a schedule starts or ends. " +
  "Android does not let this app lock the phone: when schedules are applied, the app will be able to tell your child that a quiet time has started, not close other apps.";
