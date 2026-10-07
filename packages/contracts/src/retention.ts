// Retention windows (prompt §45, Phase 32a). SQL: migration `20261007000700_retention_jobs.sql` (`retention_run`); a
// drift test compares the two. Parents can delete history earlier (Phase 32b); nothing is kept longer.

/** Days a row is kept, by table. `location_points` is the longest choice (7 / 30 / 90) until 22a adds per-device values. */
export const RETENTION_DAYS = {
  audit_logs: 180,
  notifications: 90,
  device_events: 90,
  app_usage_daily: 90,
  device_usage_daily: 90,
  location_points: 90,
  /** after creation (commands expire after 24 h) */
  device_commands: 30,
  /** after the refresh token expired */
  device_credentials: 30,
  /** after the pairing code expired */
  pairing_tokens: 7,
} as const;
export type RetentionTable = keyof typeof RETENTION_DAYS;

/** A device that has not checked in for this long is marked OFFLINE by `retention_run` (`device_mark_stale_offline`). */
export const OFFLINE_AFTER_SECONDS = 2700;
/** How often the job runs when pg_cron is enabled. */
export const RETENTION_SCHEDULE_MINUTES = 15;

/** The keys of the jsonb that `retention_run()` returns, in order. */
export const RETENTION_RESULT_KEYS = [
  "devices_marked_offline",
  "device_commands_expired",
  "audit_logs",
  "notifications",
  "device_events",
  "app_usage_daily",
  "device_usage_daily",
  "location_points",
  "device_commands",
  "device_credentials",
  "pairing_tokens",
] as const;
