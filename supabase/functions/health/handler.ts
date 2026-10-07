import { ApiError, ok, toErrorResponse } from "../_shared/errors.ts";
import { corsHeaders, handlePreflight, parseAllowedOrigins } from "../_shared/cors.ts";
import { envStatus } from "../_shared/env.ts";
import { clientIp, enforceRateLimit, RULES } from "../_shared/ratelimit.ts";

export const VERSION = "0.2.0";

export function handler(req: Request, envSource: Record<string, string | undefined> = Deno.env.toObject()): Response {
  const allowed = parseAllowedOrigins(envSource.ALLOWED_ORIGINS ?? "http://localhost:3000");
  const pre = handlePreflight(req, allowed);
  if (pre) return pre;
  const cors = corsHeaders(req, allowed);
  try {
    if (req.method !== "GET") throw new ApiError("validation_error", "Method not allowed");
    enforceRateLimit(RULES.health, clientIp(req));
    const status = envStatus(envSource);
    // Public endpoint: reports only a boolean; never names missing secrets.
    return ok({ status: status.ok ? "ok" : "degraded", version: VERSION, time: new Date().toISOString() }, { headers: cors });
  } catch (e) {
    return toErrorResponse(e, cors);
  }
}
