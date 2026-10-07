import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { ageFromDob, deviceCountLabel, formatAge, initials } from "@/lib/family/format";
import type { ChildRow } from "@/lib/family/queries";

export function Avatar({ name, className = "h-12 w-12 text-base" }: { name: string; className?: string }) {
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary ${className}`}>
      {initials(name)}
    </span>
  );
}

export function ChildCard({ child }: { child: ChildRow }) {
  return (
    <Card className="transition-colors hover:bg-accent/40">
      <CardContent className="p-0">
        <Link
          href={`/children/${child.id}`}
          className="flex items-center gap-4 rounded-lg p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Avatar name={child.name} />
          <span className="min-w-0">
            <span className="block truncate font-medium">{child.name}</span>
            <span className="block text-sm text-muted-foreground">{formatAge(ageFromDob(child.dateOfBirth))}</span>
            <span className="block text-sm text-muted-foreground">{deviceCountLabel(child.deviceCount)}</span>
          </span>
        </Link>
      </CardContent>
    </Card>
  );
}
