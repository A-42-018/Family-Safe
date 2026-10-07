import { getEnv } from "../_shared/env.ts";
import { toErrorResponse } from "../_shared/errors.ts";
import { createDeviceAuthorizer, createServiceClient } from "../_shared/supabase.ts";
import { type Deps, handler } from "./handler.ts";

let deps: Deps | null = null;

function build(): Deps {
  const env = getEnv();
  const service = createServiceClient(env);
  return {
    allowedOrigins: env.ALLOWED_ORIGINS,
    deviceJwtSecret: env.DEVICE_JWT_SECRET,
    isActive: createDeviceAuthorizer(service),
    async pull(deviceId, limit) {
      const { data, error } = await service.rpc("device_commands_pull", { p_device_id: deviceId, p_limit: limit });
      if (error) throw new Error("rpc_failed"); // never echo DB details to the device
      const rows = Array.isArray(data) ? data : [];
      if (rows[0]?.o_outcome === "inactive") return { outcome: "inactive" };
      const commands = rows.flatMap((r: Record<string, unknown>) =>
        r.o_outcome === "ok" && typeof r.o_id === "string" && r.o_command_type === "SYNC_CONFIG" && typeof r.o_expires_at === "string"
          ? [{ id: r.o_id, type: "SYNC_CONFIG" as const, expires_at: r.o_expires_at }]
          : []
      );
      return { outcome: "ok", commands };
    },
    async ack(deviceId, ack) {
      const { data, error } = await service.rpc("device_command_ack", {
        p_device_id: deviceId,
        p_command_id: ack.command_id,
        p_status: ack.status,
      });
      if (error) throw new Error("rpc_failed");
      const row = Array.isArray(data) ? data[0] : null;
      const o = row?.o_outcome;
      return { outcome: o === "acked" || o === "unchanged" || o === "expired" || o === "not_found" ? o : "inactive" };
    },
  };
}

Deno.serve((req) => {
  try {
    deps ??= build();
  } catch {
    return toErrorResponse(new Error("config"));
  }
  return handler(req, deps);
});
