// POST /functions/v1/device-heartbeat — the enrolled app reports coarse status every ~15 min.
// Authenticated ONLY through `requireActiveDevice` (device JWT + live credential check on every request). The device
// id comes from the verified token; the body can never name a device. A device revoked between the guard and the write
// gets the same 401 as any other failed authentication.
import { requireActiveDevice } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight, parseAllowedOrigins } from "../_shared/cors.ts";
import { ApiError, ok, toErrorResponse } from "../_shared/errors.ts";
import { type Heartbeat, HEARTBEAT_INTERVAL_SECONDS, HeartbeatSchema } from "../_shared/heartbeat.ts";
import { clientIp, enforceRateLimit, RULES } from "../_shared/ratelimit.ts";
import { parseJsonBody } from "../_shared/validate.ts";

export type HeartbeatOutcome = { outcome: "recorded" | "inactive" };

export interface Deps {
  allowedOrigins?: string;
  deviceJwtSecret: string;
  /** `device_authorize` — live credential check, uncached. */
  isActive: (deviceId: string, credentialId: string) => Promise<boolean>;
  /** Calls `device_heartbeat` (one transaction: update device row, write transition events). */
  record: (deviceId: string, beat: Heartbeat) => Promise<HeartbeatOutcome>;
  now?: () => number; // ms, injectable for tests
}

const UNAUTHORIZED = "Invalid or expired token";

export async function handler(req: Request, deps: Deps): Promise<Response> {
  const allowed = parseAllowedOrigins(deps.allowedOrigins ?? "http://localhost:3000");
  const pre = handlePreflight(req, allowed);
  if (pre) return pre;
  const cors = corsHeaders(req, allowed);
  try {
    if (req.method !== "POST") throw new ApiError("validation_error", "Method not allowed");
    enforceRateLimit(RULES.heartbeatIp, clientIp(req)); // before any crypto or database work
    const device = await requireActiveDevice(req, { secret: deps.deviceJwtSecret, isActive: deps.isActive, now: deps.now ? Math.floor(deps.now() / 1000) : undefined });
    enforceRateLimit(RULES.heartbeat, device.deviceId);
    const beat = await parseJsonBody(req, HeartbeatSchema);

    const result = await deps.record(device.deviceId, beat);
    if (result.outcome !== "recorded") throw new ApiError("unauthorized", UNAUTHORIZED);

    return ok(
      { server_time: new Date((deps.now ?? Date.now)()).toISOString(), next_interval_seconds: HEARTBEAT_INTERVAL_SECONDS },
      { headers: cors },
    );
  } catch (e) {
    return toErrorResponse(e, cors);
  }
}
