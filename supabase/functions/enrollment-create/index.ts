import { getEnv } from "../_shared/env.ts";
import { toErrorResponse } from "../_shared/errors.ts";
import { toPgBytea } from "../_shared/enrollment.ts";
import { createParentVerifier, createServiceClient } from "../_shared/supabase.ts";
import { type Deps, handler } from "./handler.ts";

let deps: Deps | null = null;

function build(): Deps {
  const env = getEnv();
  const service = createServiceClient(env);
  return {
    allowedOrigins: env.ALLOWED_ORIGINS,
    verify: createParentVerifier(env),
    pairingPepper: env.PAIRING_TOKEN_PEPPER,
    async createToken({ parentId, childId, tokenHash, ttlSeconds }) {
      const { data, error } = await service.rpc("enrollment_create_token", {
        p_parent_id: parentId, p_child_id: childId, p_token_hash: toPgBytea(tokenHash), p_ttl_seconds: ttlSeconds,
      });
      if (error) throw new Error("rpc_failed"); // details stay server-side
      return typeof data === "string" ? data : null;
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
