import type { Metadata } from "next";
import { TotpEnrollment } from "@/components/auth/forms";
import { PageHeader } from "@/components/shell/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { unenrollTotpAction } from "@/lib/auth/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.mfa.listFactors();
  const factors = data?.totp ?? [];
  return (
    <div className="max-w-xl space-y-4">
      <PageHeader title="Security" description="Protect access to your family's data." />
      {sp.error === "unenroll" ? <Alert variant="destructive">We couldn&apos;t remove the authenticator. Verify a code first, then try again.</Alert> : null}
      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-lg">Two-step verification</CardTitle>
          <CardDescription>Protect access to your family&apos;s data with an authenticator app (optional, recommended).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {factors.length === 0 ? (
            <TotpEnrollment />
          ) : (
            factors.map((f) => (
              <form key={f.id} action={unenrollTotpAction} className="flex items-center justify-between gap-4">
                <span className="text-sm">Authenticator app is <strong>on</strong>.</span>
                <input type="hidden" name="factorId" value={f.id} />
                <Button type="submit" variant="destructive" size="sm">Turn off</Button>
              </form>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
