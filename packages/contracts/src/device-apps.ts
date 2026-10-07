// App-inventory contracts (Phase 15a-2). Edge Functions mirror the request schema locally (they cannot import
// workspace packages) — keep `supabase/functions/_shared/device-apps.ts` in sync. SQL limits live in migration
// `20260930001400_device_apps.sql` (`device_sync_apps`); a drift test compares both.
import { z } from "zod";

/** The app re-sends the full launchable-app list at least this often (Android may also send after a change). */
export const DEVICE_APPS_INTERVAL_SECONDS = 86400;

/** Hard cap on entries per report (the SQL function rejects more; nothing is ever truncated silently). */
export const DEVICE_APPS_MAX = 500;
export const DEVICE_APPS_PACKAGE_MAX = 255;
export const DEVICE_APPS_LABEL_MAX = 200;
export const DEVICE_APPS_VERSION_MAX = 100;
/** Worst case is ~780 KB of JSON for 500 maximal entries; the generic 64 KB cap would reject ordinary phones. */
export const DEVICE_APPS_MAX_BODY_BYTES = 1048576;

/** Same package-name rule as `app_rules`, `app_usage_daily` and `device_apps`. */
export const PACKAGE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

const noControl = (s: string) => !CONTROL_CHARS.test(s);

/** Trimmed, then 1..max characters without control characters. */
const trimmedText = (max: number) =>
  z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1).max(max).refine(noControl, "control characters are not allowed"));

export const deviceAppSchema = z
  .object({
    package_name: z.string().max(DEVICE_APPS_PACKAGE_MAX).regex(PACKAGE_NAME_PATTERN),
    label: trimmedText(DEVICE_APPS_LABEL_MAX),
    /** `null` = unknown. A blank version must be sent as `null` (it is rejected, not guessed). */
    version_name: trimmedText(DEVICE_APPS_VERSION_MAX).nullable(),
    is_system: z.boolean(),
  })
  .strict();

/**
 * Device → POST /functions/v1/device-apps (device JWT). The complete list of launchable apps (full replace).
 * No device id (comes from the verified token), no extra keys, no duplicate package names, at most 500 entries.
 */
export const deviceAppsRequestSchema = z
  .object({
    apps: z
      .array(deviceAppSchema)
      .max(DEVICE_APPS_MAX)
      .superRefine((apps, ctx) => {
        const seen = new Set<string>();
        for (const [i, a] of apps.entries()) {
          if (seen.has(a.package_name)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, "package_name"], message: "duplicate package name" });
            return;
          }
          seen.add(a.package_name);
        }
      }),
  })
  .strict();

export const deviceAppsResponseSchema = z.object({
  server_time: z.string(),
  next_interval_seconds: z.number().int().positive(),
});

export type DeviceApp = z.infer<typeof deviceAppSchema>;
export type DeviceAppsRequest = z.infer<typeof deviceAppsRequestSchema>;
export type DeviceAppsResponse = z.infer<typeof deviceAppsResponseSchema>;
