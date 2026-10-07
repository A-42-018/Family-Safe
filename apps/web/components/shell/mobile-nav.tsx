"use client";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Brand } from "./brand";
import { Icon } from "./icons";
import { NavLinks } from "./nav-links";

// Drawer built on the native <dialog>: showModal() gives a focus trap, inert background, Escape-to-close and focus
// restore for free, with no extra dependency and no inline scripts.
export function MobileNav({ unread = null }: { unread?: number | null }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const close = useCallback(() => dialogRef.current?.close(), []);
  const show = () => {
    dialogRef.current?.showModal();
    setOpen(true);
    closeRef.current?.focus();
  };

  useEffect(() => close(), [pathname, close]); // close after navigation

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)"); // the sidebar takes over at lg
    const onChange = () => { if (mq.matches) close(); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [close]);

  useEffect(() => {
    document.body.classList.toggle("overflow-hidden", open);
    return () => document.body.classList.remove("overflow-hidden");
  }, [open]);

  return (
    <>
      <Button type="button" variant="ghost" className="h-10 w-10 shrink-0 p-0 lg:hidden" aria-label="Open menu" aria-haspopup="dialog" aria-expanded={open} aria-controls="mobile-nav" onClick={show}>
        <Icon name="menu" />
      </Button>
      <dialog
        id="mobile-nav"
        ref={dialogRef}
        aria-label="Navigation menu"
        onClose={() => setOpen(false)}
        onClick={(e) => { if (e.target === e.currentTarget) close(); }} // click on the backdrop
        className="fixed inset-y-0 left-0 m-0 h-full max-h-none w-72 max-w-[85vw] flex-col border-r bg-card p-0 text-foreground open:flex backdrop:bg-black/50"
      >
        <div className="flex h-14 items-center justify-between border-b px-4">
          <Brand />
          <Button ref={closeRef} type="button" variant="ghost" className="h-10 w-10 p-0" aria-label="Close menu" onClick={close}>
            <Icon name="close" />
          </Button>
        </div>
        <nav aria-label="Main" className="flex-1 overflow-y-auto p-3">
          <NavLinks onNavigate={close} unread={unread} />
        </nav>
      </dialog>
    </>
  );
}
