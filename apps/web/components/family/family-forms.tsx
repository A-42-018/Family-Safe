"use client";
import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/auth/form-parts";
import type { FormState } from "@/lib/auth/form-state";
import { createFamilyAction, deleteFamilyAction, renameFamilyAction } from "@/lib/family/actions";
import { DeleteDialog } from "./delete-dialog";

const INITIAL: FormState = {};

export function CreateFamilyForm() {
  const [state, action] = useActionState(createFamilyAction, INITIAL);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <Field id="name" label="Family name" state={state} maxLength={100} hint="For example, “The Lee family”." autoComplete="off" />
      <SubmitButton pendingText="Creating…">Create family</SubmitButton>
    </form>
  );
}

export function RenameFamilyForm({ name }: { name: string }) {
  const [state, action] = useActionState(renameFamilyAction, INITIAL);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <Field id="name" label="Family name" state={state} defaultValue={name} maxLength={100} autoComplete="off" />
      <SubmitButton pendingText="Saving…">Save name</SubmitButton>
    </form>
  );
}

export function DeleteFamilyDialog({ familyName }: { familyName: string }) {
  return (
    <DeleteDialog
      dialogId="delete-family"
      action={deleteFamilyAction}
      triggerLabel="Delete family"
      confirmLabel="Delete family permanently"
      title={`Delete “${familyName}”?`}
      description={
        <>
          <p>This permanently removes the family, <strong>all children</strong>, <strong>all enrolled devices</strong> and everything those devices have reported.</p>
          <p>This can&apos;t be undone.</p>
        </>
      }
    />
  );
}
