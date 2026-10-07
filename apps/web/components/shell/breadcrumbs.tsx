"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { buildBreadcrumbs } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { useBreadcrumbLabels } from "./breadcrumb-labels";
import { Icon } from "./icons";

// On small screens only the current page is shown (it doubles as the page title); the full trail appears from sm up.
export function Breadcrumbs() {
  const crumbs = buildBreadcrumbs(usePathname(), useBreadcrumbLabels());
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex items-center gap-1 text-sm text-muted-foreground">
        {crumbs.map((c, i) => (
          <li key={`${i}-${c.label}`} className={cn("min-w-0 items-center gap-1", c.href ? "hidden sm:flex" : "flex")}>
            {i > 0 ? <Icon name="chevron-right" className="hidden h-4 w-4 sm:block" /> : null}
            {c.href ? (
              <Link href={c.href} className="rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{c.label}</Link>
            ) : (
              <span aria-current="page" className="truncate font-medium text-foreground">{c.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
