"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/form-state";
import { createChildAction, updateChildAction } from "@/lib/family/actions";

const INITIAL: FormState = {};

export function ChildForm({ child, cancelHref }: { child?: { id: string; name: string; dateOfBirth: string | null }; cancelHref: string }) {
  const [state, action] = useActionState(child ? updateChildAction : createChildAction, INITIAL);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      {child ? <input type="hidden" name="id" value={child.id} /> : null}
      <Field id="name" label="Name" state={state} defaultValue={child?.name} maxLength={100} autoComplete="off" />
      <Field
        id="dateOfBirth" label="Date of birth (optional)" type="date" state={state} required={false}
        defaultValue={child?.dateOfBirth ?? undefined} autoComplete="off"
        hint="Only used to show an age. It is never shown in links or shared."
      />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button asChild variant="outline"><Link href={cancelHref}>Cancel</Link></Button>
        <div className="sm:w-40"><SubmitButton pendingText="Saving…">{child ? "Save changes" : "Add child"}</SubmitButton></div>
      </div>
    </form>
  );
}
