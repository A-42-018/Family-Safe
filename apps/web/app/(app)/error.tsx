"use client";
import { EmptyState } from "@/components/shell/empty-state";
import { Button } from "@/components/ui/button";

// The error message is never rendered (it can contain internals); only Next's opaque digest is shown for support.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert">
      <EmptyState
        icon="alert"
        title="Something went wrong"
        description="We couldn't load this page. Try again. If it keeps happening, sign out and back in."
        action={<Button onClick={reset}>Try again</Button>}
      />
      {error.digest ? <p className="mt-3 text-center text-xs text-muted-foreground">Reference: {error.digest}</p> : null}
    </div>
  );
}
