// POST /functions/v1/device-fcm-token — the enrolled app registers its FCM token (once after enrollment and whenever
// Firebase rotates it). Authenticated ONLY through `requireActiveDevice` (device JWT + live credential check on every
// request); the device id comes from the verified token, the body can never name a device. The token is stored where
// no parent can ever read it; it is used only to send a data-less wake-up. The answer carries the server time only.
// A device revoked between the guard and the write gets the same 401 as any other failed authentication.
import { requireActiveDevice } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight, parseAllowedOrigins } from "../_shared/cors.ts";
import { FcmTokenSchema } from "../_shared/device-commands.ts";
import { ApiError, ok, toErrorResponse } from "../_shared/errors.ts";
import { clientIp, enforceRateLimit, RULES } from "../_shared/ratelimit.ts";
import { parseJsonBody } from "../_shared/validate.ts";

export type RegisterOutcome = { outcome: "registered" | "unchanged" | "inactive" };

export interface Deps {
  allowedOrigins?: string;
  deviceJwtSecret: string;
  /** `device_authorize` — live credential check, uncached. */
  isActive: (deviceId: string, credentialId: string) => Promise<boolean>;
  /** Calls `device_register_push_token` (one transaction: lock the device, upsert the token). */
  register: (deviceId: string, token: string) => Promise<RegisterOutcome>;
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
    enforceRateLimit(RULES.deviceFcmTokenIp, clientIp(req)); // before any crypto or database work
    const nowMs = (deps.now ?? Date.now)();
    const device = await requireActiveDevice(req, { secret: deps.deviceJwtSecret, isActive: deps.isActive, now: deps.now ? Math.floor(nowMs / 1000) : undefined });
    enforceRateLimit(RULES.deviceFcmToken, device.deviceId);
    const body = await parseJsonBody(req, FcmTokenSchema);

    const result = await deps.register(device.deviceId, body.token);
    if (result.outcome === "inactive") throw new ApiError("unauthorized", UNAUTHORIZED);

    return ok({ server_time: new Date(nowMs).toISOString() }, { headers: cors });
  } catch (e) {
    return toErrorResponse(e, cors);
  }
}
