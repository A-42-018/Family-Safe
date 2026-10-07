// POST /functions/v1/device-usage — the enrolled app reports one day of usage statistics (screen minutes, unlocks,
// per-app foreground minutes + launches). Values are cumulative; the database keeps the larger value per column, so
// retries and re-ordered uploads are harmless. Authenticated ONLY through `requireActiveDevice` (device JWT + live
// credential check on every request). The device id comes from the verified token; the body can never name a device.
// A device revoked between the guard and the write gets the same 401 as any other failed authentication.
// This endpoint never changes `device_status`/`last_seen_at`, and its response never echoes stored values.
import { requireActiveDevice } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight, parseAllowedOrigins } from "../_shared/cors.ts";
import { DEVICE_USAGE_INTERVAL_SECONDS, type DeviceUsage, DeviceUsageSchema, isUsageDayInRange } from "../_shared/device-usage.ts";
import { ApiError, ok, toErrorResponse } from "../_shared/errors.ts";
import { clientIp, enforceRateLimit, RULES } from "../_shared/ratelimit.ts";
import { parseJsonBody } from "../_shared/validate.ts";

export type DeviceUsageOutcome = { outcome: "recorded" | "inactive" };

export interface Deps {
  allowedOrigins?: string;
  deviceJwtSecret: string;
  /** `device_authorize` — live credential check, uncached. */
  isActive: (deviceId: string, credentialId: string) => Promise<boolean>;
  /** Calls `device_upload_usage` (one transaction: lock, GREATEST-merge of one day). */
  upload: (deviceId: string, usage: DeviceUsage) => Promise<DeviceUsageOutcome>;
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
    enforceRateLimit(RULES.deviceUsageIp, clientIp(req)); // before any crypto or database work
    const nowMs = (deps.now ?? Date.now)();
    const device = await requireActiveDevice(req, { secret: deps.deviceJwtSecret, isActive: deps.isActive, now: deps.now ? Math.floor(nowMs / 1000) : undefined });
    enforceRateLimit(RULES.deviceUsage, device.deviceId);
    const usage = await parseJsonBody(req, DeviceUsageSchema);
    // Same window as the SQL function, so the database never has to reject a day this layer accepted.
    if (!isUsageDayInRange(usage.day, nowMs)) throw new ApiError("validation_error", "Invalid request body");

    const result = await deps.upload(device.deviceId, usage);
    if (result.outcome !== "recorded") throw new ApiError("unauthorized", UNAUTHORIZED);

    return ok(
      { server_time: new Date(nowMs).toISOString(), next_interval_seconds: DEVICE_USAGE_INTERVAL_SECONDS },
      { headers: cors },
    );
  } catch (e) {
    return toErrorResponse(e, cors);
  }
}
