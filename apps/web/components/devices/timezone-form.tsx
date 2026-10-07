"use client";
import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/auth/form-parts";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/auth/form-state";
import { setTimezoneAction } from "@/lib/schedules/actions";
import { DEVICE_ZONE_LABEL, FIELD, timezoneOptions } from "@/lib/schedules/schedules";

const INITIAL: FormState = {};
const SELECT_CLASS =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

/** Pick the time zone the schedule times are read in. A fixed list (no free text); empty = the phone's own zone. */
export function TimezoneForm({ deviceId, current }: { deviceId: string; current: string | null }) {
  const [state, action] = useActionState(setTimezoneAction, INITIAL);
  const selected = state.values?.[FIELD.timezone] ?? current ?? "";
  const error = state.fieldErrors?.[FIELD.timezone]?.[0];
  return (
    <form action={action} className="space-y-3" noValidate data-testid="timezone-form">
      <input type="hidden" name={FIELD.deviceId} value={deviceId} />
      <FormMessage state={state} />
      <div className="space-y-2">
        <Label htmlFor="schedule-timezone">Time zone</Label>
        <select id="schedule-timezone" name={FIELD.timezone} className={SELECT_CLASS} defaultValue={selected} aria-invalid={error ? true : undefined} aria-describedby={error ? "schedule-timezone-error" : undefined}>
          <option value="">{DEVICE_ZONE_LABEL}</option>
          {timezoneOptions(current).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {error ? <p id="schedule-timezone-error" className="text-xs text-destructive">{error}</p> : null}
      </div>
      <SubmitButton pendingText="Saving…">Save time zone</SubmitButton>
    </form>
  );
}
