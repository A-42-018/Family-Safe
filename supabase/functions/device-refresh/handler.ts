// POST /functions/v1/device-refresh — the enrolled app trades its refresh token for a new access token AND a new
// refresh token (rotation). UNAUTHENTICATED by design: the 256-bit refresh token is the credential; `Authorization`
// is never read. Unknown, expired, revoked and replayed tokens are indistinguishable (same 401). Presenting an
// already-rotated token revokes the whole family (done in SQL) and the parent must re-add the device.
import { signDeviceJwt } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight, parseAllowedOrigins } from "../_shared/cors.ts";
import { RefreshSchema } from "../_shared/device-auth.ts";
import { DEVICE_ACCESS_TTL_SECONDS, DEVICE_REFRESH_TTL_SECONDS, generateRefreshToken, hashRefreshToken } from "../_shared/enrollment.ts";
import { ApiError, ok, toErrorResponse } from "../_shared/errors.ts";
import { clientIp, enforceRateLimit, RULES } from "../_shared/ratelimit.ts";
import { parseJsonBody } from "../_shared/validate.ts";

export type RefreshOutcome =
  | { outcome: "rotated"; deviceId: string; credentialId: string }
  | { outcome: "invalid" | "reused" };

export interface RefreshArgs { tokenHash: Uint8Array; newHash: Uint8Array; ttlSeconds: number }

export interface Deps {
  allowedOrigins?: string;
  deviceJwtSecret: string;
  /** Calls `device_refresh` (one transaction: rotate, or detect reuse and revoke the family). */
  refresh: (a: RefreshArgs) => Promise<RefreshOutcome>;
  now?: () => number; // ms, injectable for tests
}

const INVALID = "Invalid or expired refresh token";

export async function handler(req: Request, deps: Deps): Promise<Response> {
  const allowed = parseAllowedOrigins(deps.allowedOrigins ?? "http://localhost:3000");
  const pre = handlePreflight(req, allowed);
  if (pre) return pre;
  const cors = corsHeaders(req, allowed);
  try {
    if (req.method !== "POST") throw new ApiError("validation_error", "Method not allowed");
    enforceRateLimit(RULES.deviceRefresh, clientIp(req)); // 60 / 5 min / IP, success or not
    const body = await parseJsonBody(req, RefreshSchema);

    const newRefreshToken = generateRefreshToken();
    const nowMs = (deps.now ?? Date.now)();
    const result = await deps.refresh({
      tokenHash: await hashRefreshToken(body.refresh_token),
      newHash: await hashRefreshToken(newRefreshToken),
      ttlSeconds: DEVICE_REFRESH_TTL_SECONDS,
    });
    if (result.outcome === "reused") console.warn("device_refresh_reuse"); // no ids, no token material
    if (result.outcome !== "rotated") throw new ApiError("unauthorized", INVALID);

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
        refresh_token: newRefreshToken,
        refresh_expires_at: new Date(nowMs + DEVICE_REFRESH_TTL_SECONDS * 1000).toISOString(),
      },
      { headers: cors },
    );
  } catch (e) {
    return toErrorResponse(e, cors);
  }
}
