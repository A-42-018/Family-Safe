// Pure rules for the dashboard "Today's screen time" card (Phase 16c-2). No data access, no React.
// Numbers are each device's own report (`device_usage_daily`): informational, never proof.
import { DEVICE_USAGE_FUTURE_DAYS, isUsageDate } from "@familysafe/contracts";
import { addDays, asDayRow, DAY_USAGE_COLUMNS, isUsageStale, minutesText, utcDate, type DayUsageRow } from "@/lib/devices/usage";

/** Columns read for the card: the same two tables/columns as the usage page, plus the device id to group by. */
export const TODAY_USAGE_COLUMNS = `device_id,${DAY_USAGE_COLUMNS}`;
/** Most rows one device can contribute: yesterday (child west of UTC), today, plus the contract's one-day-ahead slack. */
export const TODAY_ROWS_PER_DEVICE = 2 + DEVICE_USAGE_FUTURE_DAYS;

export interface TodayDevice {
  id: string;
  enrollmentStatus: "PENDING" | "ENROLLED" | "REVOKED";
}
export interface TodayUsageRow extends DayUsageRow {
  deviceId: string;
}
export interface TodayInput {
  devices: readonly TodayDevice[];
  rows: readonly TodayUsageRow[];
  /** `devices.usage_synced_at` per device id (null / missing = never reported). */
  syncedAt: ReadonlyMap<string, string | null>;
}

/** Inclusive date range queried: UTC yesterday … UTC today + the contract's slack. */
export function todayQueryRange(now: Date): { from: string; to: string } {
  const today = utcDate(now);
  return { from: addDays(today, -1), to: addDays(today, DEVICE_USAGE_FUTURE_DAYS) };
}

/** Accepts a raw row with `device_id`; anything unusable → null (skipped, never invented). */
export function asTodayRow(raw: unknown): TodayUsageRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const day = asDayRow(raw);
  const id = (raw as Record<string, unknown>).device_id;
  return day !== null && typeof id === "string" && id.length > 0 ? { ...day, deviceId: id } : null;
}

export interface TodaySummary {
  /** Enrolled devices (revoked and pending are left out). */
  active: number;
  /** Active devices that have a report for their current day. */
  reporting: number;
  /** Active devices that never reported usage. */
  waiting: number;
  /** Active devices whose last usage report is older than three upload intervals. */
  stale: number;
  /** Sum over reporting devices; null when no device has reported today. */
  totalMinutes: number | null;
}

/**
 * Each device's "today" is the later of the UTC date and its latest reported date (up to one day ahead, a child east of
 * UTC) — the same rule as the 7-day chart. A device with no row for that day is "no data", never 0 minutes. Revoked and
 * pending devices are not counted.
 */
export function summarizeToday(input: TodayInput, now: Date): TodaySummary {
  const today = utcDate(now);
  const limit = addDays(today, DEVICE_USAGE_FUTURE_DAYS);
  const byDevice = new Map<string, Map<string, number>>();
  for (const r of input.rows) {
    if (!isUsageDate(r.day) || r.day > limit) continue;
    const days = byDevice.get(r.deviceId) ?? new Map<string, number>();
    if (!days.has(r.day)) days.set(r.day, r.screenMinutes);
    byDevice.set(r.deviceId, days);
  }
  const s: TodaySummary = { active: 0, reporting: 0, waiting: 0, stale: 0, totalMinutes: null };
  for (const d of input.devices) {
    if (d.enrollmentStatus !== "ENROLLED") continue;
    s.active += 1;
    const synced = input.syncedAt.get(d.id) ?? null;
    if (synced === null || Number.isNaN(Date.parse(synced))) {
      s.waiting += 1;
      continue;
    }
    if (isUsageStale({ syncedAt: synced }, now)) s.stale += 1;
    const days = byDevice.get(d.id);
    let current = today;
    if (days) for (const day of days.keys()) if (day > current) current = day;
    const minutes = days?.get(current);
    if (minutes === undefined) continue;
    s.reporting += 1;
    s.totalMinutes = (s.totalMinutes ?? 0) + minutes;
  }
  return s;
}

/** Card value: "2 h 05 min" once at least one device reported today, else undefined (the card shows a dash). */
export const todayValue = (s: TodaySummary): string | undefined => (s.totalMinutes === null ? undefined : minutesText(s.totalMinutes));

/** Card hint: who is included, plus the honest caveats (device dates, too-low numbers, stale reports). */
export function todayHint(s: TodaySummary): string {
  if (s.active === 0) return "Shown once a device is enrolled and reports screen time.";
  if (s.reporting === 0) {
    return s.waiting === s.active ? "No device has reported screen time yet." : "No device has reported for today yet.";
  }
  const parts = [`${s.reporting} of ${s.active} ${s.active === 1 ? "device" : "devices"} reported today.`];
  if (s.waiting > 0) parts.push(`${s.waiting} waiting for a first report.`);
  if (s.stale > 0) parts.push("Some reports may be out of date.");
  parts.push("Each device's own date, so it can differ slightly from yours.");
  return parts.join(" ");
}
