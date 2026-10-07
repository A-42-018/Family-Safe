import type { Metadata } from "next";
import { cookies } from "next/headers";
import { parseTheme, themeClass, THEME_COOKIE } from "@/lib/theme";
import "./globals.css";

// Nonce-based CSP requires per-request rendering (the nonce is minted in middleware).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "FamilySafe", template: "%s · FamilySafe" },
  description: "Transparent, consent-based family safety dashboard.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Theme comes from a server-set cookie (no inline script needed); "system" adds no class and CSS follows the OS.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en" className={themeClass(theme)}>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
