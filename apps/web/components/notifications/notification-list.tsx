import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatLastSeen } from "@/lib/enrollment/format";
import { markAllReadAction, markReadAction } from "@/lib/notifications/actions";
import { describeNotification, nextNotificationsLimit, notificationsSummary } from "@/lib/notifications/notifications";
import type { NotificationsPage } from "@/lib/notifications/queries";
import { cn } from "@/lib/utils";

type Props = { page: NotificationsPage; unread: number | null; limit: number; now?: Date };

/** The notifications list (Phase 29b). Plain forms with Server Actions: no client JavaScript. Every sentence comes from `lib/notifications`. */
export function NotificationList({ page, unread, limit, now = new Date() }: Props) {
  const lines = page.rows.map(describeNotification);
  const unreadShown = lines.filter((l) => l.unread).length;
  const more = page.hasMore ? nextNotificationsLimit(limit) : null;
  return (
    <Card>
      <CardContent className="space-y-4 p-5" data-testid="notifications-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground" role="status" data-testid="notifications-summary">
            {notificationsSummary(lines.length, unread ?? unreadShown, page.hasMore)}
          </p>
          {(unread ?? unreadShown) > 0 ? (
            <form action={markAllReadAction}>
              <Button type="submit" variant="outline" size="sm">
                Mark all as read
              </Button>
            </form>
          ) : null}
        </div>
        {lines.length === 0 ? null : (
          <ul className="divide-y text-sm" aria-label="Notifications, newest first">
            {lines.map((l) => (
              <li key={l.id} className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3", l.unread ? "" : "text-muted-foreground")}>
                <div className="min-w-0">
                  <p className={cn(l.unread ? "font-semibold text-foreground" : "font-medium", l.tone === "urgent" ? "text-destructive" : undefined)}>
                    {l.unread ? <span className="sr-only">Unread: </span> : null}
                    {l.title}
                  </p>
                  {l.detail ? <p>{l.detail}</p> : null}
                  <time className="text-xs" dateTime={l.at} title={l.at}>
                    {formatLastSeen(l.at, now)}
                  </time>
                </div>
                {l.unread ? (
                  <form action={markReadAction}>
                    <input type="hidden" name="id" value={l.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Mark as read
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {more !== null ? (
          <Link className="text-sm font-medium underline underline-offset-4" href={`/notifications?limit=${more}`}>
            Show more
          </Link>
        ) : null}
        <p className="text-xs text-muted-foreground">Notifications are kept for 90 days. They say what happened, never what was on the device. You can choose which ones you get in Settings.</p>
      </CardContent>
    </Card>
  );
}
