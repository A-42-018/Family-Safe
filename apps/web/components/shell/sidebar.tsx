import { Brand } from "./brand";
import { NavLinks } from "./nav-links";

/** Desktop navigation (≥ lg). Below lg the same links live in <MobileNav />. */
export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r bg-card lg:flex">
      <div className="flex h-14 items-center border-b px-4">
        <Brand />
      </div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto p-3">
        <NavLinks />
      </nav>
    </aside>
  );
}
