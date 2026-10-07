// "Daily limit reached" event contract (Phase 29d). Mirrors packages/contracts `device-limit-events.ts` (Edge Functions
// can't import workspace packages) — keep the constants, the day parser and the schema in sync.
import { z } from "zod";
import { parseAppEventTime } from "./device-app-events.ts";

export const LIMIT_EVENT_TYPE = "LIMIT_REACHED";
export const LIMIT_EVENT_DAY_TOLERANCE_DAYS = 1;

const DAY_PATTERN = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const DAY_MS = 86_400_000;

export function parseLimitEventDay(value: string): number | null {
  const m = DAY_PATTERN.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return t.getTime();
}

export function isLimitEventDayInRange(value: string, nowMs: number): boolean {
  const t = parseLimitEventDay(value);
  if (t === null) return false;
  const today = Math.floor(nowMs / DAY_MS) * DAY_MS;
  return Math.abs(t - today) <= LIMIT_EVENT_DAY_TOLERANCE_DAYS * DAY_MS;
}

export const DeviceLimitReachedSchema = z
  .object({
    day: z.string().max(10).refine((v) => parseLimitEventDay(v) !== null, "invalid day"),
    occurred_at: z.string().max(40).refine((v) => parseAppEventTime(v) !== null, "invalid time"),
  })
  .strict();
export type DeviceLimitReached = z.infer<typeof DeviceLimitReachedSchema>;
