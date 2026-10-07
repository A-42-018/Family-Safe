import { getEnv } from "../_shared/env.ts";
import { toErrorResponse } from "../_shared/errors.ts";
import { toPgBytea } from "../_shared/enrollment.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { type Deps, handler, type RefreshOutcome } from "./handler.ts";

let deps: Deps | null = null;

function build(): Deps {
  const env = getEnv();
  const service = createServiceClient(env);
  return {
    allowedOrigins: env.ALLOWED_ORIGINS,
    deviceJwtSecret: env.DEVICE_JWT_SECRET,
    async refresh(a): Promise<RefreshOutcome> {
      const { data, error } = await service.rpc("device_refresh", {
        p_token_hash: toPgBytea(a.tokenHash),
        p_new_hash: toPgBytea(a.newHash),
        p_ttl_seconds: a.ttlSeconds,
      });
      if (error) throw new Error("rpc_failed"); // never echo DB details to the device
      const row = Array.isArray(data) ? data[0] : null;
      if (row?.o_outcome === "rotated" && typeof row.o_device_id === "string" && typeof row.o_credential_id === "string") {
        return { outcome: "rotated", deviceId: row.o_device_id, credentialId: row.o_credential_id };
      }
      return { outcome: row?.o_outcome === "reused" ? "reused" : "invalid" };
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
