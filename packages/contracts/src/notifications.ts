// Parent-notification contracts (Phase 29). SQL: migration `20261007000400_notifications.sql` (a drift test compares them).
import { z } from "zod";

/** Mirrors the CHECK lists on `notifications.type` / `notification_preferences.type` (prompt §49). */
export const NOTIFICATION_TYPES = [
  "DEVICE_OFFLINE",
  "BATTERY_LOW",
  "EMERGENCY",
  "GEOFENCE_ENTER",
  "GEOFENCE_EXIT",
  "PERMISSION_REVOKED",
  "LIMIT_REACHED",
  "BLOCKED_APP_ATTEMPT",
  "DEVICE_ENROLLED",
  "SECURITY_EVENT",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** `notifications.metadata` is at most this many bytes of JSON text (CHECK). */
export const NOTIFICATION_METADATA_MAX_BYTES = 2048;
/** `parent_mark_notifications_read` accepts at most this many ids. */
export const NOTIFICATION_MARK_READ_MAX_IDS = 200;
/** Notifications are deleted after this many days (`notifications_purge_expired`). */
export const NOTIFICATION_RETENTION_DAYS = 90;
/** At most this many notifications per parent are kept; older ones go when a new one arrives (29a-2). */
export const NOTIFICATIONS_PER_PARENT_MAX = 500;

export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);

/** Parent input for `parent_set_notification_preference`. */
export const notificationPreferenceInputSchema = z.object({ type: notificationTypeSchema, enabled: z.boolean() }).strict();
export type NotificationPreferenceInput = z.infer<typeof notificationPreferenceInputSchema>;

/** Parent input for `parent_mark_notifications_read`: `null` ids = every unread notification. */
export const markReadInputSchema = z
  .object({ ids: z.array(z.string().uuid()).min(1).max(NOTIFICATION_MARK_READ_MAX_IDS).nullable() })
  .strict();
export type MarkReadInput = z.infer<typeof markReadInputSchema>;

export const PREFERENCE_OUTCOMES = ["updated", "unchanged"] as const;
export type PreferenceOutcome = (typeof PREFERENCE_OUTCOMES)[number];
