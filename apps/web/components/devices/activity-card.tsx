import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { describeEvent, activitySummary, nextLimit } from "@/lib/activity/activity";
import type { ActivityInput } from "@/lib/activity/queries";
import { formatLastSeen } from "@/lib/enrollment/format";

type Props = { activity: ActivityInput; deviceId: string; limit: number; now?: Date };

/** Timeline of what the device reported (Phase 20c-1). Presentational: every sentence comes from `lib/activity/activity`. */
export function ActivityCard({ activity, deviceId, limit, now = new Date() }: Props) {
  const lines = activity.events.map((e) => describeEvent(e, (pkg) => activity.labels.get(pkg) ?? null));
  const more = activity.hasMore ? nextLimit(limit) : null;
  return (
    <Card>
      <CardContent className="space-y-4 p-5" data-testid="activity-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Activity</h2>
          <p className="text-xs text-muted-foreground">{activitySummary(lines.length, activity.hasMore)}</p>
        </div>
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">Events such as the device going online or offline, a low battery, a permission change or an app being installed appear here.</p>
        ) : (
          <ul className="divide-y text-sm" aria-label="Device events, newest first">
            {lines.map((l) => (
              <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
                <div>
                  <p className={l.tone === "warning" ? "font-medium" : undefined}>{l.title}</p>
                  {l.detail ? <p className="text-muted-foreground">{l.detail}</p> : null}
                </div>
                <time className="text-xs text-muted-foreground" dateTime={l.at} title={l.at}>
                  {formatLastSeen(l.at, now)}
                </time>
              </li>
            ))}
          </ul>
        )}
        {more !== null ? (
          <Link className="text-sm font-medium underline underline-offset-4" href={`/devices/${deviceId}/activity?limit=${more}`}>
            Show more
          </Link>
        ) : null}
        <p className="text-xs text-muted-foreground">Events show what the device reported or what the service noticed, for example no check-in for a while. They do not say what the child did apart from the items listed. Nothing here is a live view.</p>
      </CardContent>
    </Card>
  );
}
