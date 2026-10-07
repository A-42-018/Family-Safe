import { getEnv } from "../_shared/env.ts";
import { toErrorResponse } from "../_shared/errors.ts";
import { createParentVerifier, createServiceClient } from "../_shared/supabase.ts";
import { type Deps, handler } from "./handler.ts";

let deps: Deps | null = null;

function build(): Deps {
  const env = getEnv();
  const service = createServiceClient(env);
  return {
    allowedOrigins: env.ALLOWED_ORIGINS,
    verify: createParentVerifier(env),
    async revoke({ parentId, deviceId, ip }) {
      const { data, error } = await service.rpc("enrollment_revoke_device", { p_parent_id: parentId, p_device_id: deviceId, p_ip: ip });
      if (error) throw new Error("rpc_failed");
      return data === "revoked" || data === "already_revoked" ? data : null;
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
