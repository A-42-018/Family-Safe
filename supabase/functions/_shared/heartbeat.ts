// Heartbeat contract (Phase 12). Mirrors packages/contracts `heartbeat.ts` (Edge Functions can't import workspace
// packages) — keep the field list, limits and constants in sync.
import { z } from "zod";

export const NETWORK_TYPES = ["WIFI", "CELLULAR", "ETHERNET", "VPN", "NONE", "UNKNOWN"] as const;
export const HEARTBEAT_INTERVAL_SECONDS = 900;
export const HEARTBEAT_STALE_SECONDS = 2700;

export const HeartbeatSchema = z.object({
  app_version: z.string().min(1).max(32),
  android_version: z.string().min(1).max(32),
  battery_level: z.number().int().min(0).max(100),
  is_charging: z.boolean(),
  network_type: z.enum(NETWORK_TYPES),
}).strict();

export type Heartbeat = z.infer<typeof HeartbeatSchema>;
