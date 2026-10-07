import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicEnv } from "@/lib/env";
import { sessionCookieOptions } from "./cookies";

/** One client per request (never share across requests). */
export async function createSupabaseServerClient() {
  const store = await cookies();
  const env = getPublicEnv();
  return createServerClient(env.supabaseUrl, env.anonKey, {
    cookieOptions: sessionCookieOptions,
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are read-only there; middleware refreshes the session.
        }
      },
    },
  });
}
