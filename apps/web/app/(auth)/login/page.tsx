import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { safeNext } from "@/lib/auth/routes";

export const metadata: Metadata = { title: "Sign in" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function LoginPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const next = safeNext(one(sp.next), "");
  const notice = one(sp.error) === "invalid_link" ? "That link is invalid or has expired. Please try again." : undefined;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Access your family dashboard.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm next={next || undefined} notice={notice} />
      </CardContent>
    </Card>
  );
}
