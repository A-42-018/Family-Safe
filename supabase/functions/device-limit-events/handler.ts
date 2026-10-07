// POST /functions/v1/device-limit-events — the enrolled app reports that today's screen-time limit was reached
// (the local day and when; no minutes, no package). Authenticated ONLY through `requireActiveDevice` (device JWT + live
// credential check on every request); the device id comes from the verified token, the body can never name a device.
// The database decides what is stored (nothing when no limit is configured, one event per day) and the answer never
// says which, so the device learns nothing about the rules from it. A device revoked between the guard and the write
// gets the same 401 as any other failed authentication. Never changes `device_status`/`last_seen_at`.
import { requireActiveDevice } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight, parseAllowedOrigins } from "../_shared/cors.ts";
import { isAppEventTimeInRange } from "../_shared/device-app-events.ts";
import { type DeviceLimitReached, DeviceLimitReachedSchema, isLimitEventDayInRange } from "../_shared/device-limit-events.ts";
import { ApiError, ok, toErrorResponse } from "../_shared/errors.ts";
import { clientIp, enforceRateLimit, RULES } from "../_shared/ratelimit.ts";
import { parseJsonBody } from "../_shared/validate.ts";

export type LimitEventOutcome = { outcome: "recorded" | "inactive" };

export interface Deps {
  allowedOrigins?: string;
  deviceJwtSecret: string;
  /** `device_authorize` — live credential check, uncached. */
  isActive: (deviceId: string, credentialId: string) => Promise<boolean>;
  /** Calls `device_record_limit_reached` (one transaction: lock, validate, dedupe, store). */
  record: (deviceId: string, event: DeviceLimitReached) => Promise<LimitEventOutcome>;
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
    enforceRateLimit(RULES.deviceLimitEventsIp, clientIp(req)); // before any crypto or database work
    const nowMs = (deps.now ?? Date.now)();
    const device = await requireActiveDevice(req, { secret: deps.deviceJwtSecret, isActive: deps.isActive, now: deps.now ? Math.floor(nowMs / 1000) : undefined });
    enforceRateLimit(RULES.deviceLimitEvents, device.deviceId);
    const body = await parseJsonBody(req, DeviceLimitReachedSchema);
    // Narrower than the SQL windows, so the database never has to reject a value this layer accepted.
    if (!isLimitEventDayInRange(body.day, nowMs) || !isAppEventTimeInRange(body.occurred_at, nowMs)) {
      throw new ApiError("validation_error", "Invalid request body");
    }

    const result = await deps.record(device.deviceId, body);
    if (result.outcome !== "recorded") throw new ApiError("unauthorized", UNAUTHORIZED);

    return ok({ server_time: new Date(nowMs).toISOString() }, { headers: cors });
  } catch (e) {
    return toErrorResponse(e, cors);
  }
}
