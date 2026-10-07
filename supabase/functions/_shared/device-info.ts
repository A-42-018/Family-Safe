// Device-information contract (Phase 13). Mirrors packages/contracts `device-info.ts` (Edge Functions can't import
// workspace packages) — keep the field list, limits and constants in sync.
import { z } from "zod";

export const DEVICE_INFO_INTERVAL_SECONDS = 86400;
export const SDK_LEVEL_MIN = 1;
export const SDK_LEVEL_MAX = 99;
export const STORAGE_MB_MAX = 16777216;
export const SECURITY_PATCH_MIN = "2010-01-01";

export function isSecurityPatchDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return false;
  return value >= SECURITY_PATCH_MIN;
}

export const DeviceInfoSchema = z.object({
  sdk_level: z.number().int().min(SDK_LEVEL_MIN).max(SDK_LEVEL_MAX),
  security_patch: z.string().refine(isSecurityPatchDate, "invalid date").nullable(),
  storage_total_mb: z.number().int().min(1).max(STORAGE_MB_MAX).nullable(),
  storage_free_mb: z.number().int().min(0).max(STORAGE_MB_MAX).nullable(),
}).strict().superRefine((v, ctx) => {
  if ((v.storage_total_mb === null) !== (v.storage_free_mb === null)) {
    ctx.addIssue({ code: "custom", message: "storage values must be given together", path: ["storage_free_mb"] });
  } else if (v.storage_total_mb !== null && v.storage_free_mb !== null && v.storage_free_mb > v.storage_total_mb) {
    ctx.addIssue({ code: "custom", message: "free storage exceeds total", path: ["storage_free_mb"] });
  }
});

export type DeviceInfo = z.infer<typeof DeviceInfoSchema>;
