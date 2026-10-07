// Permission-state-sync contracts (Phase 14). Edge Functions mirror the request schema locally (they cannot import
// workspace packages) — keep `supabase/functions/_shared/permissions.ts` in sync.
import { z } from "zod";

/** The app re-reads the OS grant state at least this often (and whenever the app resumes). */
export const PERMISSION_SYNC_INTERVAL_SECONDS = 21600;

/** The 8 catalog permissions, in a fixed order. Each maps to `device_permissions.<key>_status`. */
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
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

/** Mirrors the CHECK lists on `device_permissions.*_status`. */
export const PERMISSION_STATES = [
  "GRANTED",
  "DENIED",
  "REVOKED",
  "RESTRICTED",
  "NOT_AVAILABLE",
  "NOT_REQUESTED",
] as const;
export type PermissionState = (typeof PERMISSION_STATES)[number];

const stateSchema = z.enum(PERMISSION_STATES);

/**
 * Device → POST /functions/v1/device-permissions (device JWT). Every catalog key is required, no extra keys, no
 * device id (comes from the verified token). Values are the OS grant state as observed by the app.
 */
export const permissionSyncRequestSchema = z
  .object({
    camera: stateSchema,
    microphone: stateSchema,
    contacts: stateSchema,
    sms: stateSchema,
    call_log: stateSchema,
    location: stateSchema,
    precise_location: stateSchema,
    background_location: stateSchema,
  })
  .strict();

export const permissionSyncResponseSchema = z.object({
  server_time: z.string(),
  next_interval_seconds: z.number().int().positive(),
});

export type PermissionSyncRequest = z.infer<typeof permissionSyncRequestSchema>;
export type PermissionSyncResponse = z.infer<typeof permissionSyncResponseSchema>;
