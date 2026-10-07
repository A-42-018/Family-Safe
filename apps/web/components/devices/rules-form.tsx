"use client";
import { useActionState, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/auth/form-parts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/auth/form-state";
import { saveScreenTimeRulesAction } from "@/lib/rules/actions";
import { FIELD, MINUTES_HINT, WEEKDAYS } from "@/lib/rules/rules";

const INITIAL: FormState = {};
const SELECT_CLASS =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const DEFAULT_OPTIONS = [
  { value: "off", label: "No daily limit" },
  { value: "limit", label: "Limit" },
  { value: "zero", label: "No screen time" },
] as const;
const DAY_OPTIONS = [
  { value: "default", label: "Same as the default" },
  { value: "limit", label: "Limit" },
  { value: "zero", label: "No screen time" },
] as const;

function LimitRow(props: {
  id: string;
  label: string;
  modeName: string;
  minutesName: string;
  options: readonly { value: string; label: string }[];
  mode: string;
  onMode: (value: string) => void;
  minutesValue: string;
  error: string | undefined;
}) {
  const { id, label, modeName, minutesName, options, mode, onMode, minutesValue, error } = props;
  const limited = mode === "limit";
  return (
    <div className="grid gap-2 sm:grid-cols-[10rem_1fr_9rem] sm:items-start">
      <Label htmlFor={`${id}-mode`} className="sm:pt-2.5">{label}</Label>
      <select id={`${id}-mode`} name={modeName} className={SELECT_CLASS} value={mode} onChange={(e) => onMode(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <div>
        <Input
          id={`${id}-minutes`}
          name={minutesName}
          type="text"
          inputMode="numeric"
          maxLength={4}
          autoComplete="off"
          placeholder="Minutes"
          aria-label={`${label}: minutes`}
          disabled={!limited}
          defaultValue={minutesValue}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        {error ? <p id={`${id}-error`} className="mt-1 text-xs text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}

/** Editor for the default daily limit and the seven per-weekday overrides. Works without JS except the minutes boxes being disabled. */
export function RulesForm({ deviceId, initial }: { deviceId: string; initial: Record<string, string> }) {
  const [state, action] = useActionState(saveScreenTimeRulesAction, INITIAL);
  const value = (name: string): string => state.values?.[name] ?? initial[name] ?? "";
  const [modes, setModes] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = { [FIELD.defaultMode]: initial[FIELD.defaultMode] ?? "off" };
    for (const { iso } of WEEKDAYS) m[FIELD.dayMode(iso)] = initial[FIELD.dayMode(iso)] ?? "default";
    return m;
  });
  const setMode = (name: string) => (v: string) => setModes((prev) => ({ ...prev, [name]: v }));
  return (
    <form action={action} className="space-y-6" noValidate data-testid="rules-form">
      <input type="hidden" name={FIELD.deviceId} value={deviceId} />
      <FormMessage state={state} />
      <div className="space-y-3">
        <h3 className="text-sm font-medium">Default daily limit</h3>
        <LimitRow
          id="default"
          label="Every day"
          modeName={FIELD.defaultMode}
          minutesName={FIELD.defaultMinutes}
          options={DEFAULT_OPTIONS}
          mode={modes[FIELD.defaultMode] ?? "off"}
          onMode={setMode(FIELD.defaultMode)}
          minutesValue={value(FIELD.defaultMinutes)}
          error={state.fieldErrors?.[FIELD.defaultMinutes]?.[0]}
        />
        <p className="text-xs text-muted-foreground">{MINUTES_HINT}</p>
      </div>
      <div className="space-y-3">
        <h3 className="text-sm font-medium">Different limit on some days</h3>
        {WEEKDAYS.map(({ iso, label }) => (
          <LimitRow
            key={iso}
            id={`day-${iso}`}
            label={label}
            modeName={FIELD.dayMode(iso)}
            minutesName={FIELD.dayMinutes(iso)}
            options={DAY_OPTIONS}
            mode={modes[FIELD.dayMode(iso)] ?? "default"}
            onMode={setMode(FIELD.dayMode(iso))}
            minutesValue={value(FIELD.dayMinutes(iso))}
            error={state.fieldErrors?.[FIELD.dayMinutes(iso)]?.[0]}
          />
        ))}
      </div>
      <SubmitButton pendingText="Saving…">Save limits</SubmitButton>
    </form>
  );
}
