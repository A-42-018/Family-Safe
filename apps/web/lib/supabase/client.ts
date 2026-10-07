"use client";
// Browser client. Not used for auth (session cookies are HttpOnly and handled server-side); reserved for
// non-session use such as future public reads. Anon key only.
import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createBrowserClient(url, anon);
}
