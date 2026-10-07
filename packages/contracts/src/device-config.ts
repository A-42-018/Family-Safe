// Screen-time rules / device config contracts (Phase 17a). Edge Functions mirror the constants and the ETag helpers
// locally (they cannot import workspace packages) — keep `supabase/functions/_shared/device-config.ts` in sync. SQL
// limits live in migration `20260930001600_screen_time_rules.sql`; a drift test compares all three.
import { z } from "zod";
import { PACKAGE_NAME_PATTERN } from "./device-apps";

/** The app re-pulls its config at least this often even without a SYNC_CONFIG command (Android decides the schedule). */
export const DEVICE_CONFIG_INTERVAL_SECONDS = 21600;
export const DAILY_LIMIT_MAX_MINUTES = 1440;
/** Command queued for the device on every real rule change. Its payload is always `{}` — values are pulled, never pushed. */
export const SYNC_CONFIG_COMMAND = "SYNC_CONFIG";
export const SYNC_CONFIG_TTL_HOURS = 24;

export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type IsoWeekday = (typeof ISO_WEEKDAYS)[number];

const limitMinutes = z.number().int().min(0).max(DAILY_LIMIT_MAX_MINUTES);

/** Phase 18a: at most this many app rules per device (SQL cap trigger + `device_get_config` limit). */
export const APP_RULES_MAX = 200;
/** The child app itself can never be restricted (SQL CHECK + RPC). */
export const CHILD_APP_PACKAGE = "app.familysafe.child";
/** Outcomes of the parent RPC `parent_set_app_rule` (mapped generically by the web layer in 18b). */
export const APP_RULE_OUTCOMES = ["updated", "cleared", "unchanged", "not_found", "inactive", "unknown_app"] as const;
export type AppRuleOutcome = (typeof APP_RULE_OUTCOMES)[number];

/**
 * One app restriction as the device receives it. A rule restricts something: `blocked`, or a daily limit
 * (`0` = no use that day). While `blocked` is true the stored limit is kept but ignored (blocked wins).
 * Labels are never sent: the device knows its own app names.
 */
export const appRuleSchema = z
  .object({
    package_name: z.string().max(255).regex(PACKAGE_NAME_PATTERN),
    blocked: z.boolean(),
    daily_limit_minutes: limitMinutes.nullable(),
  })
  .strict()
  .refine((r) => r.package_name !== CHILD_APP_PACKAGE, { message: "the child app cannot be restricted" })
  .refine((r) => r.blocked || r.daily_limit_minutes !== null, { message: "a rule must block or limit" });
export type AppRule = z.infer<typeof appRuleSchema>;

/** Parent input for one app (used by the Phase 18b action). "No restriction" = `blocked: false` + `daily_limit_minutes: null`. */
export const appRuleInputSchema = z
  .object({
    device_id: z.string().uuid(),
    package_name: z.string().max(255).regex(PACKAGE_NAME_PATTERN),
    blocked: z.boolean(),
    daily_limit_minutes: limitMinutes.nullable(),
  })
  .strict()
  .refine((r) => r.package_name !== CHILD_APP_PACKAGE, { message: "the child app cannot be restricted" });
export type AppRuleInput = z.infer<typeof appRuleInputSchema>;

/** ISO weekday ("1" = Monday … "7" = Sunday) -> minutes. A present key replaces the default limit; 0 = no screen time. */
export const dayLimitOverridesSchema = z
  .object({
    "1": limitMinutes.optional(),
    "2": limitMinutes.optional(),
    "3": limitMinutes.optional(),
    "4": limitMinutes.optional(),
    "5": limitMinutes.optional(),
    "6": limitMinutes.optional(),
    "7": limitMinutes.optional(),
  })
  .strict();
export type DayLimitOverrides = z.infer<typeof dayLimitOverridesSchema>;

/** Parent input (used by the Phase 17b form/action). `daily_limit_minutes: null` = no default daily limit. */
export const screenTimeRulesInputSchema = z
  .object({
    device_id: z.string().uuid(),
    daily_limit_minutes: limitMinutes.nullable(),
    daily_limit_overrides: dayLimitOverridesSchema,
  })
  .strict();
export type ScreenTimeRulesInput = z.infer<typeof screenTimeRulesInputSchema>;

const hhmm = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);

// ---------------------------------------------------------------------------------------------------------------------
// Phase 19a-2 — schedules + time zone. SQL: migration `20260930001800_schedules.sql` (a drift test compares the two).
// Window semantics: ISO weekdays, minute resolution, `end < start` = overnight and belongs to the day it STARTS on,
// `start = end` is invalid, ranges are half-open (back-to-back windows do not overlap), a window running past Sunday
// midnight wraps into Monday. Enabled windows of the SAME type must not overlap; different types may.
// ---------------------------------------------------------------------------------------------------------------------
/** At most this many schedules per device, enabled or not (SQL guard trigger + `device_get_config` limit). */
export const SCHEDULES_MAX = 20;
export const SCHEDULE_NAME_MAX = 100;
export const SCHEDULE_TYPES = ["BEDTIME", "SCHOOL", "CUSTOM"] as const;
export type ScheduleType = (typeof SCHEDULE_TYPES)[number];
/** Outcomes of the parent RPCs (mapped generically by the Phase 19b web layer; never echo ids/values). */
export const SCHEDULE_SAVE_OUTCOMES = ["created", "updated", "unchanged", "overlap", "limit_reached", "not_found", "inactive"] as const;
export const SCHEDULE_DELETE_OUTCOMES = ["deleted", "not_found", "inactive"] as const;
export const TIMEZONE_OUTCOMES = ["updated", "unchanged", "not_found", "inactive"] as const;
export type ScheduleSaveOutcome = (typeof SCHEDULE_SAVE_OUTCOMES)[number];
export type ScheduleDeleteOutcome = (typeof SCHEDULE_DELETE_OUTCOMES)[number];
export type TimezoneOutcome = (typeof TIMEZONE_OUTCOMES)[number];

/**
 * Same format as SQL `is_timezone_name_format`: `UTC` or `Region/City[/Sub]`, 1–64 characters, no abbreviations
 * (`EST`), no `SystemV/`, `posix/` or `right/` trees. Existence in the tz database is checked by the SQL RPC only.
 */
export const TIMEZONE_NAME_PATTERN = /^[A-Z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;
export function isTimezoneNameFormat(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 64 &&
    TIMEZONE_NAME_PATTERN.test(value) &&
    (value === "UTC" || value.includes("/")) &&
    !/^(SystemV|posix|right)\//.test(value)
  );
}
export const timezoneSchema = z.string().refine(isTimezoneNameFormat, { message: "invalid time zone name" });

const noControlChars = (s: string) => !/[\u0000-\u001f\u007f-\u009f]/.test(s);
const sortedDays = z
  .array(z.number().int().min(1).max(7))
  .min(1)
  .max(7)
  .refine((d) => new Set(d).size === d.length, { message: "duplicate weekday" });

/** One ENABLED window exactly as the device receives it: trimmed name, days ascending, `HH:MM` times. */
export const scheduleSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(SCHEDULE_NAME_MAX).refine((s) => s === s.trim() && noControlChars(s), { message: "invalid name" }),
    type: z.enum(SCHEDULE_TYPES),
    days: sortedDays.refine((d) => d.every((v, i) => i === 0 || (d[i - 1] ?? 0) < v), { message: "days must be ascending" }),
    start_time: hhmm,
    end_time: hhmm,
  })
  .strict()
  .refine((s) => s.start_time !== s.end_time, { message: "start and end must differ", path: ["end_time"] });
export type Schedule = z.infer<typeof scheduleSchema>;

const scheduleName = z
  .string()
  .refine(noControlChars, { message: "invalid name" })
  .transform((s) => s.trim())
  .pipe(z.string().min(1).max(SCHEDULE_NAME_MAX));

/** Parent input for `parent_save_schedule` (Phase 19b). `schedule_id: null` = create. Days may come in any order (SQL sorts). */
export const scheduleInputSchema = z
  .object({
    device_id: z.string().uuid(),
    schedule_id: z.string().uuid().nullable(),
    name: scheduleName,
    type: z.enum(SCHEDULE_TYPES),
    days: sortedDays,
    start_time: hhmm,
    end_time: hhmm,
    enabled: z.boolean(),
  })
  .strict()
  .refine((s) => s.start_time !== s.end_time, { message: "start and end must differ", path: ["end_time"] });
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;

/** Parent input for `parent_delete_schedule`. */
export const scheduleDeleteInputSchema = z.object({ device_id: z.string().uuid(), schedule_id: z.string().uuid() }).strict();
export type ScheduleDeleteInput = z.infer<typeof scheduleDeleteInputSchema>;

/** Parent input for `parent_set_device_timezone`. `timezone: null` = follow the device's own time zone. */
export const timezoneInputSchema = z.object({ device_id: z.string().uuid(), timezone: timezoneSchema.nullable() }).strict();
export type TimezoneInput = z.infer<typeof timezoneInputSchema>;

export const MINUTES_PER_DAY = 1440;
export const MINUTES_PER_WEEK = 10080;

function minuteOfDay(hhmmText: string): number {
  return Number(hhmmText.slice(0, 2)) * 60 + Number(hhmmText.slice(3, 5));
}

/** Half-open `[lo, hi)` minute ranges within one week (Monday 00:00 = 0); mirrors SQL `schedule_week_ranges`. Assumes valid input. */
export function scheduleWeekRanges(days: readonly number[], startTime: string, endTime: string): Array<[number, number]> {
  const sm = minuteOfDay(startTime);
  const em = minuteOfDay(endTime);
  const length = em > sm ? em - sm : MINUTES_PER_DAY - sm + em;
  const out: Array<[number, number]> = [];
  for (const d of days) {
    const lo = (d - 1) * MINUTES_PER_DAY + sm;
    const hi = lo + length;
    out.push([lo, Math.min(hi, MINUTES_PER_WEEK)]);
    if (hi > MINUTES_PER_WEEK) out.push([0, hi - MINUTES_PER_WEEK]);
  }
  return out;
}

type Window = { days: readonly number[]; start_time: string; end_time: string };

/** Do two windows share any minute of the week? (Types are not compared here.) */
export function schedulesOverlap(a: Window, b: Window): boolean {
  const ra = scheduleWeekRanges(a.days, a.start_time, a.end_time);
  const rb = scheduleWeekRanges(b.days, b.start_time, b.end_time);
  return ra.some(([alo, ahi]) => rb.some(([blo, bhi]) => alo < bhi && blo < ahi));
}

/** `data` of a 200 response from `GET /functions/v1/device-config`. */
export const deviceConfigSchema = z
  .object({
    config_version: z.number().int().min(1),
    daily_limit_minutes: limitMinutes.nullable(),
    daily_limit_overrides: dayLimitOverridesSchema,
    app_rules: z.array(appRuleSchema).max(APP_RULES_MAX),
    /** IANA name, or `null` = the device's own time zone (Phase 19a). */
    timezone: timezoneSchema.nullable(),
    /** ENABLED windows only, ordered by type, start, id (Phase 19a). */
    schedules: z.array(scheduleSchema).max(SCHEDULES_MAX),
    server_time: z.string().datetime(),
    next_interval_seconds: z.literal(DEVICE_CONFIG_INTERVAL_SECONDS),
  })
  .strict()
  .superRefine((c, ctx) => {
    const seen = new Set<string>();
    for (const [i, rule] of c.app_rules.entries()) {
      if (seen.has(rule.package_name)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["app_rules", i, "package_name"], message: "duplicate package name" });
        break;
      }
      seen.add(rule.package_name);
    }
    const ids = new Set<string>();
    for (const [i, sch] of c.schedules.entries()) {
      if (ids.has(sch.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["schedules", i, "id"], message: "duplicate schedule id" });
        break;
      }
      ids.add(sch.id);
    }
    // SQL guarantees: enabled windows of the same type never overlap (different types may).
    const clash = c.schedules.findIndex((a, i) => c.schedules.slice(0, i).some((b) => a.type === b.type && schedulesOverlap(a, b)));
    if (clash >= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["schedules", clash, "start_time"], message: "overlapping schedules of the same type" });
    }
  });
export type DeviceConfig = z.infer<typeof deviceConfigSchema>;

/** Minutes allowed on an ISO weekday, or `null` for "no limit". Override beats the default; absent override = default. */
export function effectiveDailyLimitMinutes(
  config: { daily_limit_minutes: number | null; daily_limit_overrides: DayLimitOverrides },
  isoWeekday: IsoWeekday,
): number | null {
  const override = config.daily_limit_overrides[String(isoWeekday) as "1"];
  return override !== undefined ? override : config.daily_limit_minutes;
}

/** Strong validator for the version: a positive int that fits the SQL `int` column with room to spare. */
export const CONFIG_ETAG_MAX_VERSION = 999_999_999;

export function etagForConfigVersion(version: number): string {
  return `"v${version}"`;
}

/** Version from an `If-None-Match` header (`"v3"` or `W/"v3"`); anything else (lists, `*`, junk) -> null = send the body. */
export function parseConfigEtag(header: string | null): number | null {
  if (header === null) return null;
  const m = /^(?:W\/)?"v([1-9][0-9]{0,8})"$/.exec(header.trim());
  return m ? Number(m[1]) : null;
}
