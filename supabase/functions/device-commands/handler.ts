// GET  /functions/v1/device-commands — the enrolled app pulls its pending commands (after a wake-up and on a fallback schedule).
// POST /functions/v1/device-commands — the app acknowledges one command (EXECUTED or FAILED).
// Authenticated ONLY through `requireActiveDevice` (device JWT + live credential check on every request); the device id
// comes from the verified token, the body can never name a device. The answer to a pull holds only `{ id, type,
// expires_at }` per command and the server time — never a payload and never anything about the rules. A pushed message is
// never an instruction: the device acts only on what it pulls here. Acknowledgements are idempotent (a replay or a late
// one is a 200 that changes nothing); only a command that is not this device's is a 404.
import { requireActiveDevice } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight, parseAllowedOrigins } from "../_shared/cors.ts";
import { type CommandAck, CommandAckSchema, COMMAND_PULL_DEFAULT, type DeviceCommandRow } from "../_shared/device-commands.ts";
import { ApiError, ok, toErrorResponse } from "../_shared/errors.ts";
import { clientIp, enforceRateLimit, RULES } from "../_shared/ratelimit.ts";
import { parseJsonBody } from "../_shared/validate.ts";

export type PullOutcome = { outcome: "ok"; commands: DeviceCommandRow[] } | { outcome: "inactive" };
export type AckOutcome = { outcome: "acked" | "unchanged" | "expired" | "not_found" | "inactive" };

export interface Deps {
  allowedOrigins?: string;
  deviceJwtSecret: string;
  /** `device_authorize` — live credential check, uncached. */
  isActive: (deviceId: string, credentialId: string) => Promise<boolean>;
  /** Calls `device_commands_pull` (marks PENDING commands DELIVERED). */
  pull: (deviceId: string, limit: number) => Promise<PullOutcome>;
  /** Calls `device_command_ack` (replay-safe state machine). */
  ack: (deviceId: string, ack: CommandAck) => Promise<AckOutcome>;
  now?: () => number; // ms, injectable for tests
}

const UNAUTHORIZED = "Invalid or expired token";

export async function handler(req: Request, deps: Deps): Promise<Response> {
  const allowed = parseAllowedOrigins(deps.allowedOrigins ?? "http://localhost:3000");
  const pre = handlePreflight(req, allowed);
  if (pre) return pre;
  const cors = corsHeaders(req, allowed);
  try {
    if (req.method !== "GET" && req.method !== "POST") throw new ApiError("validation_error", "Method not allowed");
    enforceRateLimit(RULES.deviceCommandsIp, clientIp(req)); // before any crypto or database work
    const nowMs = (deps.now ?? Date.now)();
    const device = await requireActiveDevice(req, { secret: deps.deviceJwtSecret, isActive: deps.isActive, now: deps.now ? Math.floor(nowMs / 1000) : undefined });
    enforceRateLimit(RULES.deviceCommands, device.deviceId);

    if (req.method === "GET") {
      const result = await deps.pull(device.deviceId, COMMAND_PULL_DEFAULT);
      if (result.outcome !== "ok") throw new ApiError("unauthorized", UNAUTHORIZED);
      return ok({ commands: result.commands, server_time: new Date(nowMs).toISOString() }, { headers: cors });
    }

    const body = await parseJsonBody(req, CommandAckSchema);
    const result = await deps.ack(device.deviceId, body);
    if (result.outcome === "inactive") throw new ApiError("unauthorized", UNAUTHORIZED);
    if (result.outcome === "not_found") throw new ApiError("not_found", "Not found");
    return ok({ server_time: new Date(nowMs).toISOString() }, { headers: cors });
  } catch (e) {
    return toErrorResponse(e, cors);
  }
}
