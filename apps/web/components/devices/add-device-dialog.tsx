"use client";
import { useActionState, useRef, useState } from "react";
import { FormMessage } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { createPairingCodeAction } from "@/lib/enrollment/actions";
import type { PairingState } from "@/lib/enrollment/state";

const INITIAL: PairingState = {};

function PairingForm({ childId, onClose }: { childId: string; onClose: () => void }) {
  const [state, formAction, pending] = useActionState(createPairingCodeAction, INITIAL);
  const pairing = state.pairing;
  const minutes = pairing ? Math.max(1, Math.round(pairing.expiresIn / 60)) : 10;
  return (
    <form action={formAction} className="space-y-4">
      <h2 id="add-device-title" className="text-lg font-semibold">Add a device</h2>
      <div id="add-device-desc" className="space-y-2 text-sm text-muted-foreground">
        <p>Install FamilySafe on your child&apos;s Android phone and choose <strong>Enroll this device</strong>. FamilySafe stays visible on the phone, and your child is asked to confirm before it pairs.</p>
      </div>
      <FormMessage state={state} />
      <input type="hidden" name="childId" value={childId} />
      {pairing ? (
        <div className="space-y-2 rounded-md border bg-muted/40 p-4 text-center" aria-live="polite">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Pairing code</p>
          <p className="select-all font-mono text-2xl font-semibold tracking-widest" data-testid="pairing-code">{pairing.code}</p>
          <p className="text-xs text-muted-foreground">
            Enter it in the app within {minutes} minutes. It works once, and a new code replaces this one.
          </p>
        </div>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" disabled={pending} onClick={onClose}>{pairing ? "Done" : "Cancel"}</Button>
        <Button type="submit" disabled={pending}>{pending ? "Creating code…" : pairing ? "New code" : "Create pairing code"}</Button>
      </div>
    </form>
  );
}

/**
 * Native <dialog> (showModal → focus trap, Esc, focus restore; no dependency). Closing remounts the form (new `key`), so
 * the one-time code is dropped from client state as soon as the dialog closes.
 */
export function AddDeviceDialog({ childId }: { childId: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [generation, setGeneration] = useState(0);
  return (
    <>
      <Button type="button" aria-haspopup="dialog" onClick={() => ref.current?.showModal()}>Add device</Button>
      <dialog
        ref={ref}
        aria-labelledby="add-device-title"
        aria-describedby="add-device-desc"
        onClose={() => setGeneration((g) => g + 1)}
        onClick={(e) => { if (e.target === e.currentTarget) ref.current?.close(); }}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border bg-card p-6 text-foreground shadow-lg backdrop:bg-black/50"
      >
        <PairingForm key={generation} childId={childId} onClose={() => ref.current?.close()} />
      </dialog>
    </>
  );
}
