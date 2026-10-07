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
    async record(deviceId, info) {
      const { data, error } = await service.rpc("device_update_info", {
        p_device_id: deviceId,
        p_sdk_level: info.sdk_level,
        p_security_patch: info.security_patch,
        p_storage_total_mb: info.storage_total_mb,
        p_storage_free_mb: info.storage_free_mb,
      });
      if (error) throw new Error("rpc_failed"); // never echo DB details to the device
      const row = Array.isArray(data) ? data[0] : null;
      return { outcome: row?.o_outcome === "recorded" ? "recorded" : "inactive" };
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
