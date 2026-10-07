import { getEnv } from "../_shared/env.ts";
import { toErrorResponse } from "../_shared/errors.ts";
import { toPgBytea } from "../_shared/enrollment.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { type Deps, handler } from "./handler.ts";

let deps: Deps | null = null;

function build(): Deps {
  const env = getEnv();
  const service = createServiceClient(env);
  return {
    allowedOrigins: env.ALLOWED_ORIGINS,
    pairingPepper: env.PAIRING_TOKEN_PEPPER,
    deviceJwtSecret: env.DEVICE_JWT_SECRET,
    async redeem(a) {
      const { data, error } = await service.rpc("enrollment_redeem", {
        p_token_hash: toPgBytea(a.tokenHash),
        p_device_name: a.deviceName,
        p_manufacturer: a.manufacturer ?? null,
        p_model: a.model ?? null,
        p_android_version: a.androidVersion ?? null,
        p_app_version: a.appVersion ?? null,
        p_refresh_hash: toPgBytea(a.refreshHash),
        p_refresh_ttl_seconds: a.refreshTtlSeconds,
      });
      if (error) throw new Error("rpc_failed"); // never echo DB details to the device
      const row = Array.isArray(data) ? data[0] : null;
      return row ? { deviceId: row.o_device_id as string, credentialId: row.o_credential_id as string } : null;
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
