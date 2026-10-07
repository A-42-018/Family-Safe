"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { FormMessage } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveAppRuleAction } from "@/lib/apps/actions";
import { FIELD, MINUTES_HINT, type RestrictionState } from "@/lib/apps/restrictions";
import type { FormState } from "@/lib/auth/form-state";

const INITIAL: FormState = {};

function IntentButton({ intent, children, variant = "outline" }: { intent: "block" | "limit" | "clear"; children: React.ReactNode; variant?: "outline" | "destructive" | "default" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} name={FIELD.intent} value={intent} disabled={pending}>
      {children}
    </Button>
  );
}

/**
 * Block / limit / remove for ONE app. Posts through the Server Action; works without JS. The minutes box comes first and the
 * "limit" button is the first submit button, so pressing Enter in the box sets a limit and can never block an app by accident.
 */
export function AppRuleControls({ deviceId, packageName, label, state }: { deviceId: string; packageName: string; label: string; state: RestrictionState }) {
  const [result, action] = useActionState(saveAppRuleAction, INITIAL);
  const id = `limit-${packageName}`;
  const error = result.fieldErrors?.[FIELD.minutes]?.[0];
  return (
    <form action={action} className="space-y-2" noValidate data-testid="app-rule-form">
      <input type="hidden" name={FIELD.deviceId} value={deviceId} />
      <input type="hidden" name={FIELD.packageName} value={packageName} />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          name={FIELD.minutes}
          type="text"
          inputMode="numeric"
          maxLength={4}
          autoComplete="off"
          placeholder="Minutes"
          className="h-9 w-24"
          aria-label={`Daily limit in minutes for ${label}`}
          defaultValue={state.kind === "limited" && state.minutes > 0 ? String(state.minutes) : (result.values?.[FIELD.minutes] ?? "")}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <IntentButton intent="limit">{state.kind === "limited" ? "Change limit" : "Set limit"}</IntentButton>
        {state.kind !== "blocked" ? <IntentButton intent="block">Block</IntentButton> : null}
        {state.kind !== "none" ? <IntentButton intent="clear">{state.kind === "blocked" ? "Unblock" : "Remove limit"}</IntentButton> : null}
      </div>
      {error ? <p id={`${id}-error`} className="text-xs text-destructive">{error}</p> : <p className="sr-only">{MINUTES_HINT}</p>}
      <FormMessage state={result} />
    </form>
  );
}
