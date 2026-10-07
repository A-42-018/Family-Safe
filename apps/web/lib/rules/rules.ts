// Pure rules for the screen-time rules editor and the dashboard "Active restrictions" card (Phase 17b).
// No data access, no React. Limits come from the contracts package; the database re-checks everything (RPC + CHECKs).
import {
  DAILY_LIMIT_MAX_MINUTES,
  dayLimitOverridesSchema,
  effectiveDailyLimitMinutes,
  ISO_WEEKDAYS,
  screenTimeRulesInputSchema,
  type DayLimitOverrides,
  type IsoWeekday,
  type ScreenTimeRulesInput,
} from "@familysafe/contracts";
import type { FieldErrors } from "@/lib/auth/form-state";
import { minutesText } from "@/lib/devices/usage";
import { formatLastSeen } from "@/lib/enrollment/format";

/** Columns read from `device_rules` (parents have SELECT; `config_version`/overrides are readable, never writable directly). */
export const RULES_COLUMNS =
  "config_version,daily_screen_limit_minutes,daily_limit_overrides,updated_at";

export interface RulesRow {
  configVersion: number;
  /** Default daily limit in minutes; `null` = no default limit. */
  dailyLimit: number | null;
  /** ISO weekday -> minutes; a present key replaces the default for that weekday (0 = no screen time). */
  overrides: DayLimitOverrides;
  updatedAt: string | null;
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/** A raw `device_rules` row → `RulesRow`; anything unusable → null (skipped, never invented). */
export function asRulesRow(raw: unknown): RulesRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const limit = r.daily_screen_limit_minutes;
  if (!isInt(r.config_version) || r.config_version < 1) return null;
  if (limit !== null && !(isInt(limit) && limit >= 0 && limit <= DAILY_LIMIT_MAX_MINUTES)) return null;
  const overrides = dayLimitOverridesSchema.safeParse(r.daily_limit_overrides);
  if (!overrides.success) return null;
  return {
    configVersion: r.config_version,
    dailyLimit: limit,
    overrides: overrides.data,
    updatedAt: typeof r.updated_at === "string" ? r.updated_at : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------------------------------------------------

export const DEFAULT_MODES = ["off", "limit", "zero"] as const;
export const DAY_MODES = ["default", "limit", "zero"] as const;
export type DefaultMode = (typeof DEFAULT_MODES)[number];
export type DayMode = (typeof DAY_MODES)[number];

export const WEEKDAYS: readonly { iso: IsoWeekday; label: string }[] = [
  { iso: 1, label: "Monday" },
  { iso: 2, label: "Tuesday" },
  { iso: 3, label: "Wednesday" },
  { iso: 4, label: "Thursday" },
  { iso: 5, label: "Friday" },
  { iso: 6, label: "Saturday" },
  { iso: 7, label: "Sunday" },
];

export const FIELD = {
  deviceId: "device_id",
  defaultMode: "default_mode",
  defaultMinutes: "default_minutes",
  dayMode: (iso: number) => `mode_${iso}`,
  dayMinutes: (iso: number) => `minutes_${iso}`,
} as const;

/** The only form keys the action reads; everything else in the submission is ignored. */
export const RULES_FORM_KEYS: readonly string[] = [
  FIELD.deviceId,
  FIELD.defaultMode,
  FIELD.defaultMinutes,
  ...ISO_WEEKDAYS.flatMap((d) => [FIELD.dayMode(d), FIELD.dayMinutes(d)]),
];

export const MINUTES_HINT = `Whole minutes, 1 to ${DAILY_LIMIT_MAX_MINUTES} (${DAILY_LIMIT_MAX_MINUTES / 60} hours).`;
const MINUTES_ERROR = `Enter whole minutes from 1 to ${DAILY_LIMIT_MAX_MINUTES}.`;

/** Form values (strings) for stored rules; `zero` and `limit` round-trip exactly. */
export function toFormValues(rules: { dailyLimit: number | null; overrides: DayLimitOverrides }): Record<string, string> {
  const v: Record<string, string> = {};
  const d = rules.dailyLimit;
  v[FIELD.defaultMode] = d === null ? "off" : d === 0 ? "zero" : "limit";
  v[FIELD.defaultMinutes] = d !== null && d > 0 ? String(d) : "";
  for (const { iso } of WEEKDAYS) {
    const o = rules.overrides[String(iso) as "1"];
    v[FIELD.dayMode(iso)] = o === undefined ? "default" : o === 0 ? "zero" : "limit";
    v[FIELD.dayMinutes(iso)] = o !== undefined && o > 0 ? String(o) : "";
  }
  return v;
}

export type ParsedRules =
  | { ok: true; input: ScreenTimeRulesInput; values: Record<string, string> }
  | { ok: false; fieldErrors: FieldErrors; values: Record<string, string>; formError?: string };

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Whole minutes 1..max from a text field; anything else (empty, decimals, signs, exponent, spaces inside) → null. */
export function parseMinutes(text: string): number | null {
  const t = text.trim();
  if (!/^[0-9]{1,4}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= DAILY_LIMIT_MAX_MINUTES ? n : null;
}

/** Raw form fields → validated contract input. Pure; the contract schema has the last word. */
export function parseRulesForm(raw: Record<string, unknown>): ParsedRules {
  const values: Record<string, string> = {};
  for (const k of RULES_FORM_KEYS) if (k !== FIELD.deviceId) values[k] = str(raw[k]);
  const fieldErrors: FieldErrors = {};
  let formError: string | undefined;

  const defaultMode = values[FIELD.defaultMode] as DefaultMode;
  let dailyLimit: number | null = null;
  if (defaultMode === "off") dailyLimit = null;
  else if (defaultMode === "zero") dailyLimit = 0;
  else if (defaultMode === "limit") {
    const m = parseMinutes(values[FIELD.defaultMinutes] ?? "");
    if (m === null) fieldErrors[FIELD.defaultMinutes] = [MINUTES_ERROR];
    else dailyLimit = m;
  } else formError = "Choose an option for each day.";

  const overrides: Record<string, number> = {};
  for (const { iso } of WEEKDAYS) {
    const mode = values[FIELD.dayMode(iso)] as DayMode;
    if (mode === "default") continue;
    if (mode === "zero") overrides[String(iso)] = 0;
    else if (mode === "limit") {
      const m = parseMinutes(values[FIELD.dayMinutes(iso)] ?? "");
      if (m === null) fieldErrors[FIELD.dayMinutes(iso)] = [MINUTES_ERROR];
      else overrides[String(iso)] = m;
    } else formError = "Choose an option for each day.";
  }

  if (formError !== undefined || Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors, values, formError };
  const parsed = screenTimeRulesInputSchema.safeParse({ device_id: str(raw[FIELD.deviceId]), daily_limit_minutes: dailyLimit, daily_limit_overrides: overrides });
  if (!parsed.success) return { ok: false, fieldErrors: {}, values, formError: "Those limits aren't valid. Check the numbers and try again." };
  return { ok: true, input: parsed.data, values };
}

// ---------------------------------------------------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------------------------------------------------

export interface PlanDay {
  iso: IsoWeekday;
  label: string;
  /** "No limit" | "No screen time" | "2 h". */
  text: string;
  source: "default" | "override";
}

/** The limit that applies on each weekday (override beats default). Mirrors the device's own evaluation rule. */
export function weekPlan(rules: { dailyLimit: number | null; overrides: DayLimitOverrides }): PlanDay[] {
  return WEEKDAYS.map(({ iso, label }) => {
    const minutes = effectiveDailyLimitMinutes({ daily_limit_minutes: rules.dailyLimit, daily_limit_overrides: rules.overrides }, iso);
    const source = rules.overrides[String(iso) as "1"] !== undefined ? "override" : "default";
    const text = minutes === null ? "No limit" : minutes === 0 ? "No screen time" : minutesText(minutes);
    return { iso, label, text, source };
  });
}

export const hasAnyLimit = (r: Pick<RulesRow, "dailyLimit" | "overrides">): boolean => r.dailyLimit !== null || Object.keys(r.overrides).length > 0;

/** "Settings version 3 · updated 5 minutes ago"; the time part is left out when the timestamp is missing or unusable. */
export function versionText(r: Pick<RulesRow, "configVersion" | "updatedAt">, now: Date = new Date()): string {
  const base = `Settings version ${r.configVersion}`;
  return r.updatedAt !== null && !Number.isNaN(Date.parse(r.updatedAt)) ? `${base} · updated ${formatLastSeen(r.updatedAt, now).toLowerCase()}` : base;
}

// Copy. Informational only: a setting is not proof that a phone follows it. Revised in Phase 17c-2 (Android limit check).
export const SAVED_MESSAGE = "Saved. The child's phone picks this up on its next sync.";
export const UNCHANGED_MESSAGE = "No changes to save.";
export const INACTIVE_MESSAGE = "This device is no longer active, so its rules can't be changed.";
export const ENFORCEMENT_NOTE =
  "These are settings stored for this device. The child's app reads them on its next sync. From app version 0.17.1 it measures today's screen time on the phone and shows your child a notice when the daily limit is nearly reached and when it is reached, while the app is open. " +
  "Android does not let this app lock the phone: the app only informs your child, it cannot close other apps, and it does not report a reached limit to you yet. Schedules are shown to your child the same way (see Schedules).";

// ---------------------------------------------------------------------------------------------------------------------
// Dashboard "Active restrictions"
// ---------------------------------------------------------------------------------------------------------------------

export interface RestrictionDevice {
  id: string;
  enrollmentStatus: "PENDING" | "ENROLLED" | "REVOKED";
}
export interface RestrictionsInput {
  devices: readonly RestrictionDevice[];
  /** Rules by device id; a missing entry = unreadable (never counted as "no restriction"). */
  rules: ReadonlyMap<string, RulesRow>;
  /** Phase 18b: effective app rules per device id (a missing entry = none). Optional so older callers keep working. */
  appRuleCounts?: ReadonlyMap<string, number>;
  /** Phase 19b: ENABLED schedules per device id (a missing entry = none). Optional so older callers keep working. */
  scheduleCounts?: ReadonlyMap<string, number>;
}
export interface RestrictionsSummary {
  enrolled: number;
  /** Enrolled devices with a screen-time limit, schedule or app rule set. */
  restricted: number;
  limits: number;
  /** Enrolled devices with at least one blocked or limited app. */
  appRules: number;
  /** Enrolled devices with at least one enabled schedule (Phase 19b). */
  schedules: number;
  /** Enrolled devices whose rules could not be read. */
  unknown: number;
}

export function summarizeRestrictions(input: RestrictionsInput): RestrictionsSummary {
  const s: RestrictionsSummary = { enrolled: 0, restricted: 0, limits: 0, appRules: 0, schedules: 0, unknown: 0 };
  for (const d of input.devices) {
    if (d.enrollmentStatus !== "ENROLLED") continue; // revoked / pending devices carry no active rules
    s.enrolled++;
    const apps = (input.appRuleCounts?.get(d.id) ?? 0) > 0;
    const scheduled = (input.scheduleCounts?.get(d.id) ?? 0) > 0;
    const r = input.rules.get(d.id);
    if (!r) {
      // Unreadable screen-time rules are never "unrestricted"; but known app rules and schedules still count as restrictions.
      if (apps) s.appRules++;
      if (scheduled) s.schedules++;
      if (apps || scheduled) s.restricted++;
      else s.unknown++;
      continue;
    }
    const limit = hasAnyLimit(r);
    if (limit) s.limits++;
    if (apps) s.appRules++;
    if (scheduled) s.schedules++;
    if (limit || apps || scheduled) s.restricted++;
  }
  return s;
}

/** Card value: the count, or undefined (shown as a dash) when nothing can be said. */
export function restrictionsValue(s: RestrictionsSummary): string | undefined {
  return s.enrolled === 0 || s.unknown === s.enrolled ? undefined : String(s.restricted);
}

const devices = (n: number): string => (n === 1 ? "device" : "devices");

export function restrictionsHint(s: RestrictionsSummary): string {
  if (s.enrolled === 0) return "Limits you set on an enrolled device appear here.";
  const known = s.enrolled - s.unknown;
  if (known === 0) return "The rules of your enrolled devices could not be read.";
  const parts = [`${s.restricted} of ${known} enrolled ${devices(known)} ${s.restricted === 1 ? "has" : "have"} a screen-time limit, schedule or app restriction set.`];
  if (s.unknown > 0) parts.push(`${s.unknown} could not be read.`);
  parts.push("These are settings; the child's app can show a notice, but it can't lock a phone.");
  return parts.join(" ");
}
