import { confirmLinkSchema } from "@familysafe/contracts";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { safeNext } from "@/lib/auth/routes";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Email links (signup confirmation, password recovery) land here: token_hash -> session -> redirect.
// Works across browsers (no PKCE verifier cookie needed). All failure modes look identical.
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const parsed = confirmLinkSchema.safeParse({
    token_hash: sp.get("token_hash") ?? "",
    type: sp.get("type") ?? "",
    next: sp.get("next") ?? undefined,
  });
  if (!parsed.success) redirect("/login?error=invalid_link");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ type: parsed.data.type, token_hash: parsed.data.token_hash });
  if (error) redirect("/login?error=invalid_link");

  // Recovery always goes to the password form; `next` is honoured only for same-origin paths.
  redirect(parsed.data.type === "recovery" ? "/reset-password" : safeNext(parsed.data.next));
}
