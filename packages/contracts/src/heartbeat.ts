// Heartbeat contracts (Phase 12). Edge Functions mirror the request schema locally (they cannot import workspace
// packages) — keep `supabase/functions/_shared/heartbeat.ts` in sync.
import { z } from "zod";

export const NETWORK_TYPES = ["WIFI", "CELLULAR", "ETHERNET", "VPN", "NONE", "UNKNOWN"] as const;
export type NetworkType = (typeof NETWORK_TYPES)[number];

/** WorkManager period on the device. */
export const HEARTBEAT_INTERVAL_SECONDS = 900;
/** A device silent for 3 missed beats is shown (and swept) as offline. */
export const HEARTBEAT_STALE_SECONDS = 2700;

/**
 * Device → POST /functions/v1/device-heartbeat (device JWT). Deliberately minimal: no device id (comes from the
 * verified token), no location, no app names, no identifiers. Permission state joins in Phase 14.
 */
export const heartbeatRequestSchema = z
  .object({
    app_version: z.string().min(1).max(32),
    android_version: z.string().min(1).max(32),
    battery_level: z.number().int().min(0).max(100),
    is_charging: z.boolean(),
    network_type: z.enum(NETWORK_TYPES),
  })
  .strict();

export const heartbeatResponseSchema = z.object({
  server_time: z.string(),
  next_interval_seconds: z.number().int().positive(),
});

export type HeartbeatRequest = z.infer<typeof heartbeatRequestSchema>;
export type HeartbeatResponse = z.infer<typeof heartbeatResponseSchema>;
