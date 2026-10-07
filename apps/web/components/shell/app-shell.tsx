import * as React from "react";
import type { Theme } from "@/lib/theme";
import { BreadcrumbLabelsProvider } from "./breadcrumb-labels";
import { Breadcrumbs } from "./breadcrumbs";
import { MobileNav } from "./mobile-nav";
import { Sidebar } from "./sidebar";
import { UserMenu } from "./user-menu";

// Authenticated layout chrome. Contains no data access: identity comes from the (app) layout's server-side guard.
export function AppShell({ email, theme, unread = null, children }: { email: string; theme: Theme; unread?: number | null; children: React.ReactNode }) {
  return (
    <BreadcrumbLabelsProvider>
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <Sidebar unread={unread} />
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background px-4 sm:px-6">
          <MobileNav unread={unread} />
          <div className="min-w-0 flex-1">
            <Breadcrumbs />
          </div>
          <UserMenu email={email} theme={theme} />
        </header>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl px-4 py-6 focus:outline-none sm:px-6 lg:py-8">
          {children}
        </main>
      </div>
    </div>
    </BreadcrumbLabelsProvider>
  );
}
