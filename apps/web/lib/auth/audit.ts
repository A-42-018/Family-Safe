import type { PublicEnv } from "@/lib/env";

export type LoginMethod = "password" | "mfa_totp";

/**
 * LOGIN audit rows are written by the `auth-events` Edge Function using the service role. This server-side call
 * forwards the user's own access token (verified there); the browser never calls it and never sees a service key.
 */
export function createAuditRecorder(
  env: Pick<PublicEnv, "supabaseUrl" | "anonKey">,
  ip: string,
  fetchImpl: typeof fetch = fetch,
) {
  return async ({ accessToken, method }: { accessToken: string; method: LoginMethod }): Promise<void> => {
    const res = await fetchImpl(`${env.supabaseUrl}/functions/v1/auth-events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
        apikey: env.anonKey,
        ...(ip && ip !== "unknown" ? { "x-forwarded-for": ip } : {}),
      },
      body: JSON.stringify({ event: "LOGIN", method }),
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`audit_http_${res.status}`);
  };
}
