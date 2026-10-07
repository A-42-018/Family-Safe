// POST /functions/v1/enrollment-create — parent mints a short-lived, single-use pairing code for ONE OF THEIR children.
// Body: { child_id }. The code is returned once and never stored (only its HMAC); it is never logged.
import { requireParent, type ParentTokenVerifier } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight, parseAllowedOrigins } from "../_shared/cors.ts";
import { ApiError, ok, toErrorResponse } from "../_shared/errors.ts";
import {
  buildQrPayload, CreatePairingSchema, formatPairingCode, generatePairingCode, hashPairingCode, PAIRING_TTL_SECONDS,
} from "../_shared/enrollment.ts";
import { clientIp, enforceRateLimit, RULES } from "../_shared/ratelimit.ts";
import { parseJsonBody } from "../_shared/validate.ts";

export interface Deps {
  allowedOrigins?: string;
  verify: ParentTokenVerifier;
  pairingPepper: string;
  /** Calls `enrollment_create_token`; resolves to the ISO expiry, or null when the child is missing or not the parent's. */
  createToken: (a: { parentId: string; childId: string; tokenHash: Uint8Array; ttlSeconds: number }) => Promise<string | null>;
  generateCode?: () => string; // injectable for tests
}

export async function handler(req: Request, deps: Deps): Promise<Response> {
  const allowed = parseAllowedOrigins(deps.allowedOrigins ?? "http://localhost:3000");
  const pre = handlePreflight(req, allowed);
  if (pre) return pre;
  const cors = corsHeaders(req, allowed);
  try {
    if (req.method !== "POST") throw new ApiError("validation_error", "Method not allowed");
    enforceRateLimit(RULES.enrollmentIp, clientIp(req)); // before auth: blunts token-guessing floods
    const parent = await requireParent(req, deps.verify); // device tokens -> 403
    enforceRateLimit(RULES.enrollment, parent.parentId);
    const body = await parseJsonBody(req, CreatePairingSchema);

    const code = (deps.generateCode ?? generatePairingCode)();
    const expiresAt = await deps.createToken({
      parentId: parent.parentId,
      childId: body.child_id,
      tokenHash: await hashPairingCode(code, deps.pairingPepper),
      ttlSeconds: PAIRING_TTL_SECONDS,
    });
    if (!expiresAt) throw new ApiError("not_found", "Child not found"); // foreign ≙ missing

    return ok(
      { pairing_code: formatPairingCode(code), qr_payload: buildQrPayload(code), expires_at: expiresAt, expires_in: PAIRING_TTL_SECONDS },
      { status: 201, headers: cors },
    );
  } catch (e) {
    return toErrorResponse(e, cors);
  }
}
