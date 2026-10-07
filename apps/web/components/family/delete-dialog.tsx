"use client";
import { useActionState, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/form-state";
import { FormMessage } from "@/components/auth/form-parts";

const INITIAL: FormState = {};

/**
 * Confirm-before-delete on the native <dialog> (showModal → focus trap, Esc, focus restore; no dependency).
 * The form posts `confirm=delete` plus `hidden` fields; the server re-checks the token, so a stray POST cannot delete.
 */
export function DeleteDialog({
  action, triggerLabel, title, description, confirmLabel, hidden = {}, dialogId, confirmValue = "delete", pendingLabel = "Deleting…",
}: {
  action: (state: FormState, fd: FormData) => Promise<FormState>;
  triggerLabel: string;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  hidden?: Record<string, string>;
  dialogId: string;
  confirmValue?: string; // token the server expects in `confirm`
  pendingLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const titleId = `${dialogId}-title`;
  const descId = `${dialogId}-desc`;
  return (
    <>
      <Button type="button" variant="destructive" aria-haspopup="dialog" onClick={() => ref.current?.showModal()}>{triggerLabel}</Button>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        aria-describedby={descId}
        onClick={(e) => { if (e.target === e.currentTarget && !pending) ref.current?.close(); }}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border bg-card p-6 text-foreground shadow-lg backdrop:bg-black/50"
      >
        <form action={formAction} className="space-y-4">
          <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
          <div id={descId} className="space-y-2 text-sm text-muted-foreground">{description}</div>
          <FormMessage state={state} />
          <input type="hidden" name="confirm" value={confirmValue} />
          {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" disabled={pending} onClick={() => ref.current?.close()}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={pending}>{pending ? pendingLabel : confirmLabel}</Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
