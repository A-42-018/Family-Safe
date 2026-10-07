// Blocked-app attempt events (Phase 18a). Edge Functions mirror this locally (they cannot import workspace packages) —
// keep `supabase/functions/_shared/device-app-events.ts` in sync. SQL limits live in migration
// `20260930001700_app_rules.sql` (`device_record_app_attempts`); a drift test compares all three.
import { z } from "zod";
import { PACKAGE_NAME_PATTERN } from "./device-apps";

/** Event types the device may report on this endpoint (stored in `device_events.event_type`). */
export const APP_EVENT_TYPES = ["BLOCKED_APP_ATTEMPT"] as const;
export type AppEventType = (typeof APP_EVENT_TYPES)[number];

/** 1..20 events per upload. A violation is a 400 / SQL 22023, nothing is truncated on the server. */
export const DEVICE_APP_EVENTS_MAX = 20;
/** An event may be reported up to 24 h late (device offline) and 5 minutes ahead (clock skew) — the SQL window. */
export const APP_EVENT_PAST_SECONDS = 86_400;
export const APP_EVENT_FUTURE_SECONDS = 300;
/**
 * The Edge accepts a window narrower by this margin on both sides, so jitter between the Edge clock and the database
 * clock can never turn an accepted request into a database error (Android clamps to the same narrower window).
 */
export const APP_EVENT_EDGE_MARGIN_SECONDS = 60;

/** UTC `YYYY-MM-DDTHH:MM:SS[.f{1,9}]Z` only — no offsets. Same pattern as the SQL function. */
export const APP_EVENT_TIME_PATTERN = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]{1,9})?Z$/;

/** Epoch milliseconds of a valid event time (real calendar date, fraction truncated to ms), else `null`. */
export function parseAppEventTime(value: string): number | null {
  const m = APP_EVENT_TIME_PATTERN.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = Number(m[6]);
  if (h > 23 || mi > 59 || s > 59) return null;
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  const ms = m[7] ? Number(`${m[7].slice(1)}00`.slice(0, 3)) : 0;
  return t.getTime() + ms;
}

/** Inside the (narrowed) window around `nowMs`. */
export function isAppEventTimeInRange(value: string, nowMs: number): boolean {
  const t = parseAppEventTime(value);
  if (t === null) return false;
  const min = nowMs - (APP_EVENT_PAST_SECONDS - APP_EVENT_EDGE_MARGIN_SECONDS) * 1000;
  const max = nowMs + (APP_EVENT_FUTURE_SECONDS - APP_EVENT_EDGE_MARGIN_SECONDS) * 1000;
  return t >= min && t <= max;
}

export const appEventSchema = z
  .object({
    type: z.enum(APP_EVENT_TYPES),
    package_name: z.string().max(255).regex(PACKAGE_NAME_PATTERN),
    occurred_at: z.string().max(40).refine((v) => parseAppEventTime(v) !== null, "invalid time"),
  })
  .strict();
export type AppEvent = z.infer<typeof appEventSchema>;

/**
 * Device → POST /functions/v1/device-app-events (device JWT). No device id (comes from the verified token), no app
 * labels, no foreground details: just which restricted package was opened and when.
 */
export const deviceAppEventsRequestSchema = z
  .object({ events: z.array(appEventSchema).min(1).max(DEVICE_APP_EVENTS_MAX) })
  .strict();
export type DeviceAppEventsRequest = z.infer<typeof deviceAppEventsRequestSchema>;

/** The answer never says what was stored or ignored. */
export const deviceAppEventsResponseSchema = z.object({ server_time: z.string().datetime() }).strict();
export type DeviceAppEventsResponse = z.infer<typeof deviceAppEventsResponseSchema>;
