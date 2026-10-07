// Supabase client factories for Edge Functions. Kept separate so pure logic (auth.ts) stays testable offline.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./env.ts";
import type { ParentTokenVerifier } from "./auth.ts";

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;

/** Service-role client (bypasses RLS). Server-side only; never returned to callers. */
export function createServiceClient(env: Pick<Env, "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY">): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, NO_SESSION);
}

/** Verifies parent access tokens with the Auth server (`auth.getUser(jwt)` — also detects revoked sessions). */
export function createParentVerifier(env: Pick<Env, "SUPABASE_URL" | "SUPABASE_ANON_KEY">): ParentTokenVerifier {
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, NO_SESSION);
  return async (token) => {
    const { data, error } = await client.auth.getUser(token);
    if (error) {
      // 4xx = the token itself is bad; anything else is an Auth outage and must not read as "unauthorized".
      const status = (error as { status?: number }).status;
      if (typeof status === "number" && status >= 400 && status < 500) return null;
      if (error.name === "AuthSessionMissingError" || error.name === "AuthInvalidJwtError") return null;
      throw new Error("auth_verify_unavailable");
    }
    return data.user ? { id: data.user.id, email: data.user.email ?? undefined } : null;
  };
}

/** Live credential check for device requests (`device_authorize`). An RPC failure throws — never "valid". */
export function createDeviceAuthorizer(service: SupabaseClient): (deviceId: string, credentialId: string) => Promise<boolean> {
  return async (deviceId, credentialId) => {
    const { data, error } = await service.rpc("device_authorize", { p_device_id: deviceId, p_credential_id: credentialId });
    if (error) throw new Error("device_authorize_unavailable");
    return data === true;
  };
}
