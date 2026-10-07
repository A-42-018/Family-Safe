import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { needsMfa } from "@/lib/auth/routes";
import { loadUnreadCount } from "@/lib/notifications/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";

// Defense in depth: middleware already gates these routes; this re-verifies on the server for every render.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");
  if (!data.user.email_confirmed_at) redirect("/verify-email");
  const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal.data && needsMfa({ user: { id: data.user.id, emailConfirmed: true }, aal: { current: aal.data.currentLevel, next: aal.data.nextLevel } })) {
    redirect("/mfa");
  }

  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <AppShell email={data.user.email ?? "Account"} theme={theme} unread={await loadUnreadCount()}>
      {children}
    </AppShell>
  );
}
