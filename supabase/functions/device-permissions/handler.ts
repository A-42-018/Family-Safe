// POST /functions/v1/device-permissions — the enrolled app reports the OS grant state of the 8 catalog permissions
// (periodically and when the app resumes). Authenticated ONLY through `requireActiveDevice` (device JWT + live
// credential check on every request). The device id comes from the verified token; the body can never name a device.
// A device revoked between the guard and the write gets the same 401 as any other failed authentication.
// This endpoint never changes `device_status`/`last_seen_at`.
import { requireActiveDevice } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight, parseAllowedOrigins } from "../_shared/cors.ts";
import { ApiError, ok, toErrorResponse } from "../_shared/errors.ts";
import { PERMISSION_SYNC_INTERVAL_SECONDS, type PermissionSync, PermissionSyncSchema } from "../_shared/permissions.ts";
import { clientIp, enforceRateLimit, RULES } from "../_shared/ratelimit.ts";
import { parseJsonBody } from "../_shared/validate.ts";

export type PermissionSyncOutcome = { outcome: "recorded" | "inactive"; changed: number };

export interface Deps {
  allowedOrigins?: string;
  deviceJwtSecret: string;
  /** `device_authorize` — live credential check, uncached. */
  isActive: (deviceId: string, credentialId: string) => Promise<boolean>;
  /** Calls `device_update_permissions` (one transaction: lock, diff, update, events + audit only on change). */
  record: (deviceId: string, states: PermissionSync) => Promise<PermissionSyncOutcome>;
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
    enforceRateLimit(RULES.permissionsIp, clientIp(req)); // before any crypto or database work
    const nowMs = (deps.now ?? Date.now)();
    const device = await requireActiveDevice(req, { secret: deps.deviceJwtSecret, isActive: deps.isActive, now: deps.now ? Math.floor(nowMs / 1000) : undefined });
    enforceRateLimit(RULES.permissions, device.deviceId);
    const states = await parseJsonBody(req, PermissionSyncSchema);

    const result = await deps.record(device.deviceId, states);
    if (result.outcome !== "recorded") throw new ApiError("unauthorized", UNAUTHORIZED);

    // The response never says what changed: the device does not need to learn it, and it keeps the body minimal.
    return ok(
      { server_time: new Date(nowMs).toISOString(), next_interval_seconds: PERMISSION_SYNC_INTERVAL_SECONDS },
      { headers: cors },
    );
  } catch (e) {
    return toErrorResponse(e, cors);
  }
}
