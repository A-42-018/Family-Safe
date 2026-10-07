import type { Metadata } from "next";
import Link from "next/link";
import { ResendVerificationForm } from "@/components/auth/forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Verify your email" };

export default function VerifyEmailPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Check your email</CardTitle>
        <CardDescription>
          We sent a verification link. Open it to activate your account, then sign in. The link expires after a short time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ResendVerificationForm />
        <p className="text-center text-sm">
          <Link className="text-primary underline-offset-4 hover:underline" href="/login">Back to sign in</Link>
        </p>
      </CardContent>
    </Card>
  );
}
