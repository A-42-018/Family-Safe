// Blocked-app attempt events contract (Phase 18a). Mirrors packages/contracts `device-app-events.ts` (Edge Functions
// can't import workspace packages) — keep the constants, the time pattern/parser and the schema rules in sync.
import { z } from "zod";
import { PACKAGE_NAME_PATTERN } from "./device-apps.ts";

export const APP_EVENT_TYPES = ["BLOCKED_APP_ATTEMPT"] as const;
export type AppEventType = (typeof APP_EVENT_TYPES)[number];

export const DEVICE_APP_EVENTS_MAX = 20;
export const APP_EVENT_PAST_SECONDS = 86_400;
export const APP_EVENT_FUTURE_SECONDS = 300;
export const APP_EVENT_EDGE_MARGIN_SECONDS = 60;

export const APP_EVENT_TIME_PATTERN = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]{1,9})?Z$/;

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

export function isAppEventTimeInRange(value: string, nowMs: number): boolean {
  const t = parseAppEventTime(value);
  if (t === null) return false;
  const min = nowMs - (APP_EVENT_PAST_SECONDS - APP_EVENT_EDGE_MARGIN_SECONDS) * 1000;
  const max = nowMs + (APP_EVENT_FUTURE_SECONDS - APP_EVENT_EDGE_MARGIN_SECONDS) * 1000;
  return t >= min && t <= max;
}

export const AppEventSchema = z
  .object({
    type: z.enum(APP_EVENT_TYPES),
    package_name: z.string().max(255).regex(PACKAGE_NAME_PATTERN),
    occurred_at: z.string().max(40).refine((v) => parseAppEventTime(v) !== null, "invalid time"),
  })
  .strict();
export type AppEvent = z.infer<typeof AppEventSchema>;

export const DeviceAppEventsSchema = z
  .object({ events: z.array(AppEventSchema).min(1).max(DEVICE_APP_EVENTS_MAX) })
  .strict();
export type DeviceAppEvents = z.infer<typeof DeviceAppEventsSchema>;
