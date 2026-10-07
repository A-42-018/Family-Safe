import Link from "next/link";
import { ScheduleRowControls } from "@/components/devices/schedule-row-controls";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  atScheduleCap,
  SCHEDULE_CAP_NOTE,
  scheduleLine,
  SCHEDULES_NOTE,
  scheduleSummaryText,
  timezoneText,
  typeLabel,
  type ScheduleRow,
} from "@/lib/schedules/schedules";

/**
 * Read-only list of the device's schedules (Phase 19b). A server component: every sentence comes from `lib/schedules/schedules`,
 * and the only write controls are the per-row client components, mounted only when `editable` (enrolled device).
 * "Edit" is a plain link (`?edit=`), so it works without JS.
 */
export function SchedulesCard(props: {
  deviceId: string;
  schedules: readonly ScheduleRow[];
  timezone: string | null;
  editable: boolean;
  editingId: string | null;
}) {
  const { deviceId, schedules, timezone, editable, editingId } = props;
  return (
    <Card>
      <CardContent className="space-y-4 p-5" data-testid="schedules-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Schedules</h2>
          <p className="text-xs text-muted-foreground">{scheduleSummaryText(schedules)}</p>
        </div>
        <p className="text-sm text-muted-foreground">Times are read in: {timezoneText(timezone)}</p>
        {schedules.length === 0 ? (
          <p className="text-sm text-muted-foreground">No bedtime, school-time or custom schedules are set for this device.</p>
        ) : (
          <ul className="divide-y" aria-label="Schedules of this device">
            {schedules.map((s) => (
              <li key={s.id} className="space-y-2 py-3" data-testid="schedule-item">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{s.name}</span>
                  <Badge variant="outline">{typeLabel(s.type)}</Badge>
                  <Badge variant={s.enabled ? "secondary" : "outline"}>{s.enabled ? "On" : "Off"}</Badge>
                  {editingId === s.id ? <Badge>Editing</Badge> : null}
                </div>
                <p className="text-sm text-muted-foreground">{scheduleLine(s)}</p>
                {editable ? (
                  <div className="flex flex-wrap items-start gap-2">
                    <Link href={`/devices/${deviceId}/schedules?edit=${s.id}`} className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-accent">
                      Edit
                    </Link>
                    <ScheduleRowControls deviceId={deviceId} schedule={s} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {editable && atScheduleCap(schedules) ? <p className="text-xs text-muted-foreground">{SCHEDULE_CAP_NOTE}</p> : null}
        <p className="text-xs text-muted-foreground">{SCHEDULES_NOTE}</p>
      </CardContent>
    </Card>
  );
}
