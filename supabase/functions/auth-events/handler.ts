// POST /functions/v1/auth-events — records parent LOGIN audit rows. Called by the web SERVER with the user's own
// access token; the browser never calls this and no service key ever leaves the Edge Function.
import { z } from "zod";
import { requireParent, type ParentTokenVerifier } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight, parseAllowedOrigins } from "../_shared/cors.ts";
import { ApiError, ok, toErrorResponse } from "../_shared/errors.ts";
import { clientIp, enforceRateLimit, RULES } from "../_shared/ratelimit.ts";
import { normalizeIp } from "../_shared/ip.ts";
import { parseJsonBody } from "../_shared/validate.ts";

export { normalizeIp }; // kept for existing imports/tests

// Mirrors packages/contracts `authEventSchema` (Edge Functions can't import workspace packages).
export const AuthEventSchema = z.object({
  event: z.literal("LOGIN"),
  method: z.enum(["password", "mfa_totp"]),
});

export interface AuditRow {
  parent_id: string;
  action: "LOGIN";
  metadata: { method: "password" | "mfa_totp" };
  ip_address: string | null;
}

export interface Deps {
  allowedOrigins?: string;
  verify: ParentTokenVerifier;
  insertAudit: (row: AuditRow) => Promise<void>;
}

export async function handler(req: Request, deps: Deps): Promise<Response> {
  const allowed = parseAllowedOrigins(deps.allowedOrigins ?? "http://localhost:3000");
  const pre = handlePreflight(req, allowed);
  if (pre) return pre;
  const cors = corsHeaders(req, allowed);
  try {
    if (req.method !== "POST") throw new ApiError("validation_error", "Method not allowed");
    const ip = clientIp(req);
    enforceRateLimit(RULES.authEventsIp, ip); // before auth: blunts token-guessing floods
    const parent = await requireParent(req, deps.verify);
    enforceRateLimit(RULES.authEventsParent, parent.parentId);
    const body = await parseJsonBody(req, AuthEventSchema);
    await deps.insertAudit({
      parent_id: parent.parentId,
      action: body.event,
      metadata: { method: body.method }, // no emails, tokens, user agents
      ip_address: normalizeIp(ip),
    });
    return ok({ recorded: true }, { headers: cors });
  } catch (e) {
    return toErrorResponse(e, cors);
  }
}
