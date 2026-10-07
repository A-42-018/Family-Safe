// Usage-statistics contracts (Phase 16a). Edge Functions mirror the request schema locally (they cannot import
// workspace packages) — keep `supabase/functions/_shared/device-usage.ts` in sync. SQL limits live in migration
// `20260930001500_device_usage.sql` (`device_upload_usage`); a drift test compares both.
import { z } from "zod";
import { PACKAGE_NAME_PATTERN } from "./device-apps";

/** The app uploads today's numbers a few times a day (Android decides the exact schedule; 6 h is the contract hint). */
export const DEVICE_USAGE_INTERVAL_SECONDS = 21600;

/** Hard caps per report. A violation is a 400 / SQL 22023, nothing is truncated on the server. */
export const DEVICE_USAGE_MAX_APPS = 200;
export const DEVICE_USAGE_MAX_MINUTES = 1440; // one calendar day
export const DEVICE_USAGE_MAX_COUNT = 10000; // unlocks / launches per day
/** A day may be reported up to this many days late (device offline) and one day early (time-zone slack). */
export const DEVICE_USAGE_PAST_DAYS = 14;
export const DEVICE_USAGE_FUTURE_DAYS = 1;


const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` that is a real calendar date. */
export function isUsageDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** Mirrors the SQL rule `current_date - 14 <= day <= current_date + 1` (UTC date of `nowMs`). */
export function isUsageDayInRange(value: string, nowMs: number): boolean {
  if (!isUsageDate(value)) return false;
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const min = new Date(Date.parse(today) - DEVICE_USAGE_PAST_DAYS * DAY_MS).toISOString().slice(0, 10);
  const max = new Date(Date.parse(today) + DEVICE_USAGE_FUTURE_DAYS * DAY_MS).toISOString().slice(0, 10);
  return value >= min && value <= max;
}

const minutes = z.number().int().min(0).max(DEVICE_USAGE_MAX_MINUTES);
const count = z.number().int().min(0).max(DEVICE_USAGE_MAX_COUNT);

export const appUsageSchema = z
  .object({
    package_name: z.string().max(255).regex(PACKAGE_NAME_PATTERN),
    foreground_minutes: minutes,
    launch_count: count,
  })
  .strict();

/**
 * Device → POST /functions/v1/device-usage (device JWT). One calendar day for the device in the token.
 * Values are cumulative for the day; the server keeps the larger value per column and never deletes.
 * No device id, no extra keys, no duplicate package names, at most 200 apps, app minutes sum to at most one day.
 */
export const deviceUsageRequestSchema = z
  .object({
    day: z.string().refine(isUsageDate, "invalid date"),
    total_screen_minutes: minutes,
    unlock_count: count,
    apps: z
      .array(appUsageSchema)
      .max(DEVICE_USAGE_MAX_APPS)
      .superRefine((apps, ctx) => {
        const seen = new Set<string>();
        let sum = 0;
        for (const [i, a] of apps.entries()) {
          if (seen.has(a.package_name)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, "package_name"], message: "duplicate package name" });
            return;
          }
          seen.add(a.package_name);
          sum += a.foreground_minutes;
        }
        if (sum > DEVICE_USAGE_MAX_MINUTES) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "app minutes exceed one day" });
        }
      }),
  })
  .strict();

export const deviceUsageResponseSchema = z.object({
  server_time: z.string(),
  next_interval_seconds: z.number().int().positive(),
});

export type AppUsage = z.infer<typeof appUsageSchema>;
export type DeviceUsageRequest = z.infer<typeof deviceUsageRequestSchema>;
export type DeviceUsageResponse = z.infer<typeof deviceUsageResponseSchema>;
