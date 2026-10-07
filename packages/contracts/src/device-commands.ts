// Command-sync contracts (Phase 20). Edge Functions mirror the device-side schemas locally (they cannot import workspace
// packages) — keep `supabase/functions/_shared/device-commands.ts` in sync. SQL: migration `20261007000800_command_sync.sql`
// (a drift test compares the two). FCM is a wake-up only: the phone never trusts a push, it pulls its commands.
import { z } from "zod";

/** Command types a parent may send and a device will execute. Everything else is ignored by the pull. */
export const COMMAND_TYPES = ["SYNC_CONFIG"] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];
export const commandTypeSchema = z.enum(COMMAND_TYPES);

/** A device acknowledges with one of these (`DELIVERED`/`EXPIRED` are set by the backend). */
export const COMMAND_ACK_STATUSES = ["EXECUTED", "FAILED"] as const;
export const COMMAND_PULL_DEFAULT = 10;
export const COMMAND_PULL_MAX = 50;
/** A command expires 24 h after it was created. */
export const COMMAND_TTL_HOURS = 24;
/** A parent can send at most this many commands per device per hour. */
export const COMMAND_SEND_PER_HOUR = 6;

export const PUSH_TOKEN_MIN = 20;
export const PUSH_TOKEN_MAX = 4096;
/** Same characters as SQL `device_register_push_token`: FCM tokens are URL-safe with `:`. */
export const PUSH_TOKEN_PATTERN = /^[A-Za-z0-9:_.-]+$/;

/** Device → POST /functions/v1/device-fcm-token. */
export const fcmTokenRequestSchema = z
  .object({ token: z.string().min(PUSH_TOKEN_MIN).max(PUSH_TOKEN_MAX).regex(PUSH_TOKEN_PATTERN) })
  .strict();
export type FcmTokenRequest = z.infer<typeof fcmTokenRequestSchema>;

/** Device → POST /functions/v1/device-commands (acknowledge). */
export const commandAckRequestSchema = z
  .object({ command_id: z.string().uuid(), status: z.enum(COMMAND_ACK_STATUSES) })
  .strict();
export type CommandAckRequest = z.infer<typeof commandAckRequestSchema>;

/** One command as the device receives it: no payload (SYNC_CONFIG carries none), no device id. */
export const deviceCommandSchema = z
  .object({ id: z.string().uuid(), type: commandTypeSchema, expires_at: z.string().datetime({ offset: true }) })
  .strict();
export type DeviceCommand = z.infer<typeof deviceCommandSchema>;

/** `data` of a 200 response from `GET /functions/v1/device-commands`. */
export const deviceCommandsResponseSchema = z
  .object({ commands: z.array(deviceCommandSchema).max(COMMAND_PULL_MAX), server_time: z.string().datetime() })
  .strict();
export type DeviceCommandsResponse = z.infer<typeof deviceCommandsResponseSchema>;

/** The only thing sent through FCM: a wake-up with the command id (never data, never a trusted instruction). */
export const FCM_WAKEUP_TYPE = "SYNC";
export const fcmWakeupDataSchema = z.object({ type: z.literal(FCM_WAKEUP_TYPE), cmd_id: z.string().uuid() }).strict();
export type FcmWakeupData = z.infer<typeof fcmWakeupDataSchema>;

export const PUSH_TOKEN_OUTCOMES = ["registered", "unchanged", "inactive"] as const;
export const COMMAND_ACK_OUTCOMES = ["acked", "unchanged", "expired", "not_found", "inactive"] as const;
/** Parent RPC `parent_send_command` (mapped generically by the web layer; never echo ids). */
export const SEND_COMMAND_OUTCOMES = ["sent", "already_pending", "throttled", "not_found", "inactive"] as const;
export type SendCommandOutcome = (typeof SEND_COMMAND_OUTCOMES)[number];

/** Parent input for `parent_send_command`. */
export const sendCommandInputSchema = z.object({ device_id: z.string().uuid(), type: commandTypeSchema }).strict();
export type SendCommandInput = z.infer<typeof sendCommandInputSchema>;
