// Device-config contract (Phase 17a). Mirrors packages/contracts `device-config.ts` (Edge Functions can't import
// workspace packages) — keep the constants and the ETag helpers in sync (a contracts drift test compares them).
export const DEVICE_CONFIG_INTERVAL_SECONDS = 21600;
/** Phase 18a: at most this many app rules per device (SQL cap trigger + `device_get_config` limit). */
export const APP_RULES_MAX = 200;
/** Phase 19a: at most this many schedules per device (SQL guard trigger + `device_get_config` limit). */
export const SCHEDULES_MAX = 20;

/** One effective app restriction exactly as `device_get_config` returns it (no label, rows that restrict nothing are absent). */
export interface AppRuleRow {
  package_name: string;
  blocked: boolean;
  daily_limit_minutes: number | null;
}

/** One ENABLED schedule window exactly as `device_get_config` returns it (days ascending, `HH:MM`, `end < start` = overnight). */
export interface ScheduleRow {
  id: string;
  name: string;
  type: "BEDTIME" | "SCHOOL" | "CUSTOM";
  days: number[];
  start_time: string;
  end_time: string;
}

/** One row of `device_get_config`, already mapped to the wire shape (minus server_time/next_interval_seconds). */
export interface DeviceConfigRow {
  config_version: number;
  daily_limit_minutes: number | null;
  daily_limit_overrides: Record<string, number>;
  app_rules: AppRuleRow[];
  /** IANA name, or null = the device's own time zone. */
  timezone: string | null;
  schedules: ScheduleRow[];
}

export function etagForConfigVersion(version: number): string {
  return `"v${version}"`;
}

/** Version from an `If-None-Match` header (`"v3"` or `W/"v3"`); anything else (lists, `*`, junk) -> null = send the body. */
export function parseConfigEtag(header: string | null): number | null {
  if (header === null) return null;
  const m = /^(?:W\/)?"v([1-9][0-9]{0,8})"$/.exec(header.trim());
  return m ? Number(m[1]) : null;
}
