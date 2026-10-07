"use client";
import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { FormMessage } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/auth/form-state";
import { SCHEDULE_NAME_MAX, SCHEDULE_TYPES } from "@familysafe/contracts";
import { saveScheduleAction } from "@/lib/schedules/actions";
import {
  DAY_NAMES,
  FIELD,
  findOverlap,
  OVERLAP_MESSAGE,
  OVERNIGHT_NOTE,
  parseScheduleForm,
  scheduleLine,
  TYPE_LABELS,
  TYPES_NOTE,
  type ScheduleRow,
} from "@/lib/schedules/schedules";

const INITIAL: FormState = {};
const SELECT_CLASS =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function SaveButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : children}
    </Button>
  );
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return message ? <p id={id} className="text-xs text-destructive">{message}</p> : null;
}

/**
 * Create (`scheduleId` null) or edit one schedule. Posts through the Server Action and works without JS. There is exactly one
 * submit button, so Enter can only save. When the database answers "overlap", the clash is named from the schedules already on
 * the page (a hint only: SQL decides).
 */
export function ScheduleForm(props: {
  deviceId: string;
  scheduleId: string | null;
  initial: Record<string, string>;
  /** The device's other schedules, used only to name an overlap after the database reported one. */
  existing: readonly ScheduleRow[];
  cancelHref?: string;
}) {
  const { deviceId, scheduleId, initial, existing, cancelHref } = props;
  const [state, action] = useActionState(saveScheduleAction, INITIAL);
  const value = (name: string): string => state.values?.[name] ?? initial[name] ?? "";
  const errors = state.fieldErrors ?? {};

  let clash: ScheduleRow | null = null;
  if (!state.ok && state.message === OVERLAP_MESSAGE && state.values) {
    const parsed = parseScheduleForm({ ...state.values, [FIELD.deviceId]: deviceId, [FIELD.scheduleId]: scheduleId ?? "" });
    if (parsed.ok) {
      clash = findOverlap(
        { id: scheduleId, type: parsed.input.type, days: parsed.input.days, startTime: parsed.input.start_time, endTime: parsed.input.end_time, enabled: parsed.input.enabled },
        existing,
      );
    }
  }

  return (
    <form action={action} className="space-y-5" noValidate data-testid="schedule-form">
      <input type="hidden" name={FIELD.deviceId} value={deviceId} />
      <input type="hidden" name={FIELD.scheduleId} value={scheduleId ?? ""} />
      <FormMessage state={state} />
      {clash ? <p className="text-xs text-muted-foreground">Overlaps with &ldquo;{clash.name}&rdquo; ({scheduleLine(clash)}).</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="schedule-name">Name</Label>
          <Input
            id="schedule-name"
            name={FIELD.name}
            type="text"
            maxLength={SCHEDULE_NAME_MAX}
            autoComplete="off"
            defaultValue={value(FIELD.name)}
            aria-invalid={errors[FIELD.name] ? true : undefined}
            aria-describedby={errors[FIELD.name] ? "schedule-name-error" : undefined}
          />
          <FieldError id="schedule-name-error" message={errors[FIELD.name]?.[0]} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="schedule-type">Type</Label>
          <select id="schedule-type" name={FIELD.type} className={SELECT_CLASS} defaultValue={value(FIELD.type)}>
            {SCHEDULE_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
          <FieldError id="schedule-type-error" message={errors[FIELD.type]?.[0]} />
        </div>
      </div>

      <fieldset className="space-y-2" aria-describedby={errors[FIELD.days] ? "schedule-days-error" : undefined}>
        <legend className="text-sm font-medium">Days</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {DAY_NAMES.map((label, i) => {
            const iso = i + 1;
            return (
              <label key={iso} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={FIELD.day(iso)} value="on" defaultChecked={value(FIELD.day(iso)) === "on"} className="h-4 w-4 rounded border-input" />
                {label}
              </label>
            );
          })}
        </div>
        <FieldError id="schedule-days-error" message={errors[FIELD.days]?.[0]} />
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="schedule-start">Starts</Label>
          <Input id="schedule-start" name={FIELD.start} type="time" step={60} defaultValue={value(FIELD.start)} aria-invalid={errors[FIELD.start] ? true : undefined} aria-describedby={errors[FIELD.start] ? "schedule-start-error" : undefined} />
          <FieldError id="schedule-start-error" message={errors[FIELD.start]?.[0]} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="schedule-end">Ends</Label>
          <Input id="schedule-end" name={FIELD.end} type="time" step={60} defaultValue={value(FIELD.end)} aria-invalid={errors[FIELD.end] ? true : undefined} aria-describedby={errors[FIELD.end] ? "schedule-end-error" : undefined} />
          <FieldError id="schedule-end-error" message={errors[FIELD.end]?.[0]} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{OVERNIGHT_NOTE} {TYPES_NOTE}</p>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name={FIELD.enabled} value="on" defaultChecked={value(FIELD.enabled) === "on"} className="h-4 w-4 rounded border-input" />
        Schedule is on
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <SaveButton>{scheduleId === null ? "Add schedule" : "Save changes"}</SaveButton>
        {cancelHref ? <Link href={cancelHref} className="text-sm text-muted-foreground underline underline-offset-4">Cancel</Link> : null}
      </div>
    </form>
  );
}
