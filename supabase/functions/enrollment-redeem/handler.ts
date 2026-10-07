// POST /functions/v1/enrollment-redeem — the child device exchanges a pairing code for device credentials.
// UNAUTHENTICATED by design: the single-use code is the credential. The Authorization header is never read, so a
// parent (or device) JWT can neither help nor hurt here. Unknown, expired and already-used codes are indistinguishable.
import { signDeviceJwt } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight, parseAllowedOrigins } from "../_shared/cors.ts";
import { ApiError, ok, toErrorResponse } from "../_shared/errors.ts";
import {
  DEVICE_ACCESS_TTL_SECONDS, DEVICE_REFRESH_TTL_SECONDS, generateRefreshToken, hashPairingCode, hashRefreshToken, RedeemSchema,
} from "../_shared/enrollment.ts";
import { clientIp, enforceRateLimit, RULES } from "../_shared/ratelimit.ts";
import { parseJsonBody } from "../_shared/validate.ts";

export interface RedeemArgs {
  tokenHash: Uint8Array;
  deviceName: string;
  manufacturer?: string;
  model?: string;
  androidVersion?: string;
  appVersion?: string;
  refreshHash: Uint8Array;
  refreshTtlSeconds: number;
}

export interface Deps {
  allowedOrigins?: string;
  pairingPepper: string;
  deviceJwtSecret: string;
  /** Calls `enrollment_redeem` (one transaction); resolves to null for unknown/expired/consumed codes. */
  redeem: (a: RedeemArgs) => Promise<{ deviceId: string; credentialId: string } | null>;
  now?: () => number; // ms, injectable for tests
}

const INVALID = "Invalid or expired pairing code";

export async function handler(req: Request, deps: Deps): Promise<Response> {
  const allowed = parseAllowedOrigins(deps.allowedOrigins ?? "http://localhost:3000");
  const pre = handlePreflight(req, allowed);
  if (pre) return pre;
  const cors = corsHeaders(req, allowed);
  try {
    if (req.method !== "POST") throw new ApiError("validation_error", "Method not allowed");
    enforceRateLimit(RULES.pairing, clientIp(req)); // every attempt counts (5 / 5 min / IP), success or not
    const body = await parseJsonBody(req, RedeemSchema);

    const refreshToken = generateRefreshToken();
    const nowMs = (deps.now ?? Date.now)();
    const result = await deps.redeem({
      tokenHash: await hashPairingCode(body.code, deps.pairingPepper),
      deviceName: body.device_name,
      manufacturer: body.manufacturer,
      model: body.model,
      androidVersion: body.android_version,
      appVersion: body.app_version,
      refreshHash: await hashRefreshToken(refreshToken),
      refreshTtlSeconds: DEVICE_REFRESH_TTL_SECONDS,
    });
    if (!result) throw new ApiError("unauthorized", INVALID);

    const accessToken = await signDeviceJwt(
      { sub: result.deviceId, cid: result.credentialId, jti: crypto.randomUUID(), ttlSeconds: DEVICE_ACCESS_TTL_SECONDS },
      deps.deviceJwtSecret,
      Math.floor(nowMs / 1000),
    );
    return ok(
      {
        device_id: result.deviceId,
        token_type: "Bearer",
        access_token: accessToken,
        access_expires_in: DEVICE_ACCESS_TTL_SECONDS,
        refresh_token: refreshToken,
        refresh_expires_at: new Date(nowMs + DEVICE_REFRESH_TTL_SECONDS * 1000).toISOString(),
      },
      { status: 201, headers: cors },
    );
  } catch (e) {
    return toErrorResponse(e, cors);
  }
}
