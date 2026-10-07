"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DEVICE_TABS, deviceTabHref } from "@/lib/nav";
import { cn } from "@/lib/utils";

// Route-based sub-navigation (links, not ARIA tabs: each section is its own page).
export function DeviceTabs({ id }: { id: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Device sections" className="-mx-4 overflow-x-auto border-b px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1">
        {DEVICE_TABS.map((t) => {
          const href = deviceTabHref(id, t.slug);
          const active = pathname === href;
          return (
            <li key={t.slug}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-block whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
