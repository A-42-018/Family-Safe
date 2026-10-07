// Pure display rules for the "Screen time" page (Phase 16c-1). No data access, no React.
// Numbers are the device's own report (`device_usage_daily`, `app_usage_daily`): read-only, informational.
import { DEVICE_USAGE_FUTURE_DAYS, DEVICE_USAGE_INTERVAL_SECONDS, DEVICE_USAGE_MAX_APPS, DEVICE_USAGE_MAX_COUNT, DEVICE_USAGE_MAX_MINUTES, isUsageDate } from "@familysafe/contracts";
import { secondsSince } from "@/lib/devices/status";

/** Columns read from the two usage tables (no ids, no created_at). */
export const DAY_USAGE_COLUMNS = "usage_date,total_screen_minutes,unlock_count";
export const APP_USAGE_COLUMNS = "package_name,foreground_minutes,launch_count";

/** Days shown in the chart (ending at the device's latest date) and apps shown in the list. */
export const USAGE_SERIES_DAYS = 7;
export const USAGE_TOP_APPS = 10;
/** Upper bound of rows the day query can return (series window + the contract's one-day-ahead slack). */
export const USAGE_DAY_ROW_LIMIT = USAGE_SERIES_DAYS + DEVICE_USAGE_FUTURE_DAYS + 1;
/** Rows of `app_usage_daily` read for the selected day (the contract's per-report cap). */
export const USAGE_APP_ROW_LIMIT = DEVICE_USAGE_MAX_APPS;

/** A report counts as out of date after three missed 6-hour uploads. */
export const USAGE_STALE_SECONDS = DEVICE_USAGE_INTERVAL_SECONDS * 3;
export const USAGE_STALE_HOURS = Math.round(USAGE_STALE_SECONDS / 3600);

export interface DayUsageRow {
  day: string; // YYYY-MM-DD, the child's local date as reported by the device
  screenMinutes: number;
  unlocks: number;
}
export interface AppUsageRow {
  packageName: string;
  minutes: number;
  launches: number;
}
export interface UsageInput {
  /** `devices.usage_synced_at`: null until the device has reported at least once. */
  syncedAt: string | null;
  /** Reported days inside the window (unordered is fine). */
  days: DayUsageRow[];
  /** The day whose app list is in `apps`. */
  selectedDay: string;
  apps: AppUsageRow[];
  /** package → label from the reported app list (may be partial). */
  labels: ReadonlyMap<string, string>;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
const DAY_MS = 86_400_000;
const isCount = (v: unknown, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;

/** Accepts a raw `device_usage_daily` row; anything unusable → null (skipped, never invented). */
export function asDayRow(raw: unknown): DayUsageRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.usage_date !== "string" || !isUsageDate(r.usage_date)) return null;
  if (!isCount(r.total_screen_minutes, DEVICE_USAGE_MAX_MINUTES) || !isCount(r.unlock_count, DEVICE_USAGE_MAX_COUNT)) return null;
  return { day: r.usage_date, screenMinutes: r.total_screen_minutes, unlocks: r.unlock_count };
}

/** Accepts a raw `app_usage_daily` row; anything unusable → null. */
export function asAppUsageRow(raw: unknown): AppUsageRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.package_name !== "string" || r.package_name.length === 0) return null;
  if (!isCount(r.foreground_minutes, DEVICE_USAGE_MAX_MINUTES) || !isCount(r.launch_count, DEVICE_USAGE_MAX_COUNT)) return null;
  return { packageName: r.package_name, minutes: r.foreground_minutes, launches: r.launch_count };
}

/** UTC calendar date of `now` (the server has no better notion of the child's local date). */
export const utcDate = (now: Date): string => now.toISOString().slice(0, 10);

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive date range the page queries: the series window plus the contract's one-day-ahead slack. */
export function usageQueryRange(now: Date): { from: string; to: string } {
  const today = utcDate(now);
  return { from: addDays(today, -USAGE_SERIES_DAYS), to: addDays(today, DEVICE_USAGE_FUTURE_DAYS) };
}

export interface SeriesDay {
  day: string;
  /** null = the device sent nothing for this day (different from 0 minutes). */
  screenMinutes: number | null;
  unlocks: number | null;
}

/**
 * Seven consecutive days, oldest first. The last day is the device's latest reported date when that is today or one
 * day ahead (a child east of UTC), otherwise today (UTC). Days with no report stay `null`.
 */
export function buildSeries(rows: readonly DayUsageRow[], now: Date): SeriesDay[] {
  const today = utcDate(now);
  const limit = addDays(today, DEVICE_USAGE_FUTURE_DAYS);
  const byDay = new Map<string, DayUsageRow>();
  for (const r of rows) if (r.day <= limit && !byDay.has(r.day)) byDay.set(r.day, r);
  let end = today;
  for (const d of byDay.keys()) if (d > end) end = d;
  const out: SeriesDay[] = [];
  for (let i = USAGE_SERIES_DAYS - 1; i >= 0; i--) {
    const day = addDays(end, -i);
    const r = byDay.get(day);
    out.push({ day, screenMinutes: r ? r.screenMinutes : null, unlocks: r ? r.unlocks : null });
  }
  return out;
}

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** `?day=YYYY-MM-DD` → the date, or null when missing/invalid. */
export function parseUsageDay(p: Params): string | null {
  const d = first(p.day);
  return typeof d === "string" && isUsageDate(d) ? d : null;
}

/** The requested day when it is inside the series, else the latest day of the series. */
export function selectDay(series: readonly SeriesDay[], requested: string | null): string {
  const last = series[series.length - 1]!.day;
  return requested !== null && series.some((d) => d.day === requested) ? requested : last;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Mon 28 Sep" (fixed English names, UTC calendar arithmetic: no locale or time-zone surprises). */
export function shortDayText(day: string): string {
  const t = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAYS[t.getUTCDay()]} ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`;
}

/** "Today" / "Yesterday" relative to the series' last day, else "Mon 28 Sep". */
export function dayLabel(day: string, lastDay: string): string {
  if (day === lastDay) return "Today";
  if (day === addDays(lastDay, -1)) return "Yesterday";
  return shortDayText(day);
}

/** 0 → "0 min", 45 → "45 min", 60 → "1 h", 65 → "1 h 05 min"; null/invalid → "No data". */
export function minutesText(m: number | null): string {
  if (m === null || !Number.isInteger(m) || m < 0) return "No data";
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (h === 0) return `${min} min`;
  return min === 0 ? `${h} h` : `${h} h ${String(min).padStart(2, "0")} min`;
}

/** Bar height in percent. The scale is at least one hour so a few minutes never fill the chart. */
export function chartScaleMax(series: readonly SeriesDay[]): number {
  return Math.max(60, ...series.map((d) => d.screenMinutes ?? 0));
}
export function barPercent(minutes: number | null, scaleMax: number): number {
  if (minutes === null || minutes <= 0 || scaleMax <= 0) return 0;
  return Math.min(100, Math.max(3, Math.round((minutes / scaleMax) * 100)));
}

export interface WeekSummary {
  reportedDays: number;
  totalMinutes: number;
  averageMinutes: number | null;
}
export function weekSummary(series: readonly SeriesDay[]): WeekSummary {
  const reported = series.filter((d): d is SeriesDay & { screenMinutes: number } => d.screenMinutes !== null);
  const total = reported.reduce((s, d) => s + d.screenMinutes, 0);
  return { reportedDays: reported.length, totalMinutes: total, averageMinutes: reported.length === 0 ? null : Math.round(total / reported.length) };
}
export function summaryText(s: WeekSummary): string {
  if (s.averageMinutes === null) return "No days reported in the last 7 days";
  const noun = s.reportedDays === 1 ? "day" : "days";
  return `Average ${minutesText(s.averageMinutes)} a day over ${s.reportedDays} reported ${noun}`;
}

/** Accessible name of one chart entry. */
export function dayAriaLabel(d: SeriesDay, lastDay: string): string {
  const name = dayLabel(d.day, lastDay);
  const when = name === "Today" || name === "Yesterday" ? `${name}, ${shortDayText(d.day)}` : name;
  return d.screenMinutes === null ? `${when}: no data reported` : `${when}: ${minutesText(d.screenMinutes)} screen time`;
}

export interface TopApp {
  packageName: string;
  name: string;
  minutes: number;
  launches: number;
  /** Share of the day's screen time in percent (0–100), null when the day total is unknown or zero. */
  sharePercent: number | null;
}
export interface TopApps {
  rows: TopApp[];
  /** Apps with usage that did not fit into the list. */
  omitted: number;
}

const cleanLabel = (s: string): string => s.replace(CONTROL_CHARS, " ").trim();

/** Most-used apps of the selected day: minutes, then launches, then package name; apps without usage are skipped. */
export function topApps(apps: readonly AppUsageRow[], labels: ReadonlyMap<string, string>, dayMinutes: number | null, limit: number = USAGE_TOP_APPS): TopApps {
  const used = apps.filter((a) => a.minutes > 0 || a.launches > 0);
  used.sort((a, b) => b.minutes - a.minutes || b.launches - a.launches || a.packageName.localeCompare(b.packageName, "en"));
  const rows = used.slice(0, limit).map((a): TopApp => {
    const label = cleanLabel(labels.get(a.packageName) ?? "");
    return {
      packageName: a.packageName,
      name: label.length > 0 ? label : a.packageName,
      minutes: a.minutes,
      launches: a.launches,
      sharePercent: dayMinutes !== null && dayMinutes > 0 ? Math.min(100, Math.round((a.minutes / dayMinutes) * 100)) : null,
    };
  });
  return { rows, omitted: used.length - rows.length };
}

export const launchesText = (n: number): string => (n === 1 ? "1 launch" : `${n} launches`);
export const unlocksText = (n: number | null): string => (n === null ? "No data" : n === 1 ? "1 unlock" : `${n} unlocks`);

/** True once the device has reported usage at least once (a valid `usage_synced_at`). */
export function hasReportedUsage(p: Pick<UsageInput, "syncedAt">): boolean {
  return p.syncedAt !== null && !Number.isNaN(Date.parse(p.syncedAt));
}

/** "Not reported yet" | "Updated 3 hours ago" (relative text shared with "last seen"). */
export function usageUpdatedText(p: Pick<UsageInput, "syncedAt">, now: Date, relative: (iso: string | null, now: Date) => string): string {
  return hasReportedUsage(p) ? `Updated ${relative(p.syncedAt, now).toLowerCase()}` : "Not reported yet";
}

/** The numbers may lag when the last report is older than three upload intervals. */
export function isUsageStale(p: Pick<UsageInput, "syncedAt">, now: Date): boolean {
  const age = secondsSince(p.syncedAt, now);
  return age !== null && age > USAGE_STALE_SECONDS;
}

/** Shown under the chart: what the numbers are and are not. */
export const USAGE_DAY_NOTE = "Days follow the date on the child's device, so \"Today\" can differ slightly from your own date.";
export const USAGE_SCOPE_NOTE =
  "This is what the device reported: screen-on time, unlocks, and time and launches per app. It can be out of date or too low (for example if Usage Access was switched off). Message or browsing content is never shared. Nothing is changed on the device from this page.";
