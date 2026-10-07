"use client";
import { useFormStatus } from "react-dom";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/auth/form-state";

export function SubmitButton({ children, pendingText = "Please wait…", variant }: { children: React.ReactNode; pendingText?: string; variant?: "default" | "outline" | "destructive" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending} variant={variant}>
      {pending ? pendingText : children}
    </Button>
  );
}

export function FormMessage({ state }: { state: FormState }) {
  if (!state.message) return null;
  return <Alert variant={state.ok ? "success" : "destructive"}>{state.message}</Alert>;
}

export function Field({
  id, label, type = "text", autoComplete, state, defaultValue, inputMode, maxLength, hint, required = true,
}: {
  id: string; label: string; type?: string; autoComplete?: string; state: FormState; defaultValue?: string;
  inputMode?: "numeric" | "text" | "email"; maxLength?: number; hint?: string; required?: boolean;
}) {
  const errors = state.fieldErrors?.[id];
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id} name={id} type={type} autoComplete={autoComplete} required={required} inputMode={inputMode} maxLength={maxLength}
        defaultValue={defaultValue ?? state.values?.[id]} aria-invalid={errors ? true : undefined}
        aria-describedby={errors ? `${id}-error` : hint ? `${id}-hint` : undefined}
      />
      {hint && !errors ? <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p> : null}
      {errors ? <p id={`${id}-error`} className="text-xs text-destructive">{errors[0]}</p> : null}
    </div>
  );
}
