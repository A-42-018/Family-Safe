// POST /functions/v1/device-app-events — the enrolled app reports that the child tried to open an app the parent
// blocked (BLOCKED_APP_ATTEMPT: package name + time only). Authenticated ONLY through `requireActiveDevice` (device JWT +
// live credential check on every request); the device id comes from the verified token, the body can never name a
// device. The database decides what is stored (only packages that are blocked right now, throttled per package, capped
// per day) — the answer never says what was stored or ignored, so the device learns nothing about the rules from it.
// A device revoked between the guard and the write gets the same 401 as any other failed authentication.
// Never changes `device_status`/`last_seen_at`, writes no audit row and queues no command.
import { requireActiveDevice } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight, parseAllowedOrigins } from "../_shared/cors.ts";
import { type AppEvent, DeviceAppEventsSchema, isAppEventTimeInRange } from "../_shared/device-app-events.ts";
import { ApiError, ok, toErrorResponse } from "../_shared/errors.ts";
import { clientIp, enforceRateLimit, RULES } from "../_shared/ratelimit.ts";
import { parseJsonBody } from "../_shared/validate.ts";

export type AppEventsOutcome = { outcome: "recorded" | "inactive" };

export interface Deps {
  allowedOrigins?: string;
  deviceJwtSecret: string;
  /** `device_authorize` — live credential check, uncached. */
  isActive: (deviceId: string, credentialId: string) => Promise<boolean>;
  /** Calls `device_record_app_attempts` (one transaction: lock, validate, throttle, store). */
  record: (deviceId: string, events: AppEvent[]) => Promise<AppEventsOutcome>;
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
    enforceRateLimit(RULES.deviceAppEventsIp, clientIp(req)); // before any crypto or database work
    const nowMs = (deps.now ?? Date.now)();
    const device = await requireActiveDevice(req, { secret: deps.deviceJwtSecret, isActive: deps.isActive, now: deps.now ? Math.floor(nowMs / 1000) : undefined });
    enforceRateLimit(RULES.deviceAppEvents, device.deviceId);
    const body = await parseJsonBody(req, DeviceAppEventsSchema);
    // Narrower than the SQL window, so the database never has to reject a time this layer accepted.
    if (!body.events.every((e) => isAppEventTimeInRange(e.occurred_at, nowMs))) {
      throw new ApiError("validation_error", "Invalid request body");
    }

    const result = await deps.record(device.deviceId, body.events);
    if (result.outcome !== "recorded") throw new ApiError("unauthorized", UNAUTHORIZED);

    return ok({ server_time: new Date(nowMs).toISOString() }, { headers: cors });
  } catch (e) {
    return toErrorResponse(e, cors);
  }
}
