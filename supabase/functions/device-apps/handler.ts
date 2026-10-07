// POST /functions/v1/device-apps — the enrolled app reports the complete list of launchable apps (full replace,
// about once a day and after a change). Authenticated ONLY through `requireActiveDevice` (device JWT + live
// credential check on every request). The device id comes from the verified token; the body can never name a device.
// A device revoked between the guard and the write gets the same 401 as any other failed authentication.
// This endpoint never changes `device_status`/`last_seen_at`, and its response never says what changed.
import { requireActiveDevice } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight, parseAllowedOrigins } from "../_shared/cors.ts";
import { DEVICE_APPS_INTERVAL_SECONDS, DEVICE_APPS_MAX_BODY_BYTES, type DeviceApp, DeviceAppsSchema } from "../_shared/device-apps.ts";
import { ApiError, ok, toErrorResponse } from "../_shared/errors.ts";
import { clientIp, enforceRateLimit, RULES } from "../_shared/ratelimit.ts";
import { parseJsonBody } from "../_shared/validate.ts";

export type DeviceAppsOutcome = { outcome: "recorded" | "inactive" };

export interface Deps {
  allowedOrigins?: string;
  deviceJwtSecret: string;
  /** `device_authorize` — live credential check, uncached. */
  isActive: (deviceId: string, credentialId: string) => Promise<boolean>;
  /** Calls `device_sync_apps` (one transaction: lock, full-replace diff, events only after the baseline). */
  sync: (deviceId: string, apps: DeviceApp[]) => Promise<DeviceAppsOutcome>;
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
    enforceRateLimit(RULES.deviceAppsIp, clientIp(req)); // before any crypto or database work
    const nowMs = (deps.now ?? Date.now)();
    const device = await requireActiveDevice(req, { secret: deps.deviceJwtSecret, isActive: deps.isActive, now: deps.now ? Math.floor(nowMs / 1000) : undefined });
    enforceRateLimit(RULES.deviceApps, device.deviceId);
    const { apps } = await parseJsonBody(req, DeviceAppsSchema, DEVICE_APPS_MAX_BODY_BYTES);

    const result = await deps.sync(device.deviceId, apps);
    if (result.outcome !== "recorded") throw new ApiError("unauthorized", UNAUTHORIZED);

    return ok(
      { server_time: new Date(nowMs).toISOString(), next_interval_seconds: DEVICE_APPS_INTERVAL_SECONDS },
      { headers: cors },
    );
  } catch (e) {
    return toErrorResponse(e, cors);
  }
}
