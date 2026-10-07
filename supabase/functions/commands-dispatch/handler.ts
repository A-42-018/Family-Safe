// POST /functions/v1/commands-dispatch — called by a scheduler (every minute) to hand PENDING commands to FCM.
// It sends ONE kind of message: a data-only wake-up `{ type: "SYNC", cmd_id }` (see `_shared/fcm.ts`). It never decides
// what a device does: the device pulls its commands from the backend and validates them. Authenticated by a shared
// secret in `x-cron-secret` (constant-time comparison); the per-IP limit runs before the secret is looked at. A failed
// push leaves the command PENDING (the device still pulls on its own schedule); a dead token is forgotten; the answer is
// three counters and nothing else (no ids, no tokens). Tokens and keys are never logged.
import { corsHeaders, handlePreflight, parseAllowedOrigins } from "../_shared/cors.ts";
import { ApiError, ok, toErrorResponse } from "../_shared/errors.ts";
import { type SendResult } from "../_shared/fcm.ts";
import { clientIp, enforceRateLimit, RULES } from "../_shared/ratelimit.ts";
import { safeEqual } from "../_shared/validate.ts";

export interface DueCommand {
  commandId: string;
  deviceId: string;
  token: string;
}

export interface Deps {
  allowedOrigins?: string;
  /** The shared secret the scheduler sends. */
  cronSecret: string;
  /** `device_commands_to_push` — PENDING, unexpired, not pushed yet, device ENROLLED with a token. */
  listDue: (limit: number) => Promise<DueCommand[]>;
  /** Sends the wake-up through FCM (never throws). */
  send: (token: string, commandId: string) => Promise<SendResult>;
  /** `device_command_mark_pushed`. */
  markPushed: (commandId: string) => Promise<void>;
  /** `device_token_forget` — FCM said the token is dead. */
  forgetToken: (deviceId: string, token: string) => Promise<void>;
}

export const DISPATCH_BATCH = 50;
const UNAUTHORIZED = "Invalid or expired token";

export async function handler(req: Request, deps: Deps): Promise<Response> {
  const allowed = parseAllowedOrigins(deps.allowedOrigins ?? "http://localhost:3000");
  const pre = handlePreflight(req, allowed);
  if (pre) return pre;
  const cors = corsHeaders(req, allowed);
  try {
    if (req.method !== "POST") throw new ApiError("validation_error", "Method not allowed");
    enforceRateLimit(RULES.commandsDispatchIp, clientIp(req)); // before the secret is compared
    const given = req.headers.get("x-cron-secret") ?? "";
    if (deps.cronSecret.length < 32 || !safeEqual(given, deps.cronSecret)) throw new ApiError("unauthorized", UNAUTHORIZED);
    enforceRateLimit(RULES.commandsDispatch, "all");

    const due = await deps.listDue(DISPATCH_BATCH);
    let sent = 0;
    let invalid = 0;
    let failed = 0;
    for (const c of due) {
      const result = await deps.send(c.token, c.commandId);
      if (result === "sent") {
        await deps.markPushed(c.commandId);
        sent++;
      } else if (result === "invalid_token") {
        await deps.forgetToken(c.deviceId, c.token);
        invalid++;
      } else {
        failed++;
      }
    }
    return ok({ sent, invalid, failed }, { headers: cors });
  } catch (e) {
    return toErrorResponse(e, cors);
  }
}
