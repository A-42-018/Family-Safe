// GET /functions/v1/device-config — the enrolled app pulls its current rules (daily limit + per-weekday overrides,
// bedtime, school mode, app rules). Authenticated ONLY through `requireActiveDevice` (device JWT + live credential check on every
// request); the device id comes from the verified token and the request has no body and no parameters that name a device.
// Conditional GET: the response carries `ETag: "v<config_version>"`; a matching `If-None-Match` gets 304 with no body.
// Read-only: never changes `device_status`/`last_seen_at` (only the heartbeat is the liveness signal). A SYNC_CONFIG
// command only tells the device to come here — rule values are never pushed through commands/FCM.
import { requireActiveDevice } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight, parseAllowedOrigins } from "../_shared/cors.ts";
import {
  DEVICE_CONFIG_INTERVAL_SECONDS,
  type DeviceConfigRow,
  etagForConfigVersion,
  parseConfigEtag,
} from "../_shared/device-config.ts";
import { ApiError, ok, toErrorResponse } from "../_shared/errors.ts";
import { clientIp, enforceRateLimit, RULES } from "../_shared/ratelimit.ts";

export type DeviceConfigResult = { outcome: "ok"; config: DeviceConfigRow } | { outcome: "inactive" };

export interface Deps {
  allowedOrigins?: string;
  deviceJwtSecret: string;
  /** `device_authorize` — live credential check, uncached. */
  isActive: (deviceId: string, credentialId: string) => Promise<boolean>;
  /** Calls `device_get_config` (read-only). */
  getConfig: (deviceId: string) => Promise<DeviceConfigResult>;
  now?: () => number; // ms, injectable for tests
}

const UNAUTHORIZED = "Invalid or expired token";

export async function handler(req: Request, deps: Deps): Promise<Response> {
  const allowed = parseAllowedOrigins(deps.allowedOrigins ?? "http://localhost:3000");
  const pre = handlePreflight(req, allowed);
  if (pre) return pre;
  const cors = corsHeaders(req, allowed);
  try {
    if (req.method !== "GET") throw new ApiError("validation_error", "Method not allowed");
    enforceRateLimit(RULES.deviceConfigIp, clientIp(req)); // before any crypto or database work
    const nowMs = (deps.now ?? Date.now)();
    const device = await requireActiveDevice(req, { secret: deps.deviceJwtSecret, isActive: deps.isActive, now: deps.now ? Math.floor(nowMs / 1000) : undefined });
    enforceRateLimit(RULES.deviceConfig, device.deviceId);

    const result = await deps.getConfig(device.deviceId);
    if (result.outcome !== "ok") throw new ApiError("unauthorized", UNAUTHORIZED);
    const { config } = result;

    const etag = etagForConfigVersion(config.config_version);
    if (parseConfigEtag(req.headers.get("if-none-match")) === config.config_version) {
      return new Response(null, { status: 304, headers: { ...cors, ETag: etag, "Cache-Control": "no-store" } });
    }
    return ok(
      { ...config, server_time: new Date(nowMs).toISOString(), next_interval_seconds: DEVICE_CONFIG_INTERVAL_SECONDS },
      { headers: { ...cors, ETag: etag } },
    );
  } catch (e) {
    return toErrorResponse(e, cors);
  }
}
