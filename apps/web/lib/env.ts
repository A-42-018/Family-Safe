// Browser-safe configuration only (NEXT_PUBLIC_*). Literal property access is required so Next can inline values.
import { z } from "zod";

const PublicEnvSchema = z.object({
  supabaseUrl: z.string().url(),
  anonKey: z.string().min(1),
  appUrl: z.string().url(),
});

export type PublicEnv = z.infer<typeof PublicEnvSchema>;

/** Throws with variable NAMES only, never values. */
export function getPublicEnv(): PublicEnv {
  const parsed = PublicEnvSchema.safeParse({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    appUrl: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  });
  if (!parsed.success) {
    const names = { supabaseUrl: "NEXT_PUBLIC_SUPABASE_URL", anonKey: "NEXT_PUBLIC_SUPABASE_ANON_KEY", appUrl: "NEXT_PUBLIC_APP_URL" } as const;
    const bad = [...new Set(parsed.error.issues.map((i) => names[i.path[0] as keyof typeof names] ?? String(i.path[0])))];
    throw new Error(`Invalid or missing environment variables: ${bad.join(", ")}`);
  }
  return parsed.data;
}
