// POST /functions/v1/device-info — the enrolled app reports coarse, permission-free hardware/OS facts (~once a day).
// Authenticated ONLY through `requireActiveDevice` (device JWT + live credential check on every request). The device
// id comes from the verified token; the body can never name a device. A device revoked between the guard and the write
// gets the same 401 as any other failed authentication. This endpoint never changes `device_status`/`last_seen_at`.
import { requireActiveDevice } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight, parseAllowedOrigins } from "../_shared/cors.ts";
import { DEVICE_INFO_INTERVAL_SECONDS, type DeviceInfo, DeviceInfoSchema } from "../_shared/device-info.ts";
import { ApiError, ok, toErrorResponse } from "../_shared/errors.ts";
import { clientIp, enforceRateLimit, RULES } from "../_shared/ratelimit.ts";
import { parseJsonBody } from "../_shared/validate.ts";

export type DeviceInfoOutcome = { outcome: "recorded" | "inactive" };

export interface Deps {
  allowedOrigins?: string;
  deviceJwtSecret: string;
  /** `device_authorize` — live credential check, uncached. */
  isActive: (deviceId: string, credentialId: string) => Promise<boolean>;
  /** Calls `device_update_info` (one transaction: lock the device row, overwrite the info columns). */
  record: (deviceId: string, info: DeviceInfo) => Promise<DeviceInfoOutcome>;
  now?: () => number; // ms, injectable for tests
}

const UNAUTHORIZED = "Invalid or expired token";
const DAY_MS = 86_400_000;

export async function handler(req: Request, deps: Deps): Promise<Response> {
  const allowed = parseAllowedOrigins(deps.allowedOrigins ?? "http://localhost:3000");
  const pre = handlePreflight(req, allowed);
  if (pre) return pre;
  const cors = corsHeaders(req, allowed);
  try {
    if (req.method !== "POST") throw new ApiError("validation_error", "Method not allowed");
    enforceRateLimit(RULES.deviceInfoIp, clientIp(req)); // before any crypto or database work
    const nowMs = (deps.now ?? Date.now)();
    const device = await requireActiveDevice(req, { secret: deps.deviceJwtSecret, isActive: deps.isActive, now: deps.now ? Math.floor(nowMs / 1000) : undefined });
    enforceRateLimit(RULES.deviceInfo, device.deviceId);
    const info = await parseJsonBody(req, DeviceInfoSchema);

    // A patch date more than a day in the future is garbage (or a wrong device clock never produces one: the value
    // comes from the OS build, not from the clock). ISO dates compare as strings.
    if (info.security_patch !== null && info.security_patch > new Date(nowMs + DAY_MS).toISOString().slice(0, 10)) {
      throw new ApiError("validation_error", "Invalid request body");
    }

    const result = await deps.record(device.deviceId, info);
    if (result.outcome !== "recorded") throw new ApiError("unauthorized", UNAUTHORIZED);

    return ok(
      { server_time: new Date(nowMs).toISOString(), next_interval_seconds: DEVICE_INFO_INTERVAL_SECONDS },
      { headers: cors },
    );
  } catch (e) {
    return toErrorResponse(e, cors);
  }
}
