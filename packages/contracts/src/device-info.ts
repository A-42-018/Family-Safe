// Device-information contracts (Phase 13). Edge Functions mirror the request schema locally (they cannot import
// workspace packages) — keep `supabase/functions/_shared/device-info.ts` in sync.
import { z } from "zod";

/** The app uploads once a day (and once after enrollment / an app update). */
export const DEVICE_INFO_INTERVAL_SECONDS = 86400;
export const SDK_LEVEL_MIN = 1;
export const SDK_LEVEL_MAX = 99;
/** Sanity ceiling for storage values (16 TB in MB) — matches the `devices` CHECK constraints. */
export const STORAGE_MB_MAX = 16777216;
export const SECURITY_PATCH_MIN = "2010-01-01";

/** `YYYY-MM-DD` that is a real calendar date on or after `SECURITY_PATCH_MIN`. */
export function isSecurityPatchDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return false;
  return value >= SECURITY_PATCH_MIN;
}

/**
 * Device → POST /functions/v1/device-info (device JWT). Every key is required; `null` means "the OS did not tell us".
 * No device id (comes from the verified token), no serial/IMEI/advertising id, no addresses, no app names.
 */
export const deviceInfoRequestSchema = z
  .object({
    sdk_level: z.number().int().min(SDK_LEVEL_MIN).max(SDK_LEVEL_MAX),
    security_patch: z.string().refine(isSecurityPatchDate, "invalid date").nullable(),
    storage_total_mb: z.number().int().min(1).max(STORAGE_MB_MAX).nullable(),
    storage_free_mb: z.number().int().min(0).max(STORAGE_MB_MAX).nullable(),
    /** T4: `true` when FamilySafe is the Device Owner of the phone (managed mode, Track B). A self-report, never proof. */
    managed_mode: z.boolean(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.storage_total_mb === null) !== (v.storage_free_mb === null)) {
      ctx.addIssue({ code: "custom", message: "storage values must be given together", path: ["storage_free_mb"] });
    } else if (v.storage_total_mb !== null && v.storage_free_mb !== null && v.storage_free_mb > v.storage_total_mb) {
      ctx.addIssue({ code: "custom", message: "free storage exceeds total", path: ["storage_free_mb"] });
    }
  });

export const deviceInfoResponseSchema = z.object({
  server_time: z.string(),
  next_interval_seconds: z.number().int().positive(),
});

export type DeviceInfoRequest = z.infer<typeof deviceInfoRequestSchema>;
export type DeviceInfoResponse = z.infer<typeof deviceInfoResponseSchema>;
