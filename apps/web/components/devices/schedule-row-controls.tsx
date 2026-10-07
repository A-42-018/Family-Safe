"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { FormMessage } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/form-state";
import { deleteScheduleAction, saveScheduleAction } from "@/lib/schedules/actions";
import { FIELD, type ScheduleRow } from "@/lib/schedules/schedules";

const INITIAL: FormState = {};

function PendingButton({ children, variant = "outline" }: { children: React.ReactNode; variant?: "outline" | "destructive" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {children}
    </Button>
  );
}

/**
 * Turn ONE schedule on or off, and delete it. Both post through Server Actions and work without JS.
 * The toggle re-sends the stored values (the database treats a save as a full replace); `enabled` is sent only when turning on.
 * Delete sits behind a native <details> confirmation, so a single stray click can't remove a schedule.
 */
export function ScheduleRowControls({ deviceId, schedule }: { deviceId: string; schedule: ScheduleRow }) {
  const [toggled, toggle] = useActionState(saveScheduleAction, INITIAL);
  const [deleted, remove] = useActionState(deleteScheduleAction, INITIAL);
  return (
    <div className="space-y-2" data-testid="schedule-row-controls">
      <div className="flex flex-wrap items-start gap-2">
        <form action={toggle} data-testid="schedule-toggle-form">
          <input type="hidden" name={FIELD.deviceId} value={deviceId} />
          <input type="hidden" name={FIELD.scheduleId} value={schedule.id} />
          <input type="hidden" name={FIELD.name} value={schedule.name} />
          <input type="hidden" name={FIELD.type} value={schedule.type} />
          <input type="hidden" name={FIELD.start} value={schedule.startTime} />
          <input type="hidden" name={FIELD.end} value={schedule.endTime} />
          {schedule.days.map((d) => <input key={d} type="hidden" name={FIELD.day(d)} value="on" />)}
          {schedule.enabled ? null : <input type="hidden" name={FIELD.enabled} value="on" />}
          <PendingButton>{schedule.enabled ? "Turn off" : "Turn on"}</PendingButton>
        </form>
        <details className="rounded-md border px-3 py-1.5 text-sm">
          <summary className="cursor-pointer select-none">Delete</summary>
          <form action={remove} className="mt-2 flex flex-wrap items-center gap-2" data-testid="schedule-delete-form">
            <input type="hidden" name={FIELD.deviceId} value={deviceId} />
            <input type="hidden" name={FIELD.scheduleId} value={schedule.id} />
            <span className="text-muted-foreground">Delete this schedule?</span>
            <PendingButton variant="destructive">Yes, delete</PendingButton>
          </form>
        </details>
      </div>
      <FormMessage state={toggled} />
      <FormMessage state={deleted} />
    </div>
  );
}
