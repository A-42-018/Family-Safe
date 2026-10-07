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
    async getConfig(deviceId) {
      const { data, error } = await service.rpc("device_get_config", { p_device_id: deviceId });
      if (error) throw new Error("rpc_failed"); // never echo DB details to the device
      const row = Array.isArray(data) ? data[0] : null;
      if (!row || row.o_outcome !== "ok") return { outcome: "inactive" };
      return {
        outcome: "ok",
        config: {
          config_version: row.o_config_version,
          daily_limit_minutes: row.o_daily_limit_minutes,
          daily_limit_overrides: row.o_daily_limit_overrides,
          bedtime_enabled: row.o_bedtime_enabled,
          bedtime_start: row.o_bedtime_start,
          bedtime_end: row.o_bedtime_end,
          school_mode_enabled: row.o_school_mode_enabled,
          app_rules: row.o_app_rules,
          timezone: row.o_timezone,
          schedules: row.o_schedules,
        },
      };
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
