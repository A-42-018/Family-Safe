// Permission-state-sync contract (Phase 14). Mirrors packages/contracts `permissions.ts` (Edge Functions can't import
// workspace packages) — keep the key list, state list and constants in sync.
import { z } from "zod";

export const PERMISSION_SYNC_INTERVAL_SECONDS = 21600;

export const PERMISSION_KEYS = [
  "camera",
  "microphone",
  "contacts",
  "sms",
  "call_log",
  "location",
  "precise_location",
  "background_location",
] as const;

export const PERMISSION_STATES = [
  "GRANTED",
  "DENIED",
  "REVOKED",
  "RESTRICTED",
  "NOT_AVAILABLE",
  "NOT_REQUESTED",
] as const;

const stateSchema = z.enum(PERMISSION_STATES);

export const PermissionSyncSchema = z.object({
  camera: stateSchema,
  microphone: stateSchema,
  contacts: stateSchema,
  sms: stateSchema,
  call_log: stateSchema,
  location: stateSchema,
  precise_location: stateSchema,
  background_location: stateSchema,
}).strict();

export type PermissionSync = z.infer<typeof PermissionSyncSchema>;
