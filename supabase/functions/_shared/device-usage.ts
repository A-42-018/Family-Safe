// Usage-statistics contract (Phase 16a). Mirrors packages/contracts `device-usage.ts` (Edge Functions can't import
// workspace packages) — keep the constants, the package-name pattern and the schema rules in sync.
import { z } from "zod";

export const DEVICE_USAGE_INTERVAL_SECONDS = 21600;
export const DEVICE_USAGE_MAX_APPS = 200;
export const DEVICE_USAGE_MAX_MINUTES = 1440;
export const DEVICE_USAGE_MAX_COUNT = 10000;
export const DEVICE_USAGE_PAST_DAYS = 14;
export const DEVICE_USAGE_FUTURE_DAYS = 1;

export const PACKAGE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

const DAY_MS = 86_400_000;

export function isUsageDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

export function isUsageDayInRange(value: string, nowMs: number): boolean {
  if (!isUsageDate(value)) return false;
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const min = new Date(Date.parse(today) - DEVICE_USAGE_PAST_DAYS * DAY_MS).toISOString().slice(0, 10);
  const max = new Date(Date.parse(today) + DEVICE_USAGE_FUTURE_DAYS * DAY_MS).toISOString().slice(0, 10);
  return value >= min && value <= max;
}

const minutes = z.number().int().min(0).max(DEVICE_USAGE_MAX_MINUTES);
const count = z.number().int().min(0).max(DEVICE_USAGE_MAX_COUNT);

export const AppUsageSchema = z
  .object({
    package_name: z.string().max(255).regex(PACKAGE_NAME_PATTERN),
    foreground_minutes: minutes,
    launch_count: count,
  })
  .strict();

export const DeviceUsageSchema = z
  .object({
    day: z.string().refine(isUsageDate, "invalid date"),
    total_screen_minutes: minutes,
    unlock_count: count,
    apps: z
      .array(AppUsageSchema)
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

export type AppUsage = z.infer<typeof AppUsageSchema>;
export type DeviceUsage = z.infer<typeof DeviceUsageSchema>;
