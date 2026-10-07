"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Separator } from "@/components/ui/separator";
import { signOutAction } from "@/lib/auth/actions";
import { nextMenuIndex } from "@/lib/menu-keys";
import { type IconName } from "@/lib/nav";
import { THEMES, type Theme } from "@/lib/theme";
import { setThemeAction } from "@/lib/theme-actions";
import { cn } from "@/lib/utils";
import { Icon } from "./icons";

const ITEM = "flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none";
const THEME_META: Record<Theme, { label: string; icon: IconName }> = {
  system: { label: "System", icon: "monitor" },
  light: { label: "Light", icon: "sun" },
  dark: { label: "Dark", icon: "moon" },
};

export function UserMenu({ email, theme }: { email: string; theme: Theme }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(true); return; }
    if (e.key === "Tab") { close(false); return; }
    const list = items();
    const next = nextMenuIndex(list.indexOf(document.activeElement as HTMLElement), list.length, e.key);
    if (next !== null) { e.preventDefault(); list[next]?.focus(); }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="user-menu"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); } }}
        className="flex h-10 w-10 items-center justify-center rounded-full border bg-secondary text-sm font-semibold text-secondary-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden="true">{(email.trim()[0] ?? "?").toUpperCase()}</span>
      </button>

      {open ? (
        <div id="user-menu" ref={menuRef} role="menu" aria-label="Account" onKeyDown={onMenuKeyDown} className="absolute right-0 z-50 mt-2 w-64 rounded-md border bg-card p-1 text-card-foreground shadow-md">
          <div className="px-3 py-2">
            <p className="text-xs text-muted-foreground">Signed in as</p>
            <p className="truncate text-sm font-medium" title={email}>{email}</p>
          </div>
          <Separator className="my-1" />
          <Link href="/settings/security" role="menuitem" tabIndex={-1} className={ITEM}>
            <Icon name="lock" className="h-4 w-4" /> Security
          </Link>
          <Link href="/settings" role="menuitem" tabIndex={-1} className={ITEM}>
            <Icon name="settings" className="h-4 w-4" /> Settings
          </Link>
          <Separator className="my-1" />
          <form action={setThemeAction} role="group" aria-label="Theme">
            {THEMES.map((t) => (
              <button key={t} type="submit" name="theme" value={t} role="menuitemradio" aria-checked={theme === t} tabIndex={-1} className={cn(ITEM, theme === t && "font-medium")}>
                <Icon name={THEME_META[t].icon} className="h-4 w-4" />
                <span className="flex-1">{THEME_META[t].label}</span>
                {theme === t ? <Icon name="check" className="h-4 w-4" /> : null}
              </button>
            ))}
          </form>
          <Separator className="my-1" />
          <form action={signOutAction}>
            <button type="submit" role="menuitem" tabIndex={-1} className={ITEM}>
              <Icon name="logout" className="h-4 w-4" /> Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
