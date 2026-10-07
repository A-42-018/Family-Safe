import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MfaChallengeForm } from "@/components/auth/forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { safeNext } from "@/lib/auth/routes";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Two-step verification" };

export default async function MfaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const rawNext = Array.isArray(sp.next) ? sp.next[0] : sp.next;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.mfa.listFactors();
  const factor = data?.totp[0]; // verified TOTP factors only
  if (!factor) redirect("/dashboard");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Two-step verification</CardTitle>
        <CardDescription>Enter the 6-digit code from your authenticator app.</CardDescription>
      </CardHeader>
      <CardContent>
        <MfaChallengeForm factorId={factor.id} next={safeNext(rawNext, "")} />
      </CardContent>
    </Card>
  );
}
