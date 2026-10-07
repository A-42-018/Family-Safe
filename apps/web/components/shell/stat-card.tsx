import type { IconName } from "@/lib/nav";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "./icons";

/** Static placeholder until real data exists (no data access in Phase 6): shows a dash announced as "No data yet". */
export function StatCard({ label, icon, hint, value }: { label: string; icon: IconName; hint: string; value?: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">{label}</h2>
          <Icon name={icon} className="h-4 w-4 text-muted-foreground" />
        </div>
        <p className="mt-3 text-2xl font-semibold tabular-nums">
          {value ?? (
            <>
              <span aria-hidden="true">—</span>
              <span className="sr-only">No data yet</span>
            </>
          )}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}
