// POST /functions/v1/device-revoke — parent revokes one of THEIR devices. Body: { device_id }.
// Revokes every credential, drops the push registration, writes a DEVICE_REMOVED audit row. Idempotent.
// Note: an already-issued 15-minute access JWT stays cryptographically valid until it expires; Phase 11 checks the
// credential id (`cid`) against revocation on every device request, which closes that window.
import { requireParent, type ParentTokenVerifier } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight, parseAllowedOrigins } from "../_shared/cors.ts";
import { ApiError, ok, toErrorResponse } from "../_shared/errors.ts";
import { RevokeDeviceSchema } from "../_shared/enrollment.ts";
import { normalizeIp } from "../_shared/ip.ts";
import { clientIp, enforceRateLimit, RULES } from "../_shared/ratelimit.ts";
import { parseJsonBody } from "../_shared/validate.ts";

export interface Deps {
  allowedOrigins?: string;
  verify: ParentTokenVerifier;
  /** Calls `enrollment_revoke_device`: 'revoked' | 'already_revoked' | null (missing or not the parent's). */
  revoke: (a: { parentId: string; deviceId: string; ip: string | null }) => Promise<"revoked" | "already_revoked" | null>;
}

export async function handler(req: Request, deps: Deps): Promise<Response> {
  const allowed = parseAllowedOrigins(deps.allowedOrigins ?? "http://localhost:3000");
  const pre = handlePreflight(req, allowed);
  if (pre) return pre;
  const cors = corsHeaders(req, allowed);
  try {
    if (req.method !== "POST") throw new ApiError("validation_error", "Method not allowed");
    const ip = clientIp(req);
    enforceRateLimit(RULES.enrollmentIp, ip);
    const parent = await requireParent(req, deps.verify);
    enforceRateLimit(RULES.deviceRevoke, parent.parentId);
    const body = await parseJsonBody(req, RevokeDeviceSchema);

    const result = await deps.revoke({ parentId: parent.parentId, deviceId: body.device_id, ip: normalizeIp(ip) });
    if (!result) throw new ApiError("not_found", "Device not found"); // foreign ≙ missing
    return ok({ revoked: true, already_revoked: result === "already_revoked" }, { headers: cors });
  } catch (e) {
    return toErrorResponse(e, cors);
  }
}
