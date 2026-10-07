import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { parseTheme, THEME_COOKIE, THEMES } from "@/lib/theme";
import { setThemeAction } from "@/lib/theme-actions";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };

const LABELS = { system: "System", light: "Light", dark: "Dark" } as const;

export default async function SettingsPage() {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <>
      <PageHeader title="Settings" description="Your account and how the dashboard looks." />
      <div className="grid max-w-3xl gap-4">
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="text-lg">Security</CardTitle>
            <CardDescription>Add two-step verification to protect your family&apos;s data.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline"><Link href="/settings/security">Manage security</Link></Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="text-lg">Appearance</CardTitle>
            <CardDescription>System follows your device&apos;s light or dark setting.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={setThemeAction} role="group" aria-label="Theme" className="inline-flex rounded-md border p-1">
              {THEMES.map((t) => (
                <button
                  key={t}
                  type="submit"
                  name="theme"
                  value={t}
                  aria-pressed={theme === t}
                  className={cn("rounded-sm px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", theme === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {LABELS[t]}
                </button>
              ))}
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
