import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Choose a new password" };

// Reachable only with a session (recovery link → /auth/confirm); middleware also requires MFA when enrolled.
export default function ResetPasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose a new password</CardTitle>
        <CardDescription>Other signed-in sessions will be signed out after this change.</CardDescription>
      </CardHeader>
      <CardContent>
        <ResetPasswordForm />
      </CardContent>
    </Card>
  );
}
