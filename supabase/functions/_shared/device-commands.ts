// Command-sync contract (Phase 20). Mirrors packages/contracts `device-commands.ts` (Edge Functions can't import
// workspace packages) — keep the constants and the device-side schemas in sync.
import { z } from "zod";

export const COMMAND_TYPES = ["SYNC_CONFIG"] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

export const COMMAND_ACK_STATUSES = ["EXECUTED", "FAILED"] as const;
export const COMMAND_PULL_DEFAULT = 10;
export const COMMAND_PULL_MAX = 50;

export const PUSH_TOKEN_MIN = 20;
export const PUSH_TOKEN_MAX = 4096;
export const PUSH_TOKEN_PATTERN = /^[A-Za-z0-9:_.-]+$/;

export const FcmTokenSchema = z
  .object({ token: z.string().min(PUSH_TOKEN_MIN).max(PUSH_TOKEN_MAX).regex(PUSH_TOKEN_PATTERN) })
  .strict();
export type FcmToken = z.infer<typeof FcmTokenSchema>;

export const CommandAckSchema = z
  .object({ command_id: z.string().uuid(), status: z.enum(COMMAND_ACK_STATUSES) })
  .strict();
export type CommandAck = z.infer<typeof CommandAckSchema>;

/** One command as the device receives it: no payload, no device id. */
export interface DeviceCommandRow {
  id: string;
  type: CommandType;
  expires_at: string;
}
