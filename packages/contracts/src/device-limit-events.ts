// "Daily limit reached" event contract (Phase 29d). Edge Functions mirror this locally (they cannot import workspace
// packages) — keep `supabase/functions/_shared/device-limit-events.ts` in sync. SQL: migration
// `20261007000600_limit_reached_event.sql` (`device_record_limit_reached`); a drift test compares all three.
import { z } from "zod";
import { APP_EVENT_PAST_SECONDS, parseAppEventTime } from "./device-app-events";

/** The event type stored in `device_events.event_type`. */
export const LIMIT_EVENT_TYPE = "LIMIT_REACHED";
/** The device's local day may be one day away from the server's UTC day (time zones) — the SQL window. */
export const LIMIT_EVENT_DAY_TOLERANCE_DAYS = 1;

const DAY_PATTERN = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const DAY_MS = 86_400_000;

/** Epoch milliseconds of 00:00 UTC of a real calendar date (`YYYY-MM-DD`), else `null`. */
export function parseLimitEventDay(value: string): number | null {
  const m = DAY_PATTERN.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return t.getTime();
}

/** Within one day of the server's UTC date. */
export function isLimitEventDayInRange(value: string, nowMs: number): boolean {
  const t = parseLimitEventDay(value);
  if (t === null) return false;
  const today = Math.floor(nowMs / DAY_MS) * DAY_MS;
  return Math.abs(t - today) <= LIMIT_EVENT_DAY_TOLERANCE_DAYS * DAY_MS;
}

/** Device → POST /functions/v1/device-limit-events (device JWT). Both keys required; no usage numbers, no package, no device id. */
export const deviceLimitReachedRequestSchema = z
  .object({
    day: z.string().max(10).refine((v) => parseLimitEventDay(v) !== null, "invalid day"),
    occurred_at: z.string().max(40).refine((v) => parseAppEventTime(v) !== null, "invalid time"),
  })
  .strict();
export type DeviceLimitReachedRequest = z.infer<typeof deviceLimitReachedRequestSchema>;

/** Same past window as blocked-app events (24 h): a limit reached while offline may be reported late. */
export const LIMIT_EVENT_PAST_SECONDS = APP_EVENT_PAST_SECONDS;
