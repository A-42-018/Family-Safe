import Link from "next/link";
import { Icon } from "./icons";

export function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 rounded-md text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Icon name="shield" className="text-primary" />
      FamilySafe
    </Link>
  );
}
