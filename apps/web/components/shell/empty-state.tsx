import * as React from "react";
import type { IconName } from "@/lib/nav";
import { Icon } from "./icons";

export function EmptyState({ icon, title, description, action }: { icon: IconName; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed px-6 py-12 text-center">
      <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon name={icon} />
      </span>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
