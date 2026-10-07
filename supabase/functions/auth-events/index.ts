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
    async insertAudit(row) {
      const { error } = await service.from("audit_logs").insert(row);
      if (error) throw new Error("audit_insert_failed"); // details stay server-side
    },
  };
}

Deno.serve((req) => {
  try {
    deps ??= build();
  } catch {
    return toErrorResponse(new Error("config")); // misconfiguration -> sanitized 500
  }
  return handler(req, deps);
});
