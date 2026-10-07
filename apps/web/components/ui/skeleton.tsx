import * as React from "react";
import { cn } from "@/lib/utils";

// Decorative placeholder; parents announce loading state (role="status").
const Skeleton = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-muted motion-reduce:animate-none", className)} {...props} />
);

export { Skeleton };
