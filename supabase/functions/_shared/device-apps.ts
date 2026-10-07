// App-inventory contract (Phase 15a-2). Mirrors packages/contracts `device-apps.ts` (Edge Functions can't import
// workspace packages) — keep the constants, the package-name pattern and the schema rules in sync.
import { z } from "zod";

export const DEVICE_APPS_INTERVAL_SECONDS = 86400;
export const DEVICE_APPS_MAX = 500;
export const DEVICE_APPS_PACKAGE_MAX = 255;
export const DEVICE_APPS_LABEL_MAX = 200;
export const DEVICE_APPS_VERSION_MAX = 100;
export const DEVICE_APPS_MAX_BODY_BYTES = 1048576;

export const PACKAGE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

const noControl = (s: string) => !CONTROL_CHARS.test(s);

const trimmedText = (max: number) =>
  z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1).max(max).refine(noControl, "control characters are not allowed"));

export const DeviceAppSchema = z
  .object({
    package_name: z.string().max(DEVICE_APPS_PACKAGE_MAX).regex(PACKAGE_NAME_PATTERN),
    label: trimmedText(DEVICE_APPS_LABEL_MAX),
    version_name: trimmedText(DEVICE_APPS_VERSION_MAX).nullable(),
    is_system: z.boolean(),
  })
  .strict();

export const DeviceAppsSchema = z
  .object({
    apps: z
      .array(DeviceAppSchema)
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

export type DeviceApp = z.infer<typeof DeviceAppSchema>;
export type DeviceApps = z.infer<typeof DeviceAppsSchema>;
