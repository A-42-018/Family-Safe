// Typed, validated access to Edge Function secrets. Never log values.
import { z } from "zod";

const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DEVICE_JWT_SECRET: z.string().min(32, "DEVICE_JWT_SECRET must be >= 32 chars"),
  PAIRING_TOKEN_PEPPER: z.string().min(32, "PAIRING_TOKEN_PEPPER must be >= 32 chars"),
  FCM_SERVICE_ACCOUNT_JSON: z.string().optional(), // only `commands-dispatch` needs it (Phase 20a-3)
  CRON_SECRET: z.string().min(32, "CRON_SECRET must be >= 32 chars").optional(), // shared with the scheduler that calls `commands-dispatch`
  ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/** Parse env once. Throws with variable NAMES only (never values). */
export function getEnv(source?: Record<string, string | undefined>): Env {
  if (!source && cached) return cached;
  const parsed = EnvSchema.safeParse(source ?? Deno.env.toObject());
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ");
    throw new Error(`Invalid or missing environment variables: ${names}`);
  }
  if (!source) cached = parsed.data;
  return parsed.data;
}

/** Health check only needs to know whether secrets are configured, not their values. */
export function envStatus(source: Record<string, string | undefined> = Deno.env.toObject()): { ok: boolean; missing: string[] } {
  const parsed = EnvSchema.safeParse(source);
  if (parsed.success) return { ok: true, missing: [] };
  return { ok: false, missing: [...new Set(parsed.error.issues.map((i) => i.path.join(".")))] };
}

export function resetEnvCache(): void {
  cached = null;
}
