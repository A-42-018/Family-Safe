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
    async record(deviceId, beat) {
      const { data, error } = await service.rpc("device_heartbeat", {
        p_device_id: deviceId,
        p_app_version: beat.app_version,
        p_android_version: beat.android_version,
        p_battery_level: beat.battery_level,
        p_is_charging: beat.is_charging,
        p_network_type: beat.network_type,
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
